# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在本仓库中工作时提供指引。

**语言约定**：在本仓库中，与用户交流的输出（对话回复、生成的文档如本文件、`openspec` 各类文档等）默认使用简体中文，与项目现有的用户可见文案（EJS 页面文案、错误提示）风格保持一致。代码本身（标识符、注释）和 git commit message 仍沿用现有惯例，保持英文。

## 常用命令

- `npm start` — 启动服务（`node server.js`），默认端口 3000。
- `npm run dev` — 使用 `nodemon` 启动，支持自动重启。
- `PORT=3099 npm start` — 用备用端口启动；这是项目里做手动验证时的约定做法，避免和已经在跑的开发实例冲突。
- `node --check server.js` — 修改 `server.js` 后做语法检查（项目没有构建步骤）。
- 没有测试框架/脚本（`package.json` 里没有 `test` 脚本）。验证方式是手动的：启动服务后用 `curl` 打路由，再直接查看 `blog.json` 确认写入结果（例如 `node -e "console.log(require('./blog.json').comments)"`）。可参考 `docs/superpowers/plans/2026-07-01-blog-comments.md` 里每个任务基于 curl 的验证步骤写法。
- 默认管理员账号（首次运行时若 `users` 为空会自动创建）：`admin` / `admin123`。

## 架构

这是一个单文件的 Express 博客应用——没有 MVC 目录结构。几乎所有逻辑都在 `server.js` 里，按顶部注释分区从上到下排列（数据库初始化 → Express 初始化 → 辅助函数 → 公开路由 → 管理员认证 → 管理后台 → 文章 CRUD → 评论管理 → 404 → 启动）。新增路由时，找到对应分区，遵循已有写法，而不是新建文件/模块——这个代码库刻意不拆分成 routes/models/controllers。

**存储**：没有真正的数据库。`lowdb` 通过 `FileSync` adapter 把所有数据持久化到单个 JSON 文件 `blog.json`，顶层集合有 `articles`、`users`、`comments`，以及一个存放自增计数器的 `meta` 对象（`nextArticleId`、`nextCommentId`）。启动时的 `db.defaults({...}).write()` 既会初始化一个全新文件，也会给已有文件补齐新字段（参考 `nextCommentId` 的补丁逻辑）——以后新增持久化字段时也要沿用这个模式，让已有的 `blog.json` 能平滑升级。

**认证**：基于 `express-session` 的会话认证。登录（`POST /admin/login`）用 `bcrypt.compareSync` 校验提交的密码和用户记录里存的哈希，通过后设置 `req.session.userId`/`req.session.username`。`requireAuth` 中间件只是简单检查 `req.session.userId`，不通过就重定向到 `/admin/login`——目前不区分账号角色，因为现在只有一个管理员账号。一个全局中间件会注入 `res.locals.isAdmin`/`res.locals.adminUser`，让任何 EJS 视图都能直接判断登录状态，不用额外传参。

**视图**：服务端渲染的 EJS 模板放在 `views/` 下，管理后台专属视图在 `views/admin/`，公共片段在 `views/partials/`（`head.ejs`、`footer.ejs`），通过 `<%- include(...) %>` 引入。所有面向用户的文案都是简体中文——新增文案要匹配现有的语气/措辞（参考 `views/login.ejs`、`views/admin/dashboard.ejs`），不要引入英文文案。

**转义约定（涉及安全）**：文章正文是管理员写的，用 `<%- article.content %>` 不转义渲染（它是编辑器产出的富文本 HTML）。任何访客提交的内容（评论内容、昵称、邮箱）都必须用会自动转义的 `<%= %>` 渲染，配合 CSS `white-space: pre-wrap` 保留换行——这是项目对用户输入唯一的 XSS 防护手段，没有引入任何净化库。不要打破这个约定。

**频率限制**：防刷逻辑就是 `server.js` 里一个纯内存的 `Map<ip, timestamp[]>`（不依赖任何库，进程重启后重置）——参见 `isRateLimited`/`recordSubmission`。给新的访客可写接口加限流时，复用这个模式（或者直接复用这两个函数），不要引入限流库。

**依赖克制**：这个代码库刻意避免在已有能力够用时引入新的 npm 包——比如评论功能就是复用了 `bcryptjs`/`express-session`/内存限流，而没有拉新库。优先考虑扩展已有依赖（`express`、`ejs`、`lowdb`、`bcryptjs`、`express-session`），再考虑引入新依赖。

**评论审核模型**（涉及评论功能时参考）：评论默认是 `pending` 状态，只有管理员在 `/admin/comments` 审核通过后才会公开展示；回复只支持一级——`parentId` 永远指向最初的顶层评论，即使是在回复一条回复（用 `replyToNickname` 记录具体被回复对象，用于展示）；删除文章会级联删除该文章下的所有评论。

## 规划类文档

- `openspec/` 存放 spec-driven 的变更提案（schema：`spec-driven`）——每个变更在 `openspec/changes/<name>/` 下有 proposal/design/specs/tasks。走正式变更流程时用 `openspec` CLI（`openspec status`、`openspec instructions <artifact>` 等）操作，不要手动改这些文件。
- `docs/superpowers/specs/` 和 `docs/superpowers/plans/` 存放过往功能（如评论系统）的设计文档和分步实施计划（中文）。这些文档展示了本仓库期望的细节颗粒度，以及"没有自动化测试、用 curl + 查看 `blog.json` 做验证"这一验证风格，可作为参考。
