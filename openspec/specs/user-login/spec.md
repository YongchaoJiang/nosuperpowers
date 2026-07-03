# user-login Specification

## Purpose

TBD - created by archiving change add-user-registration. Update Purpose after archive.

## Requirements

### Requirement: 通用登录路由
系统 SHALL 在 `GET /admin/login` 提供一个供所有账号类型（管理员和注册用户）使用的登录页面，且 `POST /admin/login` SHALL 对任意角色的账号执行相同的凭证校验逻辑。

#### Scenario: 已登录用户访问登录页
- **WHEN** 一个已建立会话的用户（无论角色）访问 `GET /admin/login`
- **THEN** 系统将其重定向到该角色对应的落地页，而不是再次展示登录表单

### Requirement: 凭证校验
系统 SHALL 根据提交的邮箱/用户名和密码在 `users` 集合中查找匹配记录，并用 bcrypt 校验密码哈希；缺失字段或校验失败时 SHALL 拒绝登录并展示统一的错误提示，不区分是账号不存在还是密码错误。

#### Scenario: 未填写凭证
- **WHEN** 提交 `POST /admin/login` 且邮箱/用户名或密码字段为空
- **THEN** 系统不建立会话，重新渲染登录页并提示需要填写完整凭证

#### Scenario: 账号不存在或密码错误
- **WHEN** 提交 `POST /admin/login` 且找不到匹配账号，或密码与存储的哈希不一致
- **THEN** 系统不建立会话，重新渲染登录页并展示统一的"账号或密码错误"提示

#### Scenario: 凭证正确
- **WHEN** 提交 `POST /admin/login` 且邮箱/用户名和密码与某条 `users` 记录匹配
- **THEN** 系统建立会话（写入该账号的 `userId`、`role` 等信息）

### Requirement: 按角色跳转
系统 SHALL 在登录成功后，根据该账号的 `role` 决定跳转目标：管理员跳转到管理后台，公开用户跳转到网站首页。

#### Scenario: 管理员登录成功
- **WHEN** `role` 为 `'admin'` 的账号登录成功
- **THEN** 系统重定向到 `/admin`

#### Scenario: 公开用户登录成功
- **WHEN** `role` 为 `'user'` 的账号登录成功
- **THEN** 系统重定向到网站首页 `/`

### Requirement: 登录频率限制
系统 SHALL 对登录尝试应用与注册共用的基于 IP 的频率限制机制，以降低暴力破解密码的风险。

#### Scenario: 登录尝试超出频率限制
- **WHEN** 同一个 IP 在限流窗口内提交 `POST /admin/login` 的次数超过配置的上限
- **THEN** 系统拒绝该次登录尝试，不校验凭证，并提示访客稍后再试
