# 博客评论功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为博客文章页增加匿名评论功能：访客可发表评论和一级回复，评论需管理员在独立的后台页面审核通过后才公开展示，并有基本的请求频率限制防刷。

**Architecture:** 沿用现有 Express + EJS + lowdb（`blog.json` 单文件数据库）架构。新增 `comments` 集合存储评论，公开路由负责提交与展示，后台路由（复用现有 `requireAuth` 中间件）负责审核。评论内容展示时使用 EJS 默认的 `<%= %>` 自动转义（而不是文章正文用的 `<%- %>`），配合 CSS `white-space: pre-wrap` 保留换行，天然防 XSS，无需额外净化库。

**Tech Stack:** Node.js, Express, EJS, lowdb（沿用现有依赖，不新增 npm 包）。项目当前没有自动化测试框架（`package.json` 中无测试相关依赖），因此本计划的每个任务都用 `curl` + 直接读取 `blog.json` 做手动验证，而不是单元测试文件，这与项目现状一致。

## Global Constraints

- 不引入任何新的 npm 依赖，所有实现只用已有的 `express` / `ejs` / `lowdb` 能力。
- 评论正文渲染一律使用 `<%= %>`（自动转义），不得使用 `<%- %>`，防止 XSS。
- 所有面向用户的文案使用简体中文，风格与现有页面一致（参见 `views/login.ejs`、`views/admin/dashboard.ejs`）。
- 昵称最长 50 字符，评论内容最长 1000 字符，邮箱选填并做简单格式校验（正则 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`）。
- 评论默认 `status: 'pending'`，只有 `status === 'approved'` 的评论才在文章页公开展示。
- 回复只允许一级：`parentId` 永远指向"顶层评论"的 id，即使用户点击的是"回复某条回复"。
- 频率限制：同一 IP 在滚动 5 分钟窗口内最多提交 3 条评论（内存记录，进程重启后重置）。
- 后台评论管理路由必须挂 `requireAuth` 中间件。
- 验证命令统一用 `PORT=3099` 启动服务，避免和其他正在运行的实例冲突；当前 `blog.json` 中已有一篇 `id=1` 且 `published=true` 的文章，验证步骤直接复用它。

---

### Task 1: 数据模型与评论辅助函数

**Files:**
- Modify: `server.js:13-17`（`db.defaults` 块）
- Modify: `server.js:58-63`（紧跟在 `nextId()` 之后新增函数）

**Interfaces:**
- Produces: `nextCommentId(): number`、`isCommentRateLimited(ip: string): boolean`、`recordCommentSubmission(ip: string): void`；`db` 新增 `comments: []` 集合和 `meta.nextCommentId`。

- [ ] **Step 1: 修改 `db.defaults`，新增 `comments` 集合和 `nextCommentId` 计数器**

在 `server.js` 中找到：

```js
db.defaults({
  articles: [],
  users: [],
  meta: { nextArticleId: 1 }
}).write();
```

替换为：

```js
db.defaults({
  articles: [],
  users: [],
  comments: [],
  meta: { nextArticleId: 1, nextCommentId: 1 }
}).write();
```

- [ ] **Step 2: 新增 `nextCommentId()` 和频率限制辅助函数**

在 `server.js` 中找到（紧跟在 `nextId()` 函数之后、`autoSummary` 之前）：

```js
function nextId() {
  const id = db.get('meta.nextArticleId').value();
  db.set('meta.nextArticleId', id + 1).write();
  return id;
}
```

在它下面新增：

```js
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

// ─── Comment rate limiting (in-memory, resets on restart) ────────────────────
const COMMENT_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const COMMENT_RATE_LIMIT_MAX = 3;
const commentSubmissionsByIp = new Map();

function isCommentRateLimited(ip) {
  const cutoff = Date.now() - COMMENT_RATE_LIMIT_WINDOW_MS;
  const recent = (commentSubmissionsByIp.get(ip) || []).filter(t => t > cutoff);
  commentSubmissionsByIp.set(ip, recent);
  return recent.length >= COMMENT_RATE_LIMIT_MAX;
}

function recordCommentSubmission(ip) {
  const recent = commentSubmissionsByIp.get(ip) || [];
  recent.push(Date.now());
  commentSubmissionsByIp.set(ip, recent);
}

function pendingCommentCount() {
  return db.get('comments').filter({ status: 'pending' }).value().length;
}
```

（`pendingCommentCount()` 现在一起加上，供 Task 5、Task 6 使用，避免后面再回头改这一段。）

- [ ] **Step 3: 语法检查**

Run: `node --check server.js`
Expected: 无输出（表示语法通过）

- [ ] **Step 4: 验证 defaults 逻辑正确**

Run:

```bash
node -e "
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const db = low(new FileSync('./blog.json'));
db.defaults({ articles: [], users: [], comments: [], meta: { nextArticleId: 1, nextCommentId: 1 } }).write();
console.log('meta:', JSON.stringify(db.get('meta').value()));
console.log('comments:', JSON.stringify(db.get('comments').value()));
"
```

Expected: 输出类似 `meta: {"nextArticleId":2,"nextCommentId":1}`（`nextArticleId` 的具体值取决于现有数据）和 `comments: []`。

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: add comment data model and rate-limit helpers"
```

