## 1. 数据模型与迁移

- [ ] 1.1 给 `articles` 集合的概念上加 `authorId`（指向 `users.id`）和 `adminSuspended`（布尔值，默认 `false`）两个字段。
- [ ] 1.2 仿照 `role`/`nextCommentId` 的启动补丁模式，新增一段幂等迁移逻辑：遍历 `articles`，把所有没有 `authorId` 的文章的 `authorId` 设为管理员账号的 `id`，`adminSuspended` 补为 `false`。
- [ ] 1.3 新建文章时显式写入 `authorId: req.session.userId` 和 `adminSuspended: false`。
- [ ] 1.4 给 `comments` 集合的概念上加 `userId`（指向 `users.id`）、`adminLocked`（布尔值，默认 `false`）两个字段；`status` 的取值从 `'pending' | 'approved'` 扩展为 `'pending' | 'approved' | 'rejected'`。
- [ ] 1.5 新增一段幂等迁移逻辑：遍历 `comments`，给所有没有 `userId` 的历史评论（匿名+昵称时代提交的）补上 `legacyAnonymous: true`、`adminLocked: false`，保留原有的 `nickname`/`email` 字段不动，不强行伪造 `userId`。
- [ ] 1.6 新提交的评论一律显式写入 `userId: req.session.userId`、`adminLocked: false`，不再写入 `nickname`/`email` 字段。

### 需求对应表

需求 | 对应任务
--- | ---
文章归属 | 1.1、1.2、1.3
作者管理自己的文章 | 2.1-2.5
非作者不能管理他人文章 | 2.6
管理员可以管理任意用户的文章 | 2.6
全局文章监管视图 | 3.1
作者自由发布 | 2.4、2.7
管理员强制下架 | 3.2
下架文章的作者无法自行恢复发布 | 2.7
只有管理员可以恢复被下架的文章 | 3.3
评论提交要求登录 | 4.1、4.2
评论记录关联提交者身份 | 1.4、1.6、4.2
公开展示身份来自账号 | 4.3
按归属查看待审核评论 | 5.1
按归属审核评论 | 5.2、5.3
管理员可以覆盖任意评论的审核结果 | 6.1
管理员执行的拒绝会锁定评论 | 6.1、6.2
锁定的评论只能由管理员恢复 | 5.2、6.2、6.3
非管理员的正常审核不产生锁定 | 5.2
管理员不受归属限制 | 6.1、6.4
查看自己发表过的评论 | 5.4
删除自己发表过的评论 | 5.2、5.5
不能自行批准自己发表的评论 | 5.2、5.6

## 2. `/dashboard` 文章路由（作者本人或管理员）

- [ ] 2.1 新增 `ownerOrAdmin(getOwnerId)` 权限判断辅助函数：`req.session.role === 'admin' || getOwnerId(req) === req.session.userId`，未通过则拒绝请求。
- [ ] 2.2 把 `GET /admin/articles/new`、`POST /admin/articles` 迁移为 `GET /dashboard/articles/new`、`POST /dashboard/articles`，挂 `requireAuth`（任何登录用户都能创建自己的文章）。
- [ ] 2.3 把 `GET /admin/articles/:id/edit`、`POST /admin/articles/:id` 迁移为 `GET /dashboard/articles/:id/edit`、`POST /dashboard/articles/:id`，挂 `ownerOrAdmin`。
- [ ] 2.4 把 `POST /admin/articles/:id/toggle-publish` 迁移为 `POST /dashboard/articles/:id/toggle-publish`，挂 `ownerOrAdmin`。
- [ ] 2.5 把 `POST /admin/articles/:id/delete` 迁移为 `POST /dashboard/articles/:id/delete`，挂 `ownerOrAdmin`（级联删除评论的逻辑保持不变）。
- [ ] 2.6 手动检查/测试：角色为 `'user'` 的账号访问他人文章的 `/dashboard/articles/:id/edit`、`/dashboard/articles/:id/delete` 被拒绝；管理员访问任意用户的这些路径都被允许。
- [ ] 2.7 在 `POST /dashboard/articles/:id/toggle-publish` 里增加检查：如果该文章 `adminSuspended === true`，拒绝该次切换并提示"该文章已被管理员下架，无法自行恢复发布"。

