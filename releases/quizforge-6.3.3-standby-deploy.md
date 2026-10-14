# 智题工坊 6.3.3 部署说明

完整源码包：`quizforge-6.3.3-standby-20261011.zip`，同时提供 `.sha256` 校验文件。升级步骤如下。本说明用于现有 6.2.1 / 6.2.2 / 6.2.3 / 6.2.4 / 6.3.0 / 6.3.1 / 6.3.2 升级；更早版本先核对对应增量迁移。Node.js >=20，沿用原 MySQL、PM2、端口、账号和其他配置。此次无运行依赖或数据库结构变更；新增的 jsdom 仅用于开发测试。

## 本次内容

6.3.3 支持人工修改开始／结束后生成修订方案；原方案和修订版分开查看下载，允许部分覆盖结果导出。FDP 开始仍按四小时边界，FDP MAX 始终取备份开始与 BFTM 在 Table A 中的较小值；往返 14 小时／过夜 9 小时上限保留。既有航班配对与人工时段保留，旧分析摘要失效，须重新计算。最新冬季表存在 NX856+855 单组规则冲突，4／5／6 个候选均为 45/46，不宣称全覆盖。

- 实用工具下拉菜单分别打开航班时刻表 `/flights` 与备份方案 `/flights/standby`，页面内不重复放大导航按钮。
- PDF 提取后人工选择去程、当天／过夜、回程及开会时间；可以添加同一去程的另一回程备选。确认版本后才进行备份分析，修改时刻表后需重新确认。
- 按 Table A、四小时算法及独立总时长上限逐分钟搜索，比较原方案及 4／5／6 个备份。数量不足时继续寻找扩展全覆盖方案；规则冲突保留全部任务与原因。支持自定义时段、逐航班 FDP buffer 和明确的全覆盖状态。
- 网页下载航班 Excel、备份方案 Word 和 FDP buffer Excel。计算原理、操作步骤和边界详见 `STANDBY-GUIDE.md`。
- 管理航班表可以删除旧版本并在 7 天内恢复，过期回收站自动清理；上传原文件解析后删除，异常退出残留超过 24 小时会清理。每账号最多 50 份、单份 1.5 MB，不自动删除正常草稿。
- 登录页改为宽版，右上角账号采用头像与菜单，退出收进菜单；保留 HTTP UUID 兼容修复。

草稿写入 `DATA_DIR/flight-drafts/`，默认是应用目录的 `data/flight-drafts/`。**使用 MySQL 也必须保留、持久化并备份这个文件目录，并确保 Web 进程有写权限。** 沿用单 Web 实例；不要启动第二个连接同一业务数据库的测试 Web。旧浏览器会话草稿可在相同账号和原浏览器中进入航班页后迁移；不要在迁移前清理浏览器会话。

包内不含 `.env`、账号凭据、业务数据、上传文件、用户 PDF、node_modules 或数据库备份。部署包不会自动部署服务器。

## 升级现有服务器

先用 `pm2 describe quizforge-web` 核对项目目录、进程名称和原来运行的 Worker。以下以 `/opt/quizforge`、`quizforge-web` 为例；若实际不同，替换后再执行。不要操作其他项目或原 8501 服务。

1. 上传 ZIP 和 `.sha256`，校验并解压至新目录，暂不启动 Web：