---

### Task 2: 评论提交路由 + 文章页数据组装

**Files:**
- Modify: `server.js:98-105`（`GET /article/:id` 路由，替换为下方新代码，同时新增 `renderArticleWithComments` 辅助函数和 `POST /article/:id/comments` 路由）

**Interfaces:**
- Consumes: `nextCommentId()`、`isCommentRateLimited(ip)`、`recordCommentSubmission(ip)`（Task 1）、已有的 `now()` 辅助函数。
- Produces: `renderArticleWithComments(res, article, extra)`；传给 `article` 模板的新 locals：`topLevelComments`（顶层已通过评论数组，按 `created_at` 升序）、`commentsByParent`（`{ [顶层评论id]: 回复数组 }`）、`commentCount`（已通过评论总数）、`commentError`（字符串或 `null`）、`commentDraft`（`{ nickname, email, content, parentId, replyToNickname }` 或 `null`）、`commentSubmitted`（布尔值）。这些 local 名称是 Task 3 编写 `article.ejs` 时必须使用的确切名称。

- [ ] **Step 1: 替换 `GET /article/:id`，新增辅助函数和提交路由**

在 `server.js` 中找到：

```js
app.get('/article/:id', (req, res) => {
  const article = db.get('articles')
    .find({ id: parseInt(req.params.id), published: true })
    .value();

  if (!article) return res.status(404).render('404');
  res.render('article', { article });
});
```

替换为：

```js
function renderArticleWithComments(res, article, extra = {}) {
  const approvedComments = db.get('comments')
    .filter({ articleId: article.id, status: 'approved' })
    .orderBy(['created_at'], ['asc'])
    .value();

  const topLevelComments = approvedComments.filter(c => c.parentId === null);
  const commentsByParent = {};
  approvedComments.forEach(c => {
    if (c.parentId !== null) {
      if (!commentsByParent[c.parentId]) commentsByParent[c.parentId] = [];
      commentsByParent[c.parentId].push(c);
    }
  });

  res.render('article', {
    article,
    topLevelComments,
    commentsByParent,
    commentCount: approvedComments.length,
    commentError: null,
    commentDraft: null,
    commentSubmitted: false,
    ...extra
  });
}

app.get('/article/:id', (req, res) => {
  const article = db.get('articles')
    .find({ id: parseInt(req.params.id), published: true })
    .value();

  if (!article) return res.status(404).render('404');
  renderArticleWithComments(res, article, { commentSubmitted: req.query.commentSubmitted === '1' });
});

app.post('/article/:id/comments', (req, res) => {
  const article = db.get('articles')
    .find({ id: parseInt(req.params.id), published: true })
    .value();

  if (!article) return res.status(404).render('404');

  const { nickname, email, content, parentId, replyToNickname } = req.body;
  const trimmedNickname = (nickname || '').trim();
  const trimmedContent = (content || '').trim();
  const trimmedEmail = (email || '').trim();

  const errors = [];
  if (!trimmedNickname || trimmedNickname.length > 50) {
    errors.push('昵称不能为空，且不超过 50 个字符');
  }
  if (!trimmedContent || trimmedContent.length > 1000) {
    errors.push('评论内容不能为空，且不超过 1000 个字符');
  }
  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.push('邮箱格式不正确');
  }

  const ip = req.ip;
  if (errors.length === 0 && isCommentRateLimited(ip)) {
    errors.push('发送太频繁，请稍后再试');
  }

  let resolvedParentId = null;
  let resolvedReplyToNickname = null;
  if (parentId) {
    const parentComment = db.get('comments')
      .find({ id: parseInt(parentId), articleId: article.id, parentId: null })
      .value();
    if (parentComment) {
      resolvedParentId = parentComment.id;
      const trimmedReplyTo = (replyToNickname || '').trim();
      resolvedReplyToNickname = (trimmedReplyTo && trimmedReplyTo.length <= 50) ? trimmedReplyTo : parentComment.nickname;
    }
  }

  if (errors.length > 0) {
    return renderArticleWithComments(res, article, {
      commentError: errors.join('；'),
      commentDraft: {
        nickname: trimmedNickname,
        email: trimmedEmail,
        content: trimmedContent,
        parentId: resolvedParentId,
        replyToNickname: resolvedReplyToNickname
      }
    });
  }

  const comment = {
    id: nextCommentId(),
    articleId: article.id,
    parentId: resolvedParentId,
    replyToNickname: resolvedReplyToNickname,
    nickname: trimmedNickname,
    email: trimmedEmail || null,
    content: trimmedContent,
    status: 'pending',
    created_at: now(),
    ip
  };

  db.get('comments').push(comment).write();
  recordCommentSubmission(ip);
  res.redirect(`/article/${article.id}?commentSubmitted=1#comments`);
});
```

- [ ] **Step 2: 语法检查**

Run: `node --check server.js`
Expected: 无输出

- [ ] **Step 3: 启动服务并验证正常提交**

```bash
PORT=3099 npm start &
SERVER_PID=$!
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3099/article/1
curl -s -i -X POST http://localhost:3099/article/1/comments \
  -d "nickname=测试用户&content=这是一条测试评论" | head -n 1
