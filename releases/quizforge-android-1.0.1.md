# 智题工坊安卓 1.0.1

包名：`cn.quizforge.app`；versionCode：`2`；最低 Android 8.0。

新增「更多 → 账号与密码」设置：用户勾选后在本机加密保存，下次登录自动填入，支持清除，每个服务器分别保存。默认不保存，不自动点击登录，不改变服务器会话有效期。

- 本地安装包：`quizforge-android-1.0.1.apk`。
- SHA256：`59b1aaf45326a29a317f6b0523f31894d2c18fc468fe0c03baf44b5175618b3b`。
- 签名证书 SHA256：`fe0f9c7abd113ae74dc4d73591370764cf14ca897de93cdb21f4d1cdae270df2`，与 1.0.0 相同。
- 在线入口：[安卓下载页](http://49.234.185.199:3080/android/)。

签名 Release、Android Lint、地址与加密测试、4 项自动填入测试和隔离网站冒烟通过。公网 APK 内容哈希一致，版本接口返回 1.0.1，匿名账号请求被拒绝。尚未连接安卓真机验证 Keystore、自动填入或覆盖安装。

现场备份：`/opt/quizforge-backups/android-password-20261019-101`。本次同步限于 App 下载、安装包和版本检测支持；现场其他网页功能保持既有部署基线。详细使用与后续构建见 `docs/ANDROID-APP.md`。