## 3. `/admin` 全局监管路由——文章（仅管理员）

- [ ] 3.1 修改 `GET /admin`：列出所有用户的文章（不再局限于单一作者），每行展示作者信息；确保挂的是"角色必须是 admin"的检查，而不是原来宽松的 `requireAuth`。
- [ ] 3.2 新增 `POST /admin/articles/:id/suspend`（仅管理员）：将目标文章设为 `published: false`、`adminSuspended: true`。
- [ ] 3.3 新增 `POST /admin/articles/:id/restore`（仅管理员）：将目标文章设为 `published: true`、`adminSuspended: false`。
- [ ] 3.4 在 `views/admin/dashboard.ejs`（或其全局监管版本）里，给每篇文章加上"下架"/"恢复"操作入口，按当前 `adminSuspended` 状态显示对应按钮。

## 4. 评论提交（要求登录、记录身份）

- [ ] 4.1 给 `POST /article/:id/comments` 挂 `requireAuth`；未登录访客提交时拒绝，并提示登录/注册入口（可以直接复用 `requireAuth` 现有的重定向逻辑，或针对这个路由单独渲染带提示的文章页）。
- [ ] 4.2 修改评论创建逻辑：写入 `userId: req.session.userId`，去掉原本从请求体读取 `nickname`/`email` 的逻辑。
- [ ] 4.3 修改评论展示逻辑（`views/article.ejs` 及后台评论列表）：展示名称统一取 `users` 中对应账号邮箱 `@` 之前的部分（`legacyAnonymous` 的历史评论继续显示原有 `nickname`）。
- [ ] 4.4 修改 `views/article.ejs` 里的评论表单：移除昵称、邮箱输入框，只保留内容输入（及回复目标的隐藏字段）；未登录时用提示文案替换整个表单，附登录/注册链接。

## 5. `/dashboard/comments`（作者本人的评论审核 + 我发表的评论）

- [ ] 5.1 新增 `GET /dashboard/comments`（默认视图，等价于 `?view=received`）：查询逻辑复用现有 `/admin/comments` 的实现，但增加过滤条件——只统计/展示 `authorId` 等于当前登录用户 id 的文章下的评论。
- [ ] 5.2 新增 `POST /dashboard/comments/:id/approve`、`POST /dashboard/comments/:id/reject`、`POST /dashboard/comments/:id/delete`。权限判断拆成两个独立函数，不要合并：
  - `approve`/`reject`：查出该评论所属文章，校验其 `authorId` 等于当前用户 id（不通过则拒绝，即使评论 id 本身存在）；再额外检查该评论 `adminLocked !== true`，锁定状态下一律拒绝并提示"该评论已由管理员处理"。
  - `delete`：校验当前用户满足以下任一条件——该评论所属文章的 `authorId` 等于当前用户 id，或该评论本身的 `userId` 等于当前用户 id，或当前用户是管理员；三者任一满足即可删除，不受 `adminLocked` 影响。
- [ ] 5.3 手动检查/测试：普通用户尝试直接构造请求审核他人文章下的评论 id，确认被拒绝且评论状态未改变；对自己文章下被管理员锁定的评论执行 approve/reject，确认被拒绝。
- [ ] 5.4 新增 `GET /dashboard/comments?view=mine`：展示 `userId` 等于当前登录用户 id 的所有评论（不限文章归属），列出评论内容、所在文章、当前审核状态，只提供"删除"操作入口。
- [ ] 5.5 手动检查/测试：用户在 `?view=mine` 里能看到并删除自己发表在别人文章下的评论，即使自己不是那篇文章的作者。
- [ ] 5.6 手动检查/测试：用户尝试对自己发表在他人文章下的评论提交 `approve`（例如直接构造请求），确认被拒绝——`delete` 的三方权限判断不能被复用到 `approve`/`reject` 上。

## 6. `/admin/comments`（全局评论监管 + 覆盖锁定）

