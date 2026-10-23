# 雅思工坊安卓 App

当前版本1.0.5（versionCode 6），源码在android/，安装包releases/quizforge-android-1.0.5.apk；包名仍为cn.quizforge.app，同签名可覆盖旧版。最低Android8，目标Android15。联网复用网站账号、题库和语料数据。

## 安装和使用

从服务器/android/下载，按系统提示覆盖安装。新安装默认连接 http://49.234.185.199:3080，升级保留已经选择的服务器。需要更换地址时进入“我的 → 服务器地址”；无法连接时原生错误页仍提供地址恢复入口。登录页支持显示密码，原生App还可主动勾选保存密码；默认关闭，成功登录后才通过Android Keystore加密保存，取消即清除，不同服务器分别保存。网页不保存密码。

学习首页不再重复展示品牌顶栏，保留“词汇／开始学习”、听说读写，以及题库／语料／复习入口。底栏只保留学习／查询／我的：词汇页为 /vocabulary，题库 /banks、语料 /corpus、复习 /review 从首页进入；学习记录和错题集中在复习。查询 /query 在输入前选择英译中或中译英，结果结合本人词库和语料，并支持围绕当前查询继续询问AI。内页显示返回与页面标题。更新、服务器、关于位于“我的”。原生账号密码管理面板、浏览器打开和常驻刷新已删除；登录页不显示“App 设置”，采用米白与深绿的书页网格背景。检测到页面新版后才出现“加载新内容”，保存内容后确认刷新。安装包更新登录后检查并由用户确认，不自动安装。

上传、下载和返回键沿用原实现。HTTP部署沿用现状；App不忽略证书错误。签名与私有配置不得公开。网页发布不会自动更改桌面应用名称，原生控件升级需要覆盖安装1.0.5；网页排版随服务器发布更新。

## 当前验证

2026-10-23 签名 Release、Lint（0问题）、加密、地址与更新提醒策略以及10项DOM测试通过。1.0.5安装包和版本元数据已同步服务器，版本接口返回code6，公网APK哈希核对通过。网页回归147/147和隔离冒烟通过。学习／查询／我的一级页不显示返回，下级页保留；网页个人中心也可查看真实版本与下载入口，App内使用原生更新／服务器／关于。真实手机覆盖安装、Keystore和原生界面未验收。详细发布与回滚见 [本轮记录](STUDY-REDESIGN-20261023.md)。

## 本地构建

使用 JDK 17、Android SDK Platform 35、Build Tools 35.0.0，项目自带 Gradle 8.11.1 wrapper，插件版本为 AGP 8.9.2。兼容性参见 [Android 官方发布说明](https://developer.android.com/build/releases/agp-8-9-0-release-notes)。首次在新机器上构建需要联网下载 Gradle 和构建依赖；依赖已就绪时可加 `-Offline`。

```powershell
./scripts/build-android.ps1 -JavaHome '你的JDK17目录' -AndroidSdk '你的AndroidSDK目录'
```

构建脚本同时执行 Release 构建、Android Lint、服务器地址/同源/下载/更新链接策略测试、密码加密与服务器隔离测试，并用 `apksigner` 验证签名；成功后输出 APK 和 SHA256 文件。自动填入、登录与账号菜单的 DOM 行为通过 `node --test android/autofill.test.js android/app-controls.test.js` 验证；构建还运行登录后更新提醒与去重策略测试。脚本拒绝覆盖已有同版本交付包。

第一次构建会创建专用签名密钥 `android/.signing/quizforge-release.jks` 和 `android/signing.properties`。**应将这两项一起安全备份，后续 APK 必须沿用；丢失后无法给已安装 App 做同包覆盖升级。** 两项和本机 SDK 路径均被 Git 忽略，不进入 Web 发布包，也不能公开上传到服务器下载目录。

## 发布下载页及安装包更新

先构建并验证 APK，再暂存到本地网站公开目录：

```powershell
# 当前进程需通过 JAVA_HOME 使用 JDK 17。
./scripts/stage-android-release.ps1 -Apk 'releases/quizforge-android-1.0.5.apk' -VersionCode 6 -VersionName '1.0.5' -AndroidSdk '你的AndroidSDK目录'
```

脚本先验签并用 `aapt` 核对实际包名和版本，再复制到 `public/android/`，最后更新版本 JSON。相同版本的不同内容会被拒绝，不会把元数据发布到尚未复制完成的文件。APK 二进制被 Git 忽略；从 Git 部署时须另行上传已验证的 APK。

发布时需一起包含：

- `src/app-version.js`、修改后的 `src/server.js` 以及其他本次网站源码。
- `public/android/`（含 APK、下载页、脚本和图标）、`public/android-release.json`、修改后的 `public/index.html`。

服务端不存在对应 APK 时，版本接口不向旧 App 宣告该安装包。元数据示例：

```json
{
  "versionCode": 6,
  "versionName": "1.0.5",
  "apkPath": "/android/quizforge-android-1.0.5.apk"
}
```

完整部署后重启**已核实的 QuizForge Web 进程**。不迁移数据库，不修改原 8501 服务。沿用项目现有备份与发布流程。服务启动后检查 `/api/app-version`、`/android/` 和元数据指向的 APK 都可获取。

## 历史发布与验收

以下仅记录已发生的历史版本操作，不代表1.0.5的服务器发布状态。

2026-10-19 现场为 `/opt/quizforge`、systemd `quizforge.service`、端口 `3080`。本次先备份代码及私有配置到 `/opt/quizforge-backups/android-password-20261019-101`，再同步 App 支持所需的 8 个文件；现场 `server.js` 仅补入版本接口，首页仅补下载入口。没有将本地其他历史功能改版整体覆盖到服务器。`quizforge-worker.service` 保持运行。公网下载页面、APK 哈希、版本接口、匿名访问限制及原 8501 监听均已核验。

### 历史验证范围

本地完成签名 Release 编译、Android Lint（0 问题）、链接策略与加密测试、4 项自动填入行为测试、版本接口回归及隔离数据冒烟。2026-10-22 已在独立 Android 15 模拟设备安装并启动 1.0.2，但画面验收被用户 Esc 中断，未完成保存、恢复及覆盖升级的端到端验收；手机上的 Keystore 保存/读取、自动填入、软键盘/手势区域、文件上传下载和两版 APK 覆盖升级仍需手机验收。服务器 App 下载入口已部署，已核实 MySQL Web 健康状态和匿名访问限制；没有用生产账号进行写入测试。


2026-10-22 发布、清理和验收状态以 [本次记录](LOGIN-APP-20261022.md) 为准；上面的 2026-10-19 记录是历史发布结果。

2026-10-22 App 1.0.3 单顶栏、登录后更新与发布状态以 [本次记录](APP-HEADER-20261022.md) 为准；此前的 APK 和验收记录保留供历史回滚。

历史1.0.4的发布和验证状态见 [雅思工坊记录](IELTS-APP-20261023.md)。该版本采用过五项底栏与登录服务器设置，已由本轮三项底栏与无登录设置方案取代，历史APK保留供回滚。当前1.0.5验证详情见 [发布说明](../releases/quizforge-android-1.0.5.md)，服务器最终发布状态以 README 为准。