node -e "console.log(JSON.stringify(require('./blog.json').comments, null, 2))"
kill $SERVER_PID
```

Expected：第一条 curl 输出 `200`；第二条输出 `HTTP/1.1 302 Found`（重定向）；`blog.json` 的 `comments` 数组里出现一条 `status: "pending"`、`nickname: "测试用户"` 的记录。

- [ ] **Step 4: 验证校验失败和频率限制**

```bash
PORT=3099 npm start &
SERVER_PID=$!
sleep 2
# 缺少昵称，应该校验失败（不重定向，返回 200）
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3099/article/1/comments -d "content=没有昵称"
# 连续提交 4 条（同一 IP），第 4 条应被限流拒绝
for i in 1 2 3 4; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3099/article/1/comments -d "nickname=User$i&content=第${i}条评论"
done
kill $SERVER_PID
```

Expected：第一条输出 `200`（校验失败，重新渲染页面而非重定向）；后面 4 条中前 3 条输出 `302`，第 4 条输出 `200`（被限流）。

- [ ] **Step 5: 清理测试数据**

手动编辑 `blog.json`，把 Step 3、Step 4 中新增的测试评论从 `comments` 数组中删除，避免脏数据进入下一步的验证。

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: add comment submission route with validation and rate limiting"
```

---

### Task 3: 文章页评论展示 UI（列表、发表表单、一级回复）

**Files:**
- Modify: `views/article.ejs:47-50`（在 `</article>` 和 `<div class="article-nav">` 之间插入评论区）
- Modify: `views/article.ejs:54-56`（在 `</main>` 和 footer include 之间插入 `<script>`）
- Modify: `public/css/style.css`（在第 363 行 `.article-nav` 规则之后、第 365 行 Empty State 之前插入评论区样式；并在第 721 行 Responsive 媒体查询块内补充响应式规则）

**Interfaces:**
- Consumes：Task 2 传入 `article` 模板的 locals（`topLevelComments`、`commentsByParent`、`commentCount`、`commentError`、`commentDraft`、`commentSubmitted`）。

- [ ] **Step 1: 在 `article.ejs` 中插入评论区标记**

找到：

```html
      <div class="article-content ql-content">
        <%- article.content %>
      </div>
    </article>

    <div class="article-nav">
```

替换为：

