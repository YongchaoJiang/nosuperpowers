# 博客评论功能 设计文档

日期：2026-07-01

## 背景

当前博客系统（Express + EJS + lowdb）只有文章的发布/编辑功能和单一管理员账号，读者无法互动。本设计为文章页新增评论功能。

## 目标

- 访客无需注册即可对文章发表评论（匿名 + 昵称）。
- 评论需管理员审核通过后才对外展示，避免垃圾内容。
- 支持一级回复（回复某条评论），不支持多级嵌套。
- 简单的请求频率限制，防止刷评论。
- 管理员在独立的后台页面集中审核/删除评论。

## 非目标

- 不做读者注册/登录体系。
- 不做邮件验证、邮件通知。
- 不做多级嵌套回复（超过一级）。
- 不引入外部反垃圾评论服务（如 Akismet）。
- 不做评论点赞/表情等互动功能。
- 不在首页文章列表展示评论数（只在文章详情页展示）。

## 数据模型

在 `blog.json` 中新增 `comments` 集合，并在 `meta` 中新增 `nextCommentId`：

```js
db.defaults({
  articles: [],
  users: [],
  comments: [],
  meta: { nextArticleId: 1, nextCommentId: 1 }
})
```

评论对象结构：

```js
{
  id: number,
  articleId: number,
  parentId: number | null,       // 回复时指向被回复的顶层评论 id；顶层评论为 null
  replyToNickname: string | null,// parentId 存在时，记录被回复者的昵称，用于展示 "回复 @xxx"
  nickname: string,              // 必填，长度 1-50
  email: string | null,          // 可选，仅后台可见，不对外展示，简单格式校验
  content: string,               // 必填，长度 1-1000，展示时用 EJS 自动转义 + CSS white-space: pre-wrap 保留换行
  status: 'pending' | 'approved',
  created_at: string,            // ISO 时间戳
  ip: string                     // 提交者 IP，仅用于频率限制和后台参考，不对外展示
}
```

**回复规则**：只允许一级回复。无论用户点击的是"回复顶层评论"还是"回复某条回复"，写入的 `parentId` 都指向最初的顶层评论 id；`replyToNickname` 记录具体被回复对象的昵称。前端展示时，顶层评论下方平铺展示所有回复（按时间升序），回复内容前缀显示"回复 @某某："。

**级联删除**：文章被删除（`POST /admin/articles/:id/delete`）时，同时删除该文章下的所有评论。

## 公开页面：提交与展示

### 文章页 (`views/article.ejs`)

在文章正文下方新增"评论区"：

- 展示所有 `status === 'approved'` 的评论，顶层评论按 `created_at` 升序排列，其回复紧跟在下方（同样按时间升序）。
- 每条评论展示：昵称、时间、内容。不展示邮箱和 IP。
- 每条顶层评论有"回复"链接，点击后在该评论下方展开一个小表单（昵称 + 邮箱可选 + 内容 + 隐藏的 `parentId`）。点击某条回复的"回复"，效果一样，只是 `parentId` 仍指向其顶层祖先，同时记录 `replyToNickname`。
- 评论区顶部有一个总的顶层评论表单（无 `parentId`）。
- 评论区标题显示当前已通过评论数，例如"评论 (3)"。

### 提交路由 `POST /article/:id/comments`

请求体：`{ nickname, email, content, parentId }`。

校验规则：
- 文章必须存在且已发布，否则 404。
- `nickname` 必填，trim 后长度 1-50。
- `content` 必填，trim 后长度 1-1000。
- `email` 可选，若填写需通过简单正则校验（如 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`）。
- 若提供 `parentId`，必须能在同一篇文章的评论中找到对应的顶层评论（`parentId` 存在且该评论本身 `parentId === null`），否则忽略此字段按顶层评论处理。

校验失败：沿用 `admin/editor` 现有写法，直接 `res.render('article', {...})` 重新渲染文章页，带上错误信息和用户已填内容（不做重定向，避免用户重新输入）。

校验通过：写入一条 `status: 'pending'` 的评论，重定向回 `/article/:id#comments`，并通过 query 参数（如 `?commentSubmitted=1`）在页面顶部提示"评论已提交，审核通过后将显示"。