- [ ] 6.1 确认 `GET /admin/comments`、`POST /admin/comments/:id/approve`、`POST /admin/comments/:id/reject`、`POST /admin/comments/:id/delete` 挂的是"角色必须是 admin"的检查，且查询/操作不做归属过滤。
- [ ] 6.2 `POST /admin/comments/:id/reject` 执行时，无论该评论之前是什么状态，一律设置 `status: 'rejected'`、`adminLocked: true`。
- [ ] 6.3 `POST /admin/comments/:id/approve` 执行时，设置 `status: 'approved'`、`adminLocked: false`（同时承担"批准"和"解除锁定/恢复"两种语义）。
- [ ] 6.4 手动检查/测试：管理员可以审核任意用户文章下的任意评论；管理员对一条已经被作者批准的评论执行 reject，确认状态变为 rejected 且锁定；随后作者尝试 approve/reject 被拒绝；管理员再执行 approve，确认解锁后作者可以恢复正常操作。

## 7. 视图与导航

- [ ] 7.1 新建或改造出面向 `/dashboard` 的文章列表/编辑器视图（可以从现有 `views/admin/dashboard.ejs`、`views/admin/editor.ejs` 复制改造，具体拆法留给实现阶段决定）。
- [ ] 7.2 新建 `/dashboard/comments` 视图（可以从现有 `views/admin/comments.ejs` 复制改造，去掉不属于当前用户的数据展示，新增"拒绝"操作按钮和锁定状态提示），并在页面里加一个"我文章下的评论 / 我发表的评论"的标签切换（对应 `?view=received`/`?view=mine`）；"我发表的评论"视图只展示删除按钮，不展示通过/拒绝按钮。
- [ ] 7.3 更新导航：普通用户登录后能看到指向 `/dashboard` 的入口；管理员导航里同时保留指向 `/dashboard`（管理自己的文章）和 `/admin`（全局监管）两个入口。
- [ ] 7.4 更新 `/admin/comments` 视图：新增"拒绝"操作按钮，被管理员锁定的评论在列表中标注状态。

## 8. 验证

- [ ] 8.1 手动测试：普通用户注册登录后，能在 `/dashboard` 创建、编辑、发布、取消发布、删除自己的文章。
- [ ] 8.2 手动测试：普通用户无法通过直接访问 URL 编辑/删除另一个用户的文章。
- [ ] 8.3 手动测试：管理员在 `/admin` 能看到所有用户的文章并标注作者，能编辑/删除任意用户的文章。
- [ ] 8.4 手动测试完整下架流程：管理员对某篇已发布文章执行下架 → 作者尝试在 `/dashboard` 重新发布被拒绝 → 管理员执行恢复 → 作者此后可以正常自行切换发布状态。
- [ ] 8.5 手动测试：未登录访客访问文章页尝试提交评论，被拒绝并看到登录/注册提示；登录后可以正常提交评论，评论记录关联到该账号。
- [ ] 8.6 手动测试：公开展示的评论显示的是账号邮箱前缀，而不是自由文本昵称；历史匿名评论继续正常显示原有昵称。
- [ ] 8.7 手动测试：普通用户在 `/dashboard/comments` 只能看到并审核（通过/拒绝/删除）自己文章下的评论；管理员在 `/admin/comments` 能看到并审核所有评论。
- [ ] 8.8 手动测试完整评论覆盖流程：作者批准一条评论 → 管理员将其拒绝（锁定）→ 作者尝试重新批准被拒绝 → 管理员重新批准（解锁）→ 作者此后可以正常对该评论执行通过/拒绝。
- [ ] 8.9 手动测试确认迁移逻辑：启动服务后，`blog.json` 里原有的文章记录被自动补上 `authorId`/`adminSuspended`；原有的匿名评论记录被自动补上 `legacyAnonymous: true`/`adminLocked: false`，原有字段不丢失。
- [ ] 8.10 手动测试完整"我发表的评论"流程：用户 A 在用户 B 的文章下发表评论 → A 在 `/dashboard/comments?view=mine` 能看到并删除这条评论 → 重新发表一条 → 确认 A 无法通过直接构造请求批准（approve）这条评论，只有 B（文章作者）或管理员可以。