```html
      <div class="article-content ql-content">
        <%- article.content %>
      </div>
    </article>

    <section class="comments-section" id="comments">
      <h2 class="comments-heading">评论 (<%= commentCount %>)</h2>

      <% if (typeof commentSubmitted !== 'undefined' && commentSubmitted) { %>
        <div class="alert alert-success"><span>✓</span> 评论已提交，审核通过后将显示</div>
      <% } %>

      <% if (typeof commentError !== 'undefined' && commentError) { %>
        <div class="alert alert-error"><span>⚠</span> <%= commentError %></div>
      <% } %>

      <div class="comment-list">
        <% if (topLevelComments.length === 0) { %>
          <p class="comments-empty">还没有评论，来发表第一条评论吧</p>
        <% } %>
        <% topLevelComments.forEach(comment => { %>
          <div class="comment-item" data-comment-id="<%= comment.id %>">
            <div class="comment-body">
              <div class="comment-meta">
                <span class="comment-nickname"><%= comment.nickname %></span>
                <span class="comment-date"><%= new Date(comment.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) %></span>
              </div>
              <p class="comment-content"><%= comment.content %></p>
              <button type="button" class="comment-reply-toggle" data-nickname="<%= comment.nickname %>">回复</button>
            </div>

            <% (commentsByParent[comment.id] || []).forEach(reply => { %>
              <div class="comment-item comment-reply">
                <div class="comment-body">
                  <div class="comment-meta">
                    <span class="comment-nickname"><%= reply.nickname %></span>
                    <span class="comment-date"><%= new Date(reply.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) %></span>
                  </div>
                  <p class="comment-content"><% if (reply.replyToNickname) { %><span class="comment-reply-to">回复 @<%= reply.replyToNickname %>：</span><% } %><%= reply.content %></p>
                  <button type="button" class="comment-reply-toggle" data-nickname="<%= reply.nickname %>">回复</button>
                </div>
              </div>
            <% }) %>

            <form action="/article/<%= article.id %>/comments" method="POST" class="comment-reply-form" style="display:none">
              <input type="hidden" name="parentId" value="<%= comment.id %>">
              <input type="hidden" name="replyToNickname" class="reply-to-nickname-input" value="">
              <div class="form-row">
                <div class="form-group">
                  <label>昵称</label>
                  <input type="text" name="nickname" maxlength="50" required>
                </div>
                <div class="form-group">
                  <label>邮箱（可选）</label>
                  <input type="email" name="email" maxlength="100">
                </div>
              </div>
              <div class="form-group">
                <label>回复内容</label>
                <textarea name="content" maxlength="1000" rows="3" required></textarea>
              </div>
              <div class="comment-reply-form-actions">
                <button type="submit" class="btn btn-primary btn-sm">提交回复</button>
                <button type="button" class="btn btn-outline btn-sm comment-reply-cancel">取消</button>
              </div>
            </form>
          </div>
        <% }) %>
      </div>

      <div class="comment-form-wrap">
        <h3 class="comment-form-heading">发表评论</h3>
        <form action="/article/<%= article.id %>/comments" method="POST" class="comment-form">
          <input type="hidden" name="parentId" value="">
          <div class="form-row">
            <div class="form-group">
              <label for="commentNickname">昵称</label>
              <input type="text" id="commentNickname" name="nickname" maxlength="50" required value="<%= (commentDraft && !commentDraft.parentId) ? commentDraft.nickname : '' %>">
            </div>
            <div class="form-group">
              <label for="commentEmail">邮箱（可选）</label>
              <input type="email" id="commentEmail" name="email" maxlength="100" value="<%= (commentDraft && !commentDraft.parentId) ? commentDraft.email : '' %>">
            </div>
          </div>
          <div class="form-group">
            <label for="commentContent">评论内容</label>
            <textarea id="commentContent" name="content" maxlength="1000" rows="4" required><%= (commentDraft && !commentDraft.parentId) ? commentDraft.content : '' %></textarea>
          </div>
          <button type="submit" class="btn btn-primary">提交评论</button>
        </form>
      </div>
    </section>

    <div class="article-nav">
```

- [ ] **Step 2: 在 `article.ejs` 中插入回复交互脚本和错误草稿回填脚本**

找到文件末尾（`.article-container` 的收尾和 footer include 之间）：

```html
  </div>
</main>

<%- include('partials/footer') %>
```

替换为：

```html
  </div>
</main>

  <script>
    document.querySelectorAll('.comment-reply-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const container = btn.closest('.comment-item[data-comment-id]');
        const form = container.querySelector(':scope > .comment-reply-form');
        form.querySelector('.reply-to-nickname-input').value = btn.dataset.nickname;
        form.style.display = 'block';
        form.querySelector('input[name="nickname"]').focus();
      });
    });

    document.querySelectorAll('.comment-reply-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.comment-reply-form').style.display = 'none';
      });
    });

    <% if (typeof commentDraft !== 'undefined' && commentDraft && commentDraft.parentId) { %>
      (function () {
        const container = document.querySelector('.comment-item[data-comment-id="<%= commentDraft.parentId %>"]');
        if (!container) return;
        const form = container.querySelector(':scope > .comment-reply-form');
        form.style.display = 'block';
        form.querySelector('input[name="nickname"]').value = <%- JSON.stringify(commentDraft.nickname || '') %>;
        form.querySelector('input[name="email"]').value = <%- JSON.stringify(commentDraft.email || '') %>;
        form.querySelector('textarea[name="content"]').value = <%- JSON.stringify(commentDraft.content || '') %>;
        form.querySelector('.reply-to-nickname-input').value = <%- JSON.stringify(commentDraft.replyToNickname || '') %>;
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })();
    <% } %>
  </script>

<%- include('partials/footer') %>
```

- [ ] **Step 3: 在 `public/css/style.css` 中插入评论区样式**

找到：

```css
.article-nav { display: flex; justify-content: flex-start; }

/* ─── Empty State ───────────────────────────────────────────────────────────── */
```

替换为：

