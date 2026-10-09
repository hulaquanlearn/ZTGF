# QuizForge 6.1 · OpenClaw 服务器执行说明

目标：在 49.234.185.199 的独立端口运行新版，自定义题库、英语和雅思共用一个账号体系。沿用 Node.js + MySQL + PM2。示例目录 /opt/quizforge，端口 3080；先根据 pm2 describe 核实实际路径。不得改动现有 8501 服务。

## 1. 安装前核对

检查 node -v（需 >=20）、npm、MySQL、PM2、unzip、ss -lntp。在数据库执行 SELECT VERSION()；后台自动生成 Worker 使用 SKIP LOCKED，需要 MySQL 8.0+。若服务器仍为 MySQL 5.7，先不启用 Worker，升级数据库需另行备份和确认。确认 3080 和临时验收端口 3081 空闲，识别旧 QuizForge 进程名称和工作目录。不要启动两个连接同一数据库的 Web 实例做写入测试。

将 quizforge-v6.1-openclaw-node-mysql.zip 放到服务器。以有权写 /opt 的部署账号执行：

```bash
set -euo pipefail
test ! -e /opt/quizforge-v6.1-new
test ! -e /opt/quizforge-prev-v6.1
mkdir /opt/quizforge-v6.1-new
unzip quizforge-v6.1-openclaw-node-mysql.zip -d /opt/quizforge-v6.1-new
cd /opt/quizforge-v6.1-new
npm ci --omit=dev
```

发布包不应含 .env、node_modules、data、uploads、tmp、SQL 备份或私人文档。

## 2. 配置与数据库

升级时复制旧 .env；首次安装从 .env.example 复制，并填写：

```dotenv
PORT=3080
HOST=0.0.0.0
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=quizforge
DB_USER=quizforge_app
DB_PASSWORD=现场数据库密码
APP_USERNAME=你的账号
APP_PASSWORD=首次创建账号的强密码
SESSION_HOURS=12
TRANSLATION_PROVIDER=openclaw
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=服务器已有Token
OPENCLAW_TRANSLATION_AGENT=openclaw/quizforge-translator
OPENCLAW_QUESTION_AGENT=openclaw/quizforge-question
```

chmod 600 .env。升级可暂时沿用 ADMIN_USERNAME / ADMIN_PASSWORD，程序会将这个初始账号用于学习与建题；它不再拥有独立管理员角色。账号已存在时，环境变量不会覆盖数据库里的密码。出现同名账号时先核对归属再迁移，勿强行重置。

首次安装时，在 MySQL 中建立 utf8mb4 数据库和仅访问 quizforge.* 的专用账号，授权 SELECT、INSERT、UPDATE、DELETE、CREATE、ALTER、INDEX、REFERENCES。已有账号保持现有密码和授权。

实时翻译和资料自动生成继续使用服务器已有 OpenClaw Gateway 的 /v1/chat/completions 接口；若 Gateway 未启用该接口，按服务器已安装版本的文档启用并做中英翻译测试。Token 不打印到聊天。没有配置 OpenClaw 时，文件中的题目提取、本地词典、随机组卷和标准答案判分仍可使用。旧 DOC 的备用解析需要服务器安装 LibreOffice。

## 3. 停旧服务与备份

依赖安装完成后安排维护窗口，停止**已核实属于 QuizForge**的 Web 和 Worker。常见名称是 quizforge-web、quizforge-worker 或旧 quizforge。不要按端口批量杀进程。

```bash
mkdir -p /opt/backups/quizforge-v6.1
# 以下两项按旧实例是否存在执行；应用目录备份与 SQL 备份都必须成功。
cp -a /opt/quizforge /opt/backups/quizforge-v6.1/app
mysqldump --single-transaction --routines --triggers -u root -p quizforge > /opt/backups/quizforge-v6.1/before-v6.1.sql
test -s /opt/backups/quizforge-v6.1/before-v6.1.sql
```

若备份路径已存在，先换用一个新的备份目录，不要覆盖原备份。首次安装可以跳过旧目录备份，数据库不存在时先建库。

把旧 data、uploads 复制到暂存目录以保留原文件；MySQL 业务数据不在发布包中。原为 JSON 存储的实例可在设置新 MySQL 后执行：
`npm run import:legacy-json -- /opt/quizforge/data/quizforge.json`。
此导入保留账号、题库、答卷、词条、生词本、复习进度、译文和笔记，忽略旧登录会话。

