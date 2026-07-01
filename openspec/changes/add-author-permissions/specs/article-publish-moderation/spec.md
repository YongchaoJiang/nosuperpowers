## ADDED Requirements

### Requirement: 作者自由发布
系统 SHALL 允许文章作者在没有管理员审批的情况下，自行将自己的文章切换为已发布或未发布状态，前提是该文章当前未被管理员下架。

#### Scenario: 作者发布自己的文章
- **WHEN** 文章作者对自己拥有、且未被管理员下架的文章提交 `POST /dashboard/articles/:id/toggle-publish`
- **THEN** 系统切换该文章的发布状态，不需要任何其他账号审批

### Requirement: 管理员强制下架
系统 SHALL 允许角色为 `'admin'` 的账号对任意文章执行强制下架，下架后文章的发布状态被置为未发布，并标记为"管理员下架"。

#### Scenario: 管理员下架任意文章
- **WHEN** 角色为 `'admin'` 的账号对任意文章提交 `POST /admin/articles/:id/suspend`
- **THEN** 系统将该文章置为未发布，并标记该文章处于管理员下架状态

### Requirement: 下架文章的作者无法自行恢复发布
系统 SHALL 拒绝文章作者对处于管理员下架状态的文章执行发布操作。

#### Scenario: 作者尝试恢复被下架的文章
- **WHEN** 文章作者对处于管理员下架状态的自己的文章提交 `POST /dashboard/articles/:id/toggle-publish`
- **THEN** 系统拒绝该操作，文章保持未发布状态，并提示该文章已被管理员下架

### Requirement: 只有管理员可以恢复被下架的文章
系统 SHALL 仅允许角色为 `'admin'` 的账号将处于管理员下架状态的文章恢复为已发布，恢复后应清除下架标记。

#### Scenario: 管理员恢复被下架的文章
- **WHEN** 角色为 `'admin'` 的账号对处于管理员下架状态的文章提交 `POST /admin/articles/:id/restore`
- **THEN** 系统将该文章置为已发布，并清除管理员下架标记，文章作者此后可以正常自行切换发布状态

#### Scenario: 未下架的文章不受影响
- **WHEN** 文章从未被管理员下架
- **THEN** 该文章的作者始终可以自行切换发布状态，不受本能力任何限制