```css
.article-nav { display: flex; justify-content: flex-start; }

/* ─── Comments ──────────────────────────────────────────────────────────────── */
.comments-section {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 40px 48px;
  margin-bottom: 32px;
}

.comments-heading {
  font-size: 1.3rem;
  font-weight: 700;
  margin-bottom: 20px;
}

.comments-empty {
  color: var(--text-muted);
  font-size: .9rem;
  padding: 16px 0;
}

.alert-success {
  background: var(--success-light);
  color: var(--success);
  border: 1px solid #86efac;
}

.comment-list { margin-bottom: 32px; }

.comment-item {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
.comment-item:last-child { border-bottom: none; }

.comment-reply {
  margin-left: 32px;
  padding: 12px 0 12px 16px;
  border-left: 2px solid var(--border);
  border-bottom: none;
}

.comment-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.comment-nickname { font-weight: 600; font-size: .9rem; color: var(--text); }
.comment-date { font-size: .8rem; color: var(--text-light); }

.comment-content {
  font-size: .95rem;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
  margin-bottom: 8px;
}

.comment-reply-to { color: var(--primary); font-weight: 500; }

.comment-reply-toggle {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-muted);
  font-size: .82rem;
  cursor: pointer;
  font-family: inherit;
}
.comment-reply-toggle:hover { color: var(--primary); }

.comment-reply-form {
  margin: 12px 0 0 16px;
  padding: 16px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.comment-reply-form-actions { display: flex; gap: 10px; }

.comment-form-wrap {
  padding-top: 24px;
  border-top: 1px solid var(--border);
}

.comment-form-heading { font-size: 1.05rem; font-weight: 600; margin-bottom: 16px; }

.comment-form { display: flex; flex-direction: column; gap: 16px; }

.form-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.form-row .form-group { flex: 1; min-width: 200px; }

.comment-form textarea,
.comment-reply-form textarea {
  padding: 10px 14px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: .95rem;
  font-family: inherit;
  color: var(--text);
  resize: vertical;
  outline: none;
}
.comment-form textarea:focus,
.comment-reply-form textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37,99,235,.12);
}

/* ─── Empty State ───────────────────────────────────────────────────────────── */
```

- [ ] **Step 4: 在 Responsive 媒体查询块中补充评论区规则**

找到：

```css
@media (max-width: 640px) {
  .article-header { padding: 28px 24px 20px; }
  .article-content { padding: 24px; }
  .article-heading { font-size: 1.5rem; }
  .col-date { display: none; }
  .auth-card { padding: 32px 24px; }
  .admin-page-header { flex-direction: column; align-items: flex-start; }
  .stats { flex-wrap: wrap; gap: 12px; }
}
```

替换为：

```css
@media (max-width: 640px) {
  .article-header { padding: 28px 24px 20px; }
  .article-content { padding: 24px; }
  .article-heading { font-size: 1.5rem; }
  .col-date { display: none; }
  .auth-card { padding: 32px 24px; }
  .admin-page-header { flex-direction: column; align-items: flex-start; }
  .stats { flex-wrap: wrap; gap: 12px; }
  .comments-section { padding: 28px 20px; }
  .comment-reply { margin-left: 12px; }
  .comment-reply-form { margin-left: 0; }
}
```

- [ ] **Step 5: 手动验证页面渲染**

```bash
PORT=3099 npm start &
SERVER_PID=$!
sleep 2
curl -s http://localhost:3099/article/1 > /tmp/article1.html
grep -o 'comments-section' /tmp/article1.html | head -n 1
grep -o '发表评论' /tmp/article1.html | head -n 1
kill $SERVER_PID
```

Expected：两条 `grep` 都能匹配到对应文本，说明评论区已经渲染到页面里。

- [ ] **Step 6: 端到端验证回复流程（需要先在后台审核，Task 5 完成后回来补跑一次即可，这里先确认页面不报错）**

```bash
PORT=3099 npm start &
SERVER_PID=$!
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3099/article/1
kill $SERVER_PID
```

Expected：输出 `200`，页面正常渲染不报错（EJS 模板里用到的所有 locals 都已由 Task 2 提供）。

- [ ] **Step 7: Commit**

```bash
git add views/article.ejs public/css/style.css
git commit -m "feat: add comment list, submission form, and reply UI to article page"
```

---

### Task 4: 文章删除时级联删除其评论

**Files:**
- Modify: `server.js:207-211`（`POST /admin/articles/:id/delete` 路由）

**Interfaces:**
- Consumes：Task 1 中新增的 `comments` 集合。

- [ ] **Step 1: 修改删除路由**

找到：

```js
app.post('/admin/articles/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.get('articles').remove({ id }).write();
  res.redirect('/admin');
});
```

替换为：

```js
app.post('/admin/articles/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.get('articles').remove({ id }).write();
  db.get('comments').remove({ articleId: id }).write();
  res.redirect('/admin');
});
```

- [ ] **Step 2: 语法检查**

Run: `node --check server.js`
Expected: 无输出

- [ ] **Step 3: 端到端验证级联删除**

