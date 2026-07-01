## ADDED Requirements

### Requirement: 文章归属
系统 SHALL 为每篇文章记录一个作者（`authorId`），指向创建该文章的用户账号。

#### Scenario: 新建文章自动归属当前用户
- **WHEN** 已登录用户通过 `POST /dashboard/articles` 创建一篇新文章
- **THEN** 系统创建的文章记录中 `authorId` 等于该用户的账号 id

### Requirement: 作者管理自己的文章
系统 SHALL 允许一篇文章的作者创建、编辑、删除该文章，且不需要任何其他账号审批。

#### Scenario: 作者编辑自己的文章
- **WHEN** 文章作者访问 `GET /dashboard/articles/:id/edit` 或提交 `POST /dashboard/articles/:id`，且该文章的 `authorId` 等于当前登录用户 id
- **THEN** 系统允许查看/更新该文章内容

#### Scenario: 作者删除自己的文章
- **WHEN** 文章作者提交 `POST /dashboard/articles/:id/delete`，且该文章的 `authorId` 等于当前登录用户 id
- **THEN** 系统删除该文章（及其级联的评论）

### Requirement: 非作者不能管理他人文章
系统 SHALL 拒绝非管理员、且不是文章作者本人的用户对该文章执行编辑或删除操作。

#### Scenario: 非作者尝试编辑他人文章
- **WHEN** 一个角色为 `'user'` 的登录用户访问 `GET /dashboard/articles/:id/edit` 或提交 `POST /dashboard/articles/:id`，但该文章的 `authorId` 不等于当前用户 id
- **THEN** 系统拒绝该请求，不返回或修改文章内容

#### Scenario: 非作者尝试删除他人文章
- **WHEN** 一个角色为 `'user'` 的登录用户提交 `POST /dashboard/articles/:id/delete`，但该文章的 `authorId` 不等于当前用户 id
- **THEN** 系统拒绝该请求，不删除文章

### Requirement: 管理员可以管理任意用户的文章
系统 SHALL 允许角色为 `'admin'` 的账号对任意用户的文章执行创建、编辑、删除操作，不受 `authorId` 限制。

#### Scenario: 管理员编辑他人文章
- **WHEN** 角色为 `'admin'` 的账号访问 `GET /dashboard/articles/:id/edit` 或提交 `POST /dashboard/articles/:id`，无论该文章的 `authorId` 是谁
- **THEN** 系统允许查看/更新该文章内容

#### Scenario: 管理员删除他人文章
- **WHEN** 角色为 `'admin'` 的账号提交 `POST /dashboard/articles/:id/delete`，无论该文章的 `authorId` 是谁
- **THEN** 系统删除该文章（及其级联的评论）

### Requirement: 全局文章监管视图
系统 SHALL 在 `GET /admin` 为管理员提供一个展示所有用户文章的列表，包含每篇文章的作者信息，且该列表仅管理员可访问。

#### Scenario: 管理员查看全局文章列表
- **WHEN** 角色为 `'admin'` 的账号访问 `GET /admin`
- **THEN** 系统展示所有用户（不限归属）的文章列表，并标注每篇文章的作者

#### Scenario: 非管理员无法访问全局文章列表
- **WHEN** 角色为 `'user'` 的账号访问 `GET /admin`
- **THEN** 系统拒绝该请求，不展示任何文章列表