## 4. 增量迁移和切换

```bash
cd /opt/quizforge-v6.1-new
npm run db:migrate
npm run db:check
# 升级时执行；首次安装 /opt/quizforge 不存在则跳过第一条 mv。
test ! -e /opt/quizforge-prev-v6.1
mv /opt/quizforge /opt/quizforge-prev-v6.1
mv /opt/quizforge-v6.1-new /opt/quizforge
cd /opt/quizforge
# 删除已停止的旧 QuizForge PM2 定义，再从新目录启动（仅处理已核实的名称）。
pm2 start ecosystem.config.cjs --only quizforge-web
pm2 save
curl --fail http://127.0.0.1:3080/api/health
```

健康检查应显示 version 6.1.0、database mysql、gradingMode deterministic-only。db:migrate 是增量迁移：新增题库分类、词条归属、答卷草稿、学习笔记等，不删除旧数据。初始账号接管旧无归属题库；其他账号继续保留自己的私人资料。学习种子只为每个账号添加一次，删除后不会在下次登录时重新出现。

仅在 MySQL 8.0+ 且需要后台资料自动生成时，再执行 `pm2 start ecosystem.config.cjs --only quizforge-worker` 和 `pm2 save`。常规带答案题库导入、组卷、本地词典和实时翻译不依赖 Worker。

## 5. 验收

1. 使用原账号登录，能在同一界面上传、建题、改题、分类和练习；没有管理员入口。
2. 建“软考 / 系统集成”分类，上传带答案 PDF，预览残缺题目后确认入库。指定单选/多选/判断/填空数量组卷。
3. 答几题后刷新，确认草稿恢复；提交后确认按标准答案判分；下载试卷和错题 DOCX。
4. 删除专门建立的测试题库，确认它的已完成成绩仍能查看。
5. 英语与雅思页能浏览内置词汇和阅读；收藏单词并生成练习；写作/口语笔记可保存。
6. 实时翻译发起一次中文到英语请求；如失败，检查 Gateway 配置，不把词典命中当在线翻译成功。
7. 使用第二个测试账号验证无法访问第一个账号的题库、答卷、词库和笔记。

额外账号均拥有同样的个人功能，服务器开通方式：

```bash
cd /opt/quizforge
read -r -s -p '新账号密码: ' NEW_ACCOUNT_PASSWORD
export NEW_ACCOUNT_PASSWORD
npm run account:create -- --name=新账号
unset NEW_ACCOUNT_PASSWORD
pm2 restart quizforge-web
```

Web 会在启动时装载账号和词条。使用 account:create、words:import 等服务器命令后必须重启 quizforge-web，网页内创建的内容则即时可用。批量导入前先暂停 Web 写入并备份。

## 6. 端口与回滚

在服务器防火墙和云安全组仅开放所选 Web 端口（示例 3080）。通过 http://49.234.185.199:3080 访问。公网 HTTP 会明文传输登录信息，适合受控来源访问；数据库和 Gateway 端口不向公网开放。

验收失败：停止新 QuizForge 进程，保留新目录与 SQL 备份，将 /opt/quizforge 改名为未存在的 /opt/quizforge-v6.1-failed，再将 /opt/quizforge-prev-v6.1 恢复到 /opt/quizforge，按旧进程配置启动。数据库新增字段可以保留；若必须恢复 SQL，先另备份升级后数据，再经现场核对恢复 before-v6.1.sql，避免覆盖升级后新答卷。不要删除原始数据表或旧备份。
## 6.1 新增验收

本次无新增数据库结构迁移，仍使用现有 v6 增量迁移，不覆盖业务数据。源码、前端、refinements.css 必须一起更新，重启 Web 后浏览器强制刷新。

- 我的题库默认全部方向；筛选无结果后点击清除筛选。
- 文件选择在导入页最上方；更多设置可展开；确认缺失答案修补仍有效。
- 完成一份含错题的练习，点击重练本次错题：只包含本次错题、材料保留，答对后得满分；再次点原结果的重练时复用尚未提交的重练试卷。
- 词典每页最多 12 词，翻页后查询仍显示正确结果。
- 390 像素手机宽度检查雅思写作、导入和专注答题。

发布来源：项目 releases/quizforge-v6.1-openclaw-node-mysql.zip。本地测试不代表服务器 MySQL、翻译或部署验收已完成。
