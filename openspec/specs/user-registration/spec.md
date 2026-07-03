# user-registration Specification

## Purpose

TBD - created by archiving change add-user-registration. Update Purpose after archive.

## Requirements

### Requirement: 注册表单
系统 SHALL 在 `GET /register` 提供一个公开可访问的注册页面，页面包含邮箱和密码的表单。

#### Scenario: 访客打开注册页面
- **WHEN** 未登录的访客访问 `GET /register`
- **THEN** 系统渲染出一个包含邮箱、密码输入框和提交按钮的表单

### Requirement: 邮箱格式校验
系统 SHALL 拒绝邮箱字段缺失或格式不合法的注册提交。

#### Scenario: 缺少邮箱
- **WHEN** 访客提交 `POST /register` 且没有填写邮箱
- **THEN** 系统不创建账号，并重新渲染表单，展示"邮箱为必填项"的错误提示

#### Scenario: 邮箱格式不正确
- **WHEN** 访客提交 `POST /register` 且邮箱值不是合法的邮箱格式（例如 `not-an-email`）
- **THEN** 系统不创建账号，并重新渲染表单，展示"邮箱格式不正确"的错误提示

### Requirement: 密码最小长度
系统 SHALL 拒绝密码缺失或短于最小要求长度的注册提交。

#### Scenario: 缺少密码
- **WHEN** 访客提交 `POST /register` 且没有填写密码
- **THEN** 系统不创建账号，并重新渲染表单，展示"密码为必填项"的错误提示

#### Scenario: 密码过短
- **WHEN** 访客提交 `POST /register` 且密码长度短于配置的最小长度
- **THEN** 系统不创建账号，并重新渲染表单，展示"密码过短"的错误提示

### Requirement: 邮箱唯一性校验
系统 SHALL 拒绝邮箱已被现有账号占用的注册提交，且不区分该邮箱冲突的对象是管理员账号还是公开账号。

#### Scenario: 邮箱重复
- **WHEN** 访客提交 `POST /register` 且该邮箱已存在于 `users` 集合中
- **THEN** 系统不创建新账号，并重新渲染表单，展示"该邮箱已被注册"的错误提示

### Requirement: 密码存储
系统 SHALL 在创建账号时只存储密码的哈希值，绝不存储明文密码。

#### Scenario: 注册成功后密码被哈希存储
- **WHEN** 访客提交了一个合法、唯一的邮箱以及满足最小长度要求的密码
- **THEN** 系统会创建一条新的用户记录，其密码字段是提交密码的 bcrypt 哈希值，而不是明文值

### Requirement: 公开账号角色隔离
系统 SHALL 为新注册账号标记一个与管理员角色不同的公开用户角色，且 SHALL NOT 让此类账号访问管理员专属路由。

#### Scenario: 新账号不是管理员
- **WHEN** 访客成功注册一个新账号
- **THEN** 创建出的用户记录中的角色标记为公开用户，而不是管理员

#### Scenario: 公开用户会话无法访问管理后台路由
- **WHEN** 某个请求携带的是通过公开注册建立的会话
- **THEN** 现有认证检查所保护的管理员专属路由会拒绝该请求

### Requirement: 注册频率限制
系统 SHALL 对注册提交应用基于 IP 的频率限制，复用评论提交所使用的同一套限流机制，以降低自动化滥用的风险。

#### Scenario: 超出频率限制
- **WHEN** 同一个 IP 在限流窗口内提交 `POST /register` 的次数超过配置的上限
- **THEN** 系统拒绝该次额外提交、不创建账号，并提示访客稍后再试

### Requirement: 注册后自动登录
系统 SHALL 在注册成功后立即为该访客建立已认证的会话，不需要额外的登录步骤。

#### Scenario: 注册后建立会话
- **WHEN** 访客成功注册一个新账号
- **THEN** 系统建立一个与该新账号关联的会话，该访客在此会话内的后续请求会被视为已认证
