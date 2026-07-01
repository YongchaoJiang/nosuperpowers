const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const crypto = require('crypto');

// ─── Database setup (lowdb) ───────────────────────────────────────────────────
const adapter = new FileSync(path.join(__dirname, 'blog.json'));
const db = low(adapter);

db.defaults({
  articles: [],
  users: [],
  comments: [],
  meta: { nextArticleId: 1, nextCommentId: 1 }
}).write();

// Patch existing data that predates nextCommentId
if (db.get('meta.nextCommentId').value() === undefined) {
  db.set('meta.nextCommentId', 1).write();
}

// Create default admin if not exists
const adminExists = db.get('users').find({ username: 'admin' }).value();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.get('users').push({
    id: 1,
    username: 'admin',
    password: hash
  }).write();
  console.log('Default admin created: admin / admin123');
}

// ─── Express setup ────────────────────────────────────────────────────────────
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: 'blog-secret-key-2024-' + crypto.randomBytes(8).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Inject auth info into all views
app.use((req, res, next) => {
  res.locals.isAdmin = !!req.session.userId;
  res.locals.adminUser = req.session.username || null;
  next();
});

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/admin/login');
  next();
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nextId() {
  const id = db.get('meta.nextArticleId').value();
  db.set('meta.nextArticleId', id + 1).write();
  return id;
}

function nextCommentId() {
  const id = db.get('meta.nextCommentId').value();
  db.set('meta.nextCommentId', id + 1).write();
  return id;
}

// In-memory rate limit: max 3 comments per IP per 5 minutes
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const cutoff = Date.now() - 5 * 60 * 1000;
  const times = (rateLimitMap.get(ip) || []).filter(t => t > cutoff);
  rateLimitMap.set(ip, times);
  return times.length >= 3;
}
function recordSubmission(ip) {
  const times = rateLimitMap.get(ip) || [];
  times.push(Date.now());
  rateLimitMap.set(ip, times);
}

function pendingCount() {
  return db.get('comments').filter({ status: 'pending' }).value().length;
}

function autoSummary(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200) + (html.length > 200 ? '...' : '');
}

function now() {
  return new Date().toISOString();
}

// ─── Public Routes ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 8;

  const all = db.get('articles')
    .filter({ published: true })
    .orderBy(['created_at'], ['desc'])
    .value();

  const total = all.length;
  const articles = all.slice((page - 1) * limit, page * limit);

  res.render('index', { articles, page, totalPages: Math.ceil(total / limit) || 1, total });
});

app.get('/article/:id', (req, res) => {
  const article = db.get('articles')
    .find({ id: parseInt(req.params.id), published: true })
    .value();
  if (!article) return res.status(404).render('404');

  const approved = db.get('comments')
    .filter({ articleId: article.id, status: 'approved' })
    .orderBy(['created_at'], ['asc'])
    .value();

  const topLevel = approved.filter(c => !c.parentId);
  const byParent = {};
  approved.filter(c => c.parentId).forEach(c => {
    (byParent[c.parentId] = byParent[c.parentId] || []).push(c);
  });

  res.render('article', {
    article,
    topLevel,
    byParent,
    commentCount: approved.length,
    submitted: req.query.submitted === '1',
    commentError: null,
    draft: null
  });
});

app.post('/article/:id/comments', (req, res) => {
  const article = db.get('articles')
    .find({ id: parseInt(req.params.id), published: true })
    .value();
  if (!article) return res.status(404).render('404');

  const nickname = (req.body.nickname || '').trim();
  const content  = (req.body.content  || '').trim();
  const email    = (req.body.email    || '').trim();
  const parentId = req.body.parentId ? parseInt(req.body.parentId) : null;

  const errors = [];
  if (!nickname || nickname.length > 50)   errors.push('昵称不能为空，且不超过 50 字');
  if (!content  || content.length  > 1000) errors.push('内容不能为空，且不超过 1000 字');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('邮箱格式不正确');
  if (!errors.length && isRateLimited(req.ip)) errors.push('提交太频繁，请稍后再试');

  const renderWithError = (msg) => {
    const approved = db.get('comments')
      .filter({ articleId: article.id, status: 'approved' })
      .orderBy(['created_at'], ['asc']).value();
    const topLevel = approved.filter(c => !c.parentId);
    const byParent = {};
    approved.filter(c => c.parentId).forEach(c => {
      (byParent[c.parentId] = byParent[c.parentId] || []).push(c);
    });
    res.render('article', {
      article, topLevel, byParent,
      commentCount: approved.length,
      submitted: false,
      commentError: msg,
      draft: { nickname, content, email, parentId }
    });
  };

  if (errors.length) return renderWithError(errors.join('；'));

  db.get('comments').push({
    id: nextCommentId(),
    articleId: article.id,
    parentId,
    nickname,
    email: email || null,
    content,
    status: 'pending',
    created_at: now(),
    ip: req.ip
  }).write();

  recordSubmission(req.ip);
  res.redirect(`/article/${article.id}?submitted=1#comments`);
});

