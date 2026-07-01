## ADDED Requirements

### Requirement: 按归属查看待审核评论
系统 SHALL 在 `GET /dashboard/comments` 只展示当前登录用户拥有的文章下的评论，不展示其他用户文章下的评论。

#### Scenario: 用户查看自己文章下的评论
- **WHEN** 已登录用户访问 `GET /dashboard/comments`
- **THEN** 系统只展示 `authorId` 等于当前用户 id 的文章下的评论

### Requirement: 按归属审核评论
系统 SHALL 只允许用户对自己拥有的文章下的评论执行通过、拒绝或删除操作，拒绝对其他用户文章下评论的操作，即使请求直接指定了评论 id。这里的"通过/拒绝"权限还受 `comment-moderation-override` 能力定义的锁定规则约束——被管理员锁定的评论，即使文章作者拥有该文章，也无法执行通过/拒绝。

#### Scenario: 用户审核自己文章下的评论
- **WHEN** 已登录用户对某条评论提交 `POST /dashboard/comments/:id/approve`、`POST /dashboard/comments/:id/reject` 或 `POST /dashboard/comments/:id/delete`，且该评论所属文章的 `authorId` 等于当前用户 id
- **THEN** 系统执行相应的操作（除非该评论处于管理员锁定状态，见 `comment-moderation-override`）

#### Scenario: 用户尝试审核他人文章下的评论
- **WHEN** 已登录用户对某条评论提交 `POST /dashboard/comments/:id/approve`、`POST /dashboard/comments/:id/reject` 或 `POST /dashboard/comments/:id/delete`，但该评论所属文章的 `authorId` 不等于当前用户 id
- **THEN** 系统拒绝该操作，不改变该评论的状态，即使请求携带了有效的评论 id

### Requirement: 管理员不受归属限制
系统 SHALL 允许角色为 `'admin'` 的账号在 `GET /admin/comments` 查看所有用户文章下的评论，并对任意评论执行通过、拒绝或删除操作，不受文章归属限制。

#### Scenario: 管理员查看全部评论
- **WHEN** 角色为 `'admin'` 的账号访问 `GET /admin/comments`
- **THEN** 系统展示所有文章（不限归属）下的评论

#### Scenario: 管理员审核任意评论
- **WHEN** 角色为 `'admin'` 的账号对任意评论提交 `POST /admin/comments/:id/approve`、`POST /admin/comments/:id/reject` 或 `POST /admin/comments/:id/delete`
- **THEN** 系统执行相应的操作，不受该评论所属文章的归属限制