```bash
PORT=3099 npm start &
SERVER_PID=$!
sleep 2

# 登录管理员
curl -s -c /tmp/cookies.txt -X POST http://localhost:3099/admin/login -d "username=admin&password=admin123" -o /dev/null

# 创建一篇测试文章并发布
curl -s -b /tmp/cookies.txt -X POST http://localhost:3099/admin/articles \
  -d "title=级联删除测试&content=hello&publishAction=1" -o /dev/null

# 找到新文章的 id（取 articles 数组最后一个）
NEW_ID=$(node -e "const d=require('./blog.json'); console.log(d.articles[d.articles.length-1].id)")
echo "new article id: $NEW_ID"

# 对这篇文章发一条评论
curl -s -o /dev/null -X POST http://localhost:3099/article/$NEW_ID/comments -d "nickname=X&content=会被级联删除的评论"

# 确认评论已写入
node -e "const d=require('./blog.json'); console.log('before delete:', d.comments.filter(c => c.articleId === $NEW_ID).length)"

# 删除这篇文章
curl -s -b /tmp/cookies.txt -X POST http://localhost:3099/admin/articles/$NEW_ID/delete -o /dev/null

# 确认评论也被删除
node -e "const d=require('./blog.json'); console.log('after delete:', d.comments.filter(c => c.articleId === $NEW_ID).length)"

kill $SERVER_PID
```

Expected：`before delete: 1`，`after delete: 0`。

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "fix: cascade delete comments when their article is deleted"
```

---

### Task 5: 后台评论审核（路由 + 页面）

**Files:**
- Modify: `server.js:132-137`（`GET /admin` 路由，传入 `pendingCommentCount`）
- Modify: `server.js`（在 `POST /admin/articles/:id/delete` 之后、`// ─── 404 ───` 注释之前新增评论审核路由）
- Create: `views/admin/comments.ejs`
- Modify: `public/css/style.css`（新增评论审核相关样式）

**Interfaces:**
- Consumes：`pendingCommentCount()`（Task 1）、`requireAuth`（已存在）。
- Produces：`GET /admin/comments?status=pending|approved|all`、`POST /admin/comments/:id/approve`、`POST /admin/comments/:id/delete`；传给 `admin/comments` 模板的 locals：`comments`（数组，每项在原评论字段基础上多一个 `articleTitle` 字段）、`currentStatus`、`pendingCommentCount`。

- [ ] **Step 1: 修改 `GET /admin`，传入待审核数量**

找到：

```js
app.get('/admin', requireAuth, (req, res) => {
  const articles = db.get('articles')
    .orderBy(['created_at'], ['desc'])
    .value();
  res.render('admin/dashboard', { articles });
});
```

替换为：

```js
app.get('/admin', requireAuth, (req, res) => {
  const articles = db.get('articles')
    .orderBy(['created_at'], ['desc'])
    .value();
  res.render('admin/dashboard', { articles, pendingCommentCount: pendingCommentCount() });
});
```

- [ ] **Step 2: 新增评论审核路由**

找到：

```js
// Delete article
app.post('/admin/articles/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.get('articles').remove({ id }).write();
  db.get('comments').remove({ articleId: id }).write();
  res.redirect('/admin');
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
```

替换为：

```js
// Delete article
app.post('/admin/articles/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.get('articles').remove({ id }).write();
  db.get('comments').remove({ articleId: id }).write();
  res.redirect('/admin');
});

// ─── Comment Moderation ───────────────────────────────────────────────────────
app.get('/admin/comments', requireAuth, (req, res) => {
  const status = ['pending', 'approved', 'all'].includes(req.query.status) ? req.query.status : 'pending';

  let comments = db.get('comments').orderBy(['created_at'], ['desc']).value();
  if (status !== 'all') {
    comments = comments.filter(c => c.status === status);
  }

  const articlesById = {};
  db.get('articles').value().forEach(a => { articlesById[a.id] = a; });

  const enrichedComments = comments.map(c => ({
    ...c,
    articleTitle: articlesById[c.articleId] ? articlesById[c.articleId].title : '(文章已删除)'
  }));

  res.render('admin/comments', {
    comments: enrichedComments,
    currentStatus: status,
    pendingCommentCount: pendingCommentCount()
  });
});

app.post('/admin/comments/:id/approve', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.get('comments').find({ id }).assign({ status: 'approved' }).write();
  res.redirect(`/admin/comments?status=${req.body.status || 'pending'}`);
});

app.post('/admin/comments/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.get('comments').remove({ id }).write();
  res.redirect(`/admin/comments?status=${req.body.status || 'pending'}`);
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
```

- [ ] **Step 3: 语法检查**

Run: `node --check server.js`
Expected: 无输出

- [ ] **Step 4: 新建 `views/admin/comments.ejs`**

