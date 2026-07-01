## ADDED Requirements

### Requirement: 管理员可以覆盖任意评论的审核结果
系统 SHALL 允许角色为 `'admin'` 的账号对任意评论（无论当前状态是待审核、已通过还是已拒绝）执行通过或拒绝操作，不受文章作者此前的审核决定限制。

#### Scenario: 管理员拒绝作者已通过的评论
- **WHEN** 角色为 `'admin'` 的账号对一条状态为已通过的评论提交 `POST /admin/comments/:id/reject`
- **THEN** 系统将该评论状态改为已拒绝，不论此前是谁把它标记为已通过

### Requirement: 管理员执行的拒绝会锁定评论
系统 SHALL 在管理员对评论执行拒绝操作后，将该评论标记为管理员锁定状态。

#### Scenario: 管理员拒绝后评论被锁定
- **WHEN** 角色为 `'admin'` 的账号对任意评论提交 `POST /admin/comments/:id/reject`
- **THEN** 该评论被标记为管理员锁定状态，无论该评论此前是待审核还是已通过

### Requirement: 锁定的评论只能由管理员恢复
系统 SHALL 拒绝文章作者对处于管理员锁定状态的评论执行通过或拒绝操作；只有角色为 `'admin'` 的账号可以将锁定的评论重新标记为已通过，并解除锁定状态。

#### Scenario: 作者尝试处理被管理员锁定的评论
- **WHEN** 文章作者对自己文章下、处于管理员锁定状态的评论提交 `POST /dashboard/comments/:id/approve` 或 `POST /dashboard/comments/:id/reject`
- **THEN** 系统拒绝该操作，评论状态和锁定标记均不变，并提示该评论已由管理员处理

#### Scenario: 管理员恢复被锁定的评论
- **WHEN** 角色为 `'admin'` 的账号对处于管理员锁定状态的评论提交 `POST /admin/comments/:id/approve`
- **THEN** 系统将该评论状态改为已通过，并解除管理员锁定状态，此后文章作者可以正常对该评论执行通过/拒绝操作

### Requirement: 非管理员的正常审核不产生锁定
系统 SHALL 在文章作者对自己文章下、未被管理员锁定的评论执行通过或拒绝操作时，保持该评论的管理员锁定状态为否，使作者此后仍能自由改变该评论的状态。

#### Scenario: 作者自行在通过和拒绝之间切换
- **WHEN** 文章作者对自己文章下、从未被管理员处理过的评论多次提交 `POST /dashboard/comments/:id/approve` 或 `POST /dashboard/comments/:id/reject`
- **THEN** 系统正常执行每一次状态切换，且该评论的管理员锁定状态始终为否