// ─── Admin Auth ───────────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('login', { error: '请填写用户名和密码' });
  }
  const user = db.get('users').find({ username: username.trim() }).value();
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.userId = user.id;
    req.session.username = user.username;
    return res.redirect('/admin');
  }
  res.render('login', { error: '用户名或密码错误' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
app.get('/admin', requireAuth, (req, res) => {
  const articles = db.get('articles')
    .orderBy(['created_at'], ['desc'])
    .value();
  res.render('admin/dashboard', { articles });
});

// ─── Article CRUD ─────────────────────────────────────────────────────────────
app.get('/admin/articles/new', requireAuth, (req, res) => {
  res.render('admin/editor', { article: null });
});

app.post('/admin/articles', requireAuth, (req, res) => {
  const { title, content, publishAction } = req.body;
  if (!title || !content) {
    return res.render('admin/editor', { article: null, error: '标题和内容不能为空' });
  }

  const article = {
    id: nextId(),
    title: title.trim(),
    content,
    summary: autoSummary(content),
    published: publishAction === '1',
    created_at: now(),
    updated_at: now()
  };

  db.get('articles').push(article).write();
  res.redirect('/admin');
});

app.get('/admin/articles/:id/edit', requireAuth, (req, res) => {
  const article = db.get('articles').find({ id: parseInt(req.params.id) }).value();
  if (!article) return res.status(404).render('404');
  res.render('admin/editor', { article });
});

app.post('/admin/articles/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const article = db.get('articles').find({ id }).value();
  if (!article) return res.status(404).render('404');

  const { title, content, publishAction } = req.body;
  if (!title || !content) {
    return res.render('admin/editor', { article, error: '标题和内容不能为空' });
  }

  const published = publishAction === '1' ? true
                  : publishAction === '0' ? false
                  : article.published;

  db.get('articles').find({ id }).assign({
    title: title.trim(),
    content,
    summary: autoSummary(content),
    published,
    updated_at: now()
  }).write();

  res.redirect('/admin');
});

// Toggle publish (AJAX)
app.post('/admin/articles/:id/toggle-publish', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const article = db.get('articles').find({ id }).value();
  if (!article) return res.status(404).json({ error: 'Not found' });

  const newPublished = !article.published;
  db.get('articles').find({ id }).assign({ published: newPublished, updated_at: now() }).write();
  res.json({ published: newPublished });
});

// Delete article
app.post('/admin/articles/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.get('articles').remove({ id }).write();
  res.redirect('/admin');
});

// ─── Admin Comments ───────────────────────────────────────────────────────────
app.get('/admin/comments', requireAuth, (req, res) => {
  const filter = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status : 'pending';

  const comments = db.get('comments')
    .filter({ status: filter })
    .orderBy(['created_at'], ['desc'])
    .value()
    .map(c => {
      const a = db.get('articles').find({ id: c.articleId }).value();
      return { ...c, articleTitle: a ? a.title : '(已删除)' };
    });

  res.render('admin/comments', { comments, filter, pendingCount: pendingCount() });
});

app.post('/admin/comments/:id/approve', requireAuth, (req, res) => {
  db.get('comments').find({ id: parseInt(req.params.id) }).assign({ status: 'approved' }).write();
  res.redirect('back');
});

app.post('/admin/comments/:id/reject', requireAuth, (req, res) => {
  db.get('comments').find({ id: parseInt(req.params.id) }).assign({ status: 'rejected' }).write();
  res.redirect('back');
});

app.post('/admin/comments/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  // Also remove child replies
  db.get('comments').remove(c => c.id === id || c.parentId === id).write();
  res.redirect('back');
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).render('404'));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✓ Blog server: http://localhost:${PORT}`);
  console.log(`✓ Admin panel: http://localhost:${PORT}/admin`);
  console.log(`✓ Login credentials: admin / admin123\n`);
});