```bash
set -euo pipefail
sha256sum -c quizforge-6.3.3-standby-20261011.zip.sha256
test ! -e /opt/quizforge-6.3.3-stage
mkdir /opt/quizforge-6.3.3-stage
unzip quizforge-6.3.3-standby-20261011.zip -d /opt/quizforge-6.3.3-stage
cd /opt/quizforge-6.3.3-stage
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
test ! -e /opt/quizforge-before-6.3.3-20261011
cp -a /opt/quizforge /opt/quizforge-before-6.3.3-20261011
# MySQL 和外部数据目录的备份完成后继续。
cp -a /opt/quizforge/.env /opt/quizforge-6.3.3-stage/.env
chmod 600 /opt/quizforge-6.3.3-stage/.env
if [ -d /opt/quizforge/data ]; then cp -a /opt/quizforge/data /opt/quizforge-6.3.3-stage/; fi
if [ -d /opt/quizforge/uploads ]; then cp -a /opt/quizforge/uploads /opt/quizforge-6.3.3-stage/; fi
# 外部绝对路径沿用原配置，确认原 Web 运行用户仍可写 DATA_DIR。
test ! -e /opt/quizforge-prev-6.3.3
mv /opt/quizforge /opt/quizforge-prev-6.3.3
mv /opt/quizforge-6.3.3-stage /opt/quizforge
cd /opt/quizforge
pm2 restart quizforge-web --update-env
# 仅恢复原来运行的 Worker：pm2 restart quizforge-worker --update-env
pm2 save
```

从 6.2.1 / 6.2.2 / 6.2.3 升级无需运行数据库迁移。保留原进程配置，不修改原账号密码。

## 上线验收

- 原端口 `/api/health` 返回 `version: "6.3.3"`；原 MySQL 部署应仍返回 `database: "mysql"`。
- 浏览器强制刷新（Windows：Ctrl+F5）。通过原 HTTP/IP 地址登录，打开航班页并导入 PDF，应不再出现 UUID 报错。顶部导航、原题库与历史记录正常；考研英语和雅思各自的记录、错题筛选不混入其他方向。
- 上传同类文本 PDF。核对原文班期和特殊日期；当前解析器适配示例七位班期格式，扫描件需先 OCR。
- 人工确认当天与过夜配对；检查成品表开会时间修改、去回程相邻、九列 Excel、北京时间和跨日标记。
- 保存命名草稿，刷新并退出重新登录后打开草稿；导入新版本后旧草稿仍可打开。确认 `DATA_DIR/flight-drafts` 确实落盘并纳入日常备份。
- 未配对、待核对、班期不交叠、重复日期和回程过早的提示正常。系统不自动决定机组过夜，确认版本后进入备份方案，分别检查原时段、4／5／6 时段及自定义时段。默认四小时规则；核对往返 14 小时／过夜 9 小时总时长限制，正 buffer 的超时任务也不得推荐。旧计算设置首次打开会更新到指定规则，需要重算。下载 Word 与 FDP Excel 核对同一判定。

## 回滚

停止新版 Web 和此前开启的 Worker，保留新版目录和新增数据：

```bash
set -euo pipefail
pm2 stop quizforge-web
# 原来有 Worker 时：pm2 stop quizforge-worker
test ! -e /opt/quizforge-6.3.3-failed
mv /opt/quizforge /opt/quizforge-6.3.3-failed
mv /opt/quizforge-prev-6.3.3 /opt/quizforge
pm2 restart quizforge-web --update-env
# 仅恢复原来运行的 Worker：pm2 restart quizforge-worker --update-env
pm2 save
```

此次无数据库结构变更，通常不需恢复 SQL。6.2.3 可读取现有草稿；6.2.1 / 6.2.2 无法读取服务端航班草稿，新版目录中的 `flight-drafts` 应保留，以便再次升级恢复。JSON 模式、上传文件和升级后新增记录先核对并保留，避免回退到旧目录遗漏新数据；不要直接用旧备份覆盖业务数据库。

## 已验证范围

随包验收报告记录自动测试、本地网页操作、实际 PDF／Excel 及 Word／FDP Excel 验证。生产 MySQL、远端服务器升级及手机真机没有执行。需要在正式服务器按上方步骤保留原配置与业务数据。

回滚到旧版时，旧版不具备备份分析和回程备选功能。保留新版目录内全部 `flight-drafts` 和回收站，避免旧版保存丢失新增字段；不要用旧备份覆盖新业务数据库。