```html
<%- include('../partials/head', { pageTitle: '评论管理' }) %>

<div class="admin-layout">

  <header class="admin-header">
    <div class="admin-header-inner">
      <div class="admin-brand">
        <span class="logo-icon">✦</span>
        <span>评论管理</span>
      </div>
      <nav class="admin-nav">
        <a href="/admin" class="nav-link">← 返回后台</a>
        <a href="/admin/logout" class="nav-link nav-link-ghost">退出 (<%= adminUser %>)</a>
      </nav>
    </div>
  </header>

  <main class="admin-main">
    <div class="admin-container">

      <div class="admin-page-header">
        <h1>评论管理</h1>
      </div>

      <div class="comment-status-tabs">
        <a href="/admin/comments?status=pending" class="tab-link <%= currentStatus === 'pending' ? 'tab-link-active' : '' %>">待审核 (<%= pendingCommentCount %>)</a>
        <a href="/admin/comments?status=approved" class="tab-link <%= currentStatus === 'approved' ? 'tab-link-active' : '' %>">已通过</a>
        <a href="/admin/comments?status=all" class="tab-link <%= currentStatus === 'all' ? 'tab-link-active' : '' %>">全部</a>
      </div>

      <% if (comments.length === 0) { %>
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <h2>暂无评论</h2>
        </div>
      <% } else { %>
        <div class="table-wrapper">
          <table class="articles-table">
            <thead>
              <tr>
                <th>文章</th>
                <th>昵称</th>
                <th>内容</th>
                <th class="col-status">状态</th>
                <th class="col-date">提交时间</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <% comments.forEach(comment => { %>
                <tr>
                  <td><%= comment.articleTitle %></td>
                  <td>
                    <%= comment.nickname %>
                    <% if (comment.email) { %><br><span class="comment-email"><%= comment.email %></span><% } %>
                  </td>
                  <td class="col-comment-content">
                    <% if (comment.replyToNickname) { %><span class="comment-reply-to">回复 @<%= comment.replyToNickname %>：</span><% } %>
                    <%= comment.content %>
                  </td>
                  <td class="col-status">
                    <span class="status-badge <%= comment.status === 'approved' ? 'status-published' : 'status-draft' %>">
                      <%= comment.status === 'approved' ? '已通过' : '待审核' %>
                    </span>
                  </td>
                  <td class="col-date">
                    <%= new Date(comment.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) %>
                  </td>
                  <td class="col-actions">
                    <div class="action-buttons">
                      <% if (comment.status === 'pending') { %>
                        <form action="/admin/comments/<%= comment.id %>/approve" method="POST">
                          <input type="hidden" name="status" value="<%= currentStatus %>">
                          <button type="submit" class="action-btn action-edit">通过</button>
                        </form>
                      <% } %>
                      <form action="/admin/comments/<%= comment.id %>/delete" method="POST">
                        <input type="hidden" name="status" value="<%= currentStatus %>">
                        <button type="submit" class="action-btn action-delete">删除</button>
                      </form>
                    </div>
                  </td>
                </tr>
              <% }) %>
            </tbody>
          </table>
        </div>
      <% } %>

    </div>
  </main>
</div>

</body>
</html>
```

- [ ] **Step 5: 在 `public/css/style.css` 中新增评论审核样式**

找到（Task 3 已经加入的评论区样式末尾）：

```css
.comment-form textarea:focus,
.comment-reply-form textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37,99,235,.12);
}

/* ─── Empty State ───────────────────────────────────────────────────────────── */
```

替换为：

```css
.comment-form textarea:focus,
.comment-reply-form textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37,99,235,.12);
}

/* ─── Comment Moderation ────────────────────────────────────────────────────── */
.comment-status-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.tab-link {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: .875rem;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-white);
  border: 1px solid var(--border);
}
.tab-link:hover { color: var(--text); }

.tab-link-active {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.col-comment-content {
  max-width: 320px;
  font-size: .85rem;
  color: var(--text);
}

.comment-email { font-size: .78rem; color: var(--text-light); }

/* ─── Empty State ───────────────────────────────────────────────────────────── */
```

- [ ] **Step 6: 端到端验证审核流程**

