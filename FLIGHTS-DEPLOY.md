# 智题工坊 6.2.2 航班时刻表部署说明

适用于现有 6.2.1 智题工坊升级。完整源码包：`quizforge-6.2.2-flights-20261010.zip`。Node.js >=20，沿用原 MySQL、PM2、端口和独立账号配置。包内不含 `.env`、运行数据、上传文件、私人 PDF、node_modules 或数据库备份。

## 本次变更

侧栏“实用工具 → 航班时刻表”，地址 `/flights`。上传文本 PDF，人工选择去回程及当天/过夜，人工填写开会时间，预览并导出九列 Excel。草稿仅保存在当前浏览器会话，没有新增数据库表，不需为此次航班功能执行数据库迁移。复用 pdf-parse 和 ExcelJS，没有新增依赖。不计算机组法规、执勤或备份时间。

## 升级现有服务器

先通过 `pm2 describe quizforge-web` 核对实际工作目录和进程名。以下以 `/opt/quizforge`、`quizforge-web` 为例；实际不同时先替换。不要操作其他项目或原 8501 服务。旧版低于 6.2.1 时，先按对应版本的增量迁移说明处理；本指南不用于跨多个历史版本直接覆盖。

1. 上传 ZIP 和对应 `.sha256`，在同一目录校验：

```bash
sha256sum -c quizforge-6.2.2-flights-20261010.zip.sha256
```

2. 解压到新目录并安装依赖，暂不启动新 Web：

```bash
set -euo pipefail
test ! -e /opt/quizforge-6.2.2-stage
mkdir /opt/quizforge-6.2.2-stage
unzip quizforge-6.2.2-flights-20261010.zip -d /opt/quizforge-6.2.2-stage
cd /opt/quizforge-6.2.2-stage
npm ci --omit=dev
```

3. 在维护窗口停止已核实的智题工坊 Web；若 Worker 正在运行，也停止它。保留停止前进程清单，升级后恢复原先运行的进程。以下示例假设只有 Web；有 Worker 时另外执行 `pm2 stop quizforge-worker`。

```bash
pm2 stop quizforge-web
```

4. 停写后备份原应用目录与数据库。若为 MySQL，使用当前数据库名并按原备份方式生成 SQL 备份，不把密码写到命令行或聊天。备份成功再继续：

```bash
set -euo pipefail
test ! -e /opt/quizforge-before-6.2.2-20261010
cp -a /opt/quizforge /opt/quizforge-before-6.2.2-20261010
# MySQL 实例另行完成并检查数据库备份；JSON 数据已随原目录备份。
# 将原配置和文件复制到新目录，原数据目录若不存在则跳过。
cp -a /opt/quizforge/.env /opt/quizforge-6.2.2-stage/.env
chmod 600 /opt/quizforge-6.2.2-stage/.env
if [ -d /opt/quizforge/data ]; then cp -a /opt/quizforge/data /opt/quizforge-6.2.2-stage/; fi
if [ -d /opt/quizforge/uploads ]; then cp -a /opt/quizforge/uploads /opt/quizforge-6.2.2-stage/; fi
# DATA_DIR / UPLOAD_DIR 若配置为外部绝对路径，保持原配置和目录。
test ! -e /opt/quizforge-prev-6.2.2
mv /opt/quizforge /opt/quizforge-prev-6.2.2
mv /opt/quizforge-6.2.2-stage /opt/quizforge
cd /opt/quizforge
pm2 restart quizforge-web --update-env
pm2 save
```

如原来启用了 Worker，核对其脚本路径仍为 `/opt/quizforge/src/worker.js` 后恢复 `pm2 restart quizforge-worker --update-env` 并 `pm2 save`。不要额外启动第二个连接同一数据库的 Web。

## 上线验收

- 用原端口请求 `/api/health`，`version` 应为 `6.2.2`，MySQL 部署的 `database` 应为 `mysql`。其他认证与配置保持原值。
- 浏览器强制刷新，原账号登录，题库、成绩、英语、雅思和语料仍可使用。
- 打开“实用工具 → 航班时刻表”，上传同类 PDF，核对班期和特殊有效日期。当前提取器适配示例的七位班期格式，扫描件先 OCR。
- 人工配对当天往返与过夜回程，开会时间可留空或填四位数字。校验班期、重复配对、回程先于去程到达时的错误提示。
- Excel 主表为九列、每组上下相邻、按去程排序；国外机场时间换算为北京时间，跨日用括号标识，过夜回程航班号后加人工选择的天数。
- 刷新页面确认会话草稿恢复；关闭浏览器会话可能丢失草稿，需导出留存。原始信息可人工校正；时区不明时必须填写，页尾游离日期注释必须核对原文。

## 回滚

停止新版 Web 和此前开启的 Worker，保留新版目录，不删除任何业务数据：

```bash
set -euo pipefail
pm2 stop quizforge-web
# 有 Worker 时另外执行 pm2 stop quizforge-worker
test ! -e /opt/quizforge-6.2.2-failed
mv /opt/quizforge /opt/quizforge-6.2.2-failed
mv /opt/quizforge-prev-6.2.2 /opt/quizforge
pm2 restart quizforge-web --update-env
pm2 save
```

原启用 Worker 时按原配置恢复。此次无数据库结构变更，MySQL 通常无需恢复 SQL；JSON 模式或应用内上传在升级后新增的数据应先核对并保留，避免回退到旧目录遗漏新数据。不要未经核对覆盖升级后的数据库。

## 本地验证范围

源码测试 56/56 通过；实际三页 PDF 提取 104 条；浏览器验证人工当天/过夜配对、预览、草稿恢复、Excel 下载和手机尺寸无页面横向溢出。生产 MySQL、手机真机和服务器部署尚未执行。包内 `OPENCLAW-DEPLOY.md` 是历史版本参考，本次从 6.2.1 升级以本说明为准。
