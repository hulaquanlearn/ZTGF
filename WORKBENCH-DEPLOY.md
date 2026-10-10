# 智题工坊 6.2.3 部署说明

完整源码包：`quizforge-6.2.3-workbench-20261010.zip`。本说明用于现有 6.2.1 / 6.2.2 升级；更早版本先核对对应增量迁移。Node.js >=20，沿用原 MySQL、PM2、端口、账号和其他配置。此次无新增依赖或数据库结构变更。

## 本次内容

- 取消固定侧栏，改为顶部导航，移除账号设置入口；英语模块默认考研词汇。
- 学习记录和错题本放入对应模块，支持方向、题库、专项筛选。雅思记录汇总写作与口语复盘。
- 航班列表与人工回程配对工作台，默认整季，可切换当日；人工选择当天/过夜与天数。开会时间人工填写，表头使用离港时间、到港时间，Excel 主表仍为九列。
- 草稿命名、自动保存、重新打开、新导入保留旧版本；配对日期冲突校验和多窗口修订保护。

草稿写入 `DATA_DIR/flight-drafts/`，默认是应用目录的 `data/flight-drafts/`。**使用 MySQL 也必须保留、持久化并备份这个文件目录，并确保 Web 进程有写权限。** 沿用单 Web 实例；不要启动第二个连接同一业务数据库的测试 Web。旧浏览器会话草稿可在相同账号和原浏览器中进入航班页后迁移；不要在迁移前清理浏览器会话。

包内不含 `.env`、账号凭据、业务数据、上传文件、用户 PDF、node_modules 或数据库备份。部署包不会自动部署服务器。

## 升级现有服务器

先用 `pm2 describe quizforge-web` 核对项目目录、进程名称和原来运行的 Worker。以下以 `/opt/quizforge`、`quizforge-web` 为例；若实际不同，替换后再执行。不要操作其他项目或原 8501 服务。

1. 上传 ZIP 和 `.sha256`，校验并解压至新目录，暂不启动 Web：

```bash
set -euo pipefail
sha256sum -c quizforge-6.2.3-workbench-20261010.zip.sha256
test ! -e /opt/quizforge-6.2.3-stage
mkdir /opt/quizforge-6.2.3-stage
unzip quizforge-6.2.3-workbench-20261010.zip -d /opt/quizforge-6.2.3-stage
cd /opt/quizforge-6.2.3-stage
npm ci --omit=dev
```

2. 在维护窗口停止 Web；原来启用了 Worker 时也停止该 Worker。记录停止前哪些进程在运行。

```bash
pm2 stop quizforge-web
# 原来有 Worker 时：pm2 stop quizforge-worker
```

3. 停写后备份原应用目录和 MySQL 数据库。数据库使用原有备份流程，不把密码写到命令行。若 `DATA_DIR` / `UPLOAD_DIR` 是外部绝对路径，另行备份对应目录，特别是 `flight-drafts`。确认备份成功后再切换：

```bash
set -euo pipefail
test ! -e /opt/quizforge-before-6.2.3-20261010
cp -a /opt/quizforge /opt/quizforge-before-6.2.3-20261010
# MySQL 和外部数据目录的备份完成后继续。
cp -a /opt/quizforge/.env /opt/quizforge-6.2.3-stage/.env
chmod 600 /opt/quizforge-6.2.3-stage/.env
if [ -d /opt/quizforge/data ]; then cp -a /opt/quizforge/data /opt/quizforge-6.2.3-stage/; fi
if [ -d /opt/quizforge/uploads ]; then cp -a /opt/quizforge/uploads /opt/quizforge-6.2.3-stage/; fi
# 外部绝对路径沿用原配置，确认原 Web 运行用户仍可写 DATA_DIR。
test ! -e /opt/quizforge-prev-6.2.3
mv /opt/quizforge /opt/quizforge-prev-6.2.3
mv /opt/quizforge-6.2.3-stage /opt/quizforge
cd /opt/quizforge
pm2 restart quizforge-web --update-env
# 仅恢复原来运行的 Worker：pm2 restart quizforge-worker --update-env
pm2 save
```

从 6.2.1 / 6.2.2 升级无需运行数据库迁移。保留原进程配置，不修改原账号密码。

## 上线验收

- 原端口 `/api/health` 返回 `version: "6.2.3"`；原 MySQL 部署应仍返回 `database: "mysql"`。
- 浏览器强制刷新。原账号登录，顶部导航、原题库与历史记录正常；考研英语和雅思各自的记录、错题筛选不混入其他方向。
- 上传同类文本 PDF。核对原文班期和特殊日期；当前解析器适配示例七位班期格式，扫描件需先 OCR。
- 人工确认当天与过夜配对；检查成品表开会时间修改、去回程相邻、九列 Excel、北京时间和跨日标记。
- 保存命名草稿，刷新并退出重新登录后打开草稿；导入新版本后旧草稿仍可打开。确认 `DATA_DIR/flight-drafts` 确实落盘并纳入日常备份。
- 未配对、待核对、班期不交叠、重复日期和回程过早的提示正常。系统不自动决定机组过夜，不计算法规或备份执勤时间。

## 回滚

停止新版 Web 和此前开启的 Worker，保留新版目录和新增数据：

```bash
set -euo pipefail
pm2 stop quizforge-web
# 原来有 Worker 时：pm2 stop quizforge-worker
test ! -e /opt/quizforge-6.2.3-failed
mv /opt/quizforge /opt/quizforge-6.2.3-failed
mv /opt/quizforge-prev-6.2.3 /opt/quizforge
pm2 restart quizforge-web --update-env
# 仅恢复原来运行的 Worker：pm2 restart quizforge-worker --update-env
pm2 save
```

此次无数据库结构变更，通常不需恢复 SQL。旧版本无法读取新版服务端航班草稿，但新版目录中的 `flight-drafts` 应保留，以便再次升级恢复。JSON 模式、上传文件和升级后新增记录先核对并保留，避免回退到旧目录遗漏新数据；不要直接用旧备份覆盖业务数据库。

## 已验证范围

60 项源码测试、隔离本地功能验收，实际 PDF 提取 104 条、人工当天/次日配对、开会时间修改与保存恢复、模块内导航、390px 手机布局、浏览器下载九列 XLSX。最终部署包的独立安装及检查结果见随包提供的验收报告。生产 MySQL、远端服务器升级和手机真机尚未验证。