```bash
PORT=3099 npm start &
SERVER_PID=$!
sleep 2

curl -s -c /tmp/cookies.txt -X POST http://localhost:3099/admin/login -d "username=admin&password=admin123" -o /dev/null

# 提交一条顶层评论
curl -s -o /dev/null -X POST http://localhost:3099/article/1/comments -d "nickname=审核测试&content=等待审核的评论"
COMMENT_ID=$(node -e "const d=require('./blog.json'); console.log(d.comments[d.comments.length-1].id)")
echo "comment id: $COMMENT_ID"

# 后台待审核列表应该能看到
curl -s -b /tmp/cookies.txt http://localhost:3099/admin/comments?status=pending | grep -o '审核测试'

# 通过这条评论
curl -s -b /tmp/cookies.txt -X POST http://localhost:3099/admin/comments/$COMMENT_ID/approve -d "status=pending" -o /dev/null
node -e "const d=require('./blog.json'); console.log(d.comments.find(c => c.id === $COMMENT_ID).status)"

# 文章页现在应该能看到这条评论
curl -s http://localhost:3099/article/1 | grep -o '审核测试'

# 后台删除这条评论
curl -s -b /tmp/cookies.txt -X POST http://localhost:3099/admin/comments/$COMMENT_ID/delete -d "status=approved" -o /dev/null
node -e "const d=require('./blog.json'); console.log(d.comments.find(c => c.id === $COMMENT_ID) === undefined)"

kill $SERVER_PID
```

Expected：依次输出 `审核测试`（匹配到）、`approved`、`审核测试`（匹配到）、`true`。

- [ ] **Step 7: Commit**

```bash
git add server.js views/admin/comments.ejs public/css/style.css
git commit -m "feat: add comment moderation routes and admin page"
```

---

### Task 6: 后台导航"评论管理"入口和待审核角标

**Files:**
- Modify: `views/admin/dashboard.ejs:11-15`（`admin-nav` 区块）
- Modify: `public/css/style.css`（新增 `.nav-badge` 样式）

**Interfaces:**
- Consumes：Task 5 中 `GET /admin` 路由已传入的 `pendingCommentCount` local。

- [ ] **Step 1: 修改 `views/admin/dashboard.ejs` 导航**

找到：

```html
      <nav class="admin-nav">
        <a href="/" class="nav-link" target="_blank">查看博客 ↗</a>
        <a href="/admin/articles/new" class="btn btn-primary btn-sm">+ 新建文章</a>
        <a href="/admin/logout" class="nav-link nav-link-ghost">退出 (<%= adminUser %>)</a>
      </nav>
```

替换为：

```html
      <nav class="admin-nav">
        <a href="/" class="nav-link" target="_blank">查看博客 ↗</a>
        <a href="/admin/comments" class="nav-link">
          评论管理<% if (pendingCommentCount > 0) { %><span class="nav-badge"><%= pendingCommentCount %></span><% } %>
        </a>
        <a href="/admin/articles/new" class="btn btn-primary btn-sm">+ 新建文章</a>
        <a href="/admin/logout" class="nav-link nav-link-ghost">退出 (<%= adminUser %>)</a>
      </nav>
```

- [ ] **Step 2: 在 `public/css/style.css` 中新增角标样式**

找到（Task 5 加入的评论审核样式末尾）：

```css
.comment-email { font-size: .78rem; color: var(--text-light); }

/* ─── Empty State ───────────────────────────────────────────────────────────── */
```

替换为：

```css
.comment-email { font-size: .78rem; color: var(--text-light); }

.nav-badge {
  display: inline-block;
  min-width: 16px;
  padding: 1px 5px;
  margin-left: 4px;
  border-radius: 20px;
  background: var(--danger);
  color: #fff;
  font-size: .7rem;
  font-weight: 700;
  text-align: center;
  line-height: 1.4;
}

/* ─── Empty State ───────────────────────────────────────────────────────────── */
```

- [ ] **Step 3: 手动验证角标显示**

```bash
PORT=3099 npm start &
SERVER_PID=$!
sleep 2

curl -s -c /tmp/cookies.txt -X POST http://localhost:3099/admin/login -d "username=admin&password=admin123" -o /dev/null

# 造一条待审核评论，确保角标 > 0
curl -s -o /dev/null -X POST http://localhost:3099/article/1/comments -d "nickname=角标测试&content=测试角标显示"

curl -s -b /tmp/cookies.txt http://localhost:3099/admin | grep -o 'nav-badge'
curl -s -b /tmp/cookies.txt http://localhost:3099/admin | grep -o '评论管理'

# 清理这条测试评论
node -e "
const fs = require('fs');
const d = require('./blog.json');
d.comments = d.comments.filter(c => c.nickname !== '角标测试');
fs.writeFileSync('./blog.json', JSON.stringify(d, null, 2));
"

kill $SERVER_PID
```

Expected：两条 `grep` 都能匹配到，说明"评论管理"链接和角标都正确渲染。

- [ ] **Step 4: Commit**

```bash
git add views/admin/dashboard.ejs public/css/style.css
git commit -m "feat: add comment moderation entry with pending-count badge to admin nav"
```

---

## Post-Plan Checklist

完成全部 6 个任务后，建议按设计文档《`docs/superpowers/specs/2026-07-01-blog-comments-design.md`》里的 8 条测试计划，用真实浏览器再走一遍完整流程（尤其是"回复一条回复，确认不会出现二级嵌套"这一条，纯 curl 较难覆盖 UI 交互本身）。
