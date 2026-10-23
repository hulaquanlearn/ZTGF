# 2026-10-20 界面更新与验收

## 范围

- 登录页重新排版：桌面双栏、手机单栏；浅绿与米白、明确的输入区和提交按钮，移除小猫与背景动效。
- 首页学习主视觉、四个学习卡片、两个工作入口；共享字体、表单、留白和卡片统一。
- 手机固定底部快捷导航，登录页与专注答题时隐藏，当前模块高亮。
- 保持网站 6.3.3、安卓 1.0.1；账号、数据、鉴权与业务 API 不变。原生工具栏及安装包不在此次改动范围。

## 设计参考

阅读了 [shadcn/ui login-04 页面](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/blocks/login-04/page.tsx) 与 [表单源码](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/blocks/login-04/components/login-form.tsx)，参考其响应式分栏、表单分组和固定内容宽度；本项目自行实现原生 HTML/CSS，不引入 React、组件依赖、第三方登录或注册入口，插画为 CSS 绘制。

## 生产基线与发布方法

2026-10-20 通过已记录、严格验证主机密钥的 SSH 核实 `/opt/quizforge`、systemd `quizforge.service`、Node v22.23.1、3080 监听、MySQL relational-v6；Worker 当时 active。原 8501 服务不在操作范围。

生产前端缺少本地后续数据管理等功能，不将本地 workspace.js 直接覆盖到生产。`scripts/prepare-ui-refresh.mjs` 校验生产 `index.html` 与 `workspace.js` 的 SHA256，拷贝新版登录、首页，给导航添加移动高亮和登录隐藏；生成后反向还原三处替换，逐字比对其余源码与生产基线一致。保留生产的其他页面和业务逻辑。

发布清单共 8 项：`index.html`、`workspace.js`、`redesign.css`、`login.css`、`theme.css`、`navigation-layout.css`、`home.css`、`common-controls.css`。新增样式使用独立查询版本 `20261020-workspace`。先上传暂存目录，备份现场 public、私有配置与服务配置，复制样式和 JS 后最后替换 index；仅重启 Web 以刷新前端修订号。保留服务器安卓下载文件、数据库和上传文件，Worker 不重启。

## 验证

- 本地 156/156 测试、隔离 JSON 数据冒烟通过。
- 1280px 桌面与 390px 手机浏览器，检查登录、首页、题库与英语；登录失败提示、密码显示切换、登录成功与底部导航正常，无横向溢出。
- 生产基线合入版本另在 3092 本地端口预览，API 仅转发到本地隔离测试数据。错误密码提示、成功登录、首页、移动导航与宽度检查通过。
- 最终生产基线预览截图保留在本地 `.verification/visual-20261020/login-desktop.jpg` 与 `login-mobile.jpg`；桌面修正了旧样式 `place-items:center` 导致的品牌区收窄，最终公网 CSS 哈希已重新核验。
- 安卓 DOM 自动填入 `node --test android/autofill.test.js` **4/4** 通过；真机 WebView、键盘弹起、系统字体放大未验收。

## 现场结果

已发布到 `http://49.234.185.199:3080`，只重启 `quizforge.service`；Web、Worker 均 active，健康检查仍为 MySQL relational-v6 / 6.3.3 / deterministic-only。

回滚副本：`/opt/quizforge-backups/ui-refresh-20261020-01`，包含旧 public、现场私有配置和 systemd Web 定义。暂存文件位于 `/opt/quizforge-ui-20261020-01`，其 `SHA256SUMS` 为本次 8 个文件的验收清单。线上 HTML/JS 与本地完整源码不同，这是保留原有线上业务基线的有意结果；不要后续误用本地 workspace.js 整文件覆盖。

已通过服务器本机实际账号登录、只读题库及答卷接口检查、登出、匿名访问 401；公网 HTTP 获取登录页和全部 8 个文件，逐项 SHA256 与发布清单一致。前端修订号已改变，安卓版本信息与发布前完全一致。内嵌浏览器打开公网页面时超时，未将本地截图当作公网浏览器验收；公网显示依据相同资源哈希与本地生产基线预览，手机真机仍待用户验收。

仅界面文件变化，没有数据库迁移、依赖安装、Git 提交／推送或 APK 发布。需要回滚时先核实当前目录仍为 `/opt/quizforge`、服务仍指向该目录，再从上述副本恢复本次覆盖的已有文件并移除本次新增的样式；仅重启 Web，核验健康及原登录页。不得恢复数据库或覆盖上传文件。