## 防刷：请求频率限制

在 `server.js` 中维护一个进程内 `Map<ip, timestamp[]>`（不引入新依赖）：

- 每次提交前检查该 IP 最近 5 分钟内的提交次数，超过 3 次则拒绝，重新渲染文章页并提示"发送太频繁，请稍后再试"。
- 每次提交成功后，把时间戳记录进该 IP 的数组，并顺带清理超出窗口的旧记录。
- 仅内存记录，服务重启后重置，符合当前项目量级和"够用就好"的风格。

## 后台评论管理

### 导航入口

在后台导航（`views/admin/dashboard.ejs` 或公共后台布局）新增"评论管理"链接，旁边显示待审核评论数量的小红点（红点数字来自 `comments` 中 `status === 'pending'` 的数量）。

### 页面 `GET /admin/comments`（新建 `views/admin/comments.ejs`）

- 顶部 tab：待审核 / 已通过 / 全部（默认待审核），通过 query 参数 `?status=pending|approved|all` 切换。
- 每行展示：所属文章标题（链接到文章页）、昵称、邮箱（若有）、内容摘要、提交时间、如果是回复则显示"回复给 @xxx"。
- 操作按钮：
  - 「通过」（仅待审核评论可见）：`POST /admin/comments/:id/approve`，将 `status` 置为 `approved`。
  - 「删除」（任意状态都可见）：`POST /admin/comments/:id/delete`，直接从 `comments` 数组移除。不设单独的"拒绝"状态——拒绝即删除，保持简单。

所有后台评论路由都需要 `requireAuth` 中间件。

## 涉及改动的文件

- `server.js`：
  - `db.defaults` 增加 `comments: []` 和 `meta.nextCommentId`
  - 新增 `nextCommentId()` 辅助函数（仿照现有 `nextId()`）
  - 新增内存频率限制 Map 及检查逻辑
  - 新增路由：`POST /article/:id/comments`、`GET /admin/comments`、`POST /admin/comments/:id/approve`、`POST /admin/comments/:id/delete`
  - `POST /admin/articles/:id/delete` 中增加级联删除该文章评论的逻辑
- `views/article.ejs`：评论列表 + 顶层/回复提交表单 + 提交状态提示
- `views/admin/comments.ejs`（新建）：后台评论管理页面
- `views/admin/dashboard.ejs`（或后台公共导航片段）：新增"评论管理"入口和待审核计数
- `public/css/style.css`：评论区样式（含缩进回复、回复表单）
- `public/css/editor.css` 或新增后台样式：评论管理页表格/tab 样式

## 测试计划

手动测试（当前项目无自动化测试基础设施）：

1. 在文章页提交一条顶层评论 → 确认提示"待审核"，文章页不立即显示该评论。
2. 后台 `/admin/comments` 待审核 tab 能看到该评论，点击「通过」→ 刷新文章页应能看到该评论。
3. 对已通过的顶层评论点击「回复」提交回复 → 后台审核通过后，文章页应在该顶层评论下方看到带"回复 @xxx"前缀的内容。
4. 对一条回复再点击「回复」→ 确认新评论的 `parentId` 指向的是原始顶层评论，而不是这条回复本身（即不会出现二级嵌套）。
5. 校验：昵称或内容为空提交 → 文章页应重新渲染并显示错误信息，且已填内容保留。
6. 同一 IP 短时间内连续提交超过 3 条评论 → 第 4 条应被拒绝并提示"发送太频繁"。
7. 删除一篇有评论的文章 → 确认 `blog.json` 中对应的评论也被移除。
8. 后台删除一条评论 → 文章页对应评论消失。
