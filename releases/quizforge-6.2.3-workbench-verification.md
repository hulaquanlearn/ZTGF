# 智题工坊 6.2.3 部署包验收（2026-10-10）

- 完整源码包：`quizforge-6.2.3-workbench-20261010.zip`，228885 字节，79 个发布文件加 MANIFEST.json。
- SHA256：`5380e522e6e1138a74133331e94b294427e2b35e69ceeb13338eee0a75b4811a`。对应校验文件为 `.zip.sha256`。
- 打包校验 ZIP 各项大小和哈希；独立解压后再逐项校验全部 79 个文件，均与 MANIFEST.json 一致。含新版导航、flight-workbench.js/css、workbench.css、flight-drafts.js、测试和 WORKBENCH-DEPLOY.md。
- 白名单排除实际配置、凭据、业务数据、上传目录、私人 PDF、截图、node_modules 和备份。
- 独立解压至 `.verification/workbench-6.2.3-20261010`，执行 `npm ci --no-audit --no-fund` 成功，安装 222 个包。既存间接依赖有弃用提示，本轮未做漏洞审计。
- 源码 `npm test`：60/60 通过；源码 `npm run smoke` 通过。
- 独立解压目录 `npm test`：60/60 通过。与测试并行的首次冷启动检查超过 15 秒等待上限；测试结束后单独重新运行 `npm run smoke` 成功，服务返回版本 6.2.3，顶部导航资源、整季九列预览、人工开会时间、草稿落盘恢复及原学习功能均正常。
- 源码此前浏览器验收真实 PDF 104 条、人工当天/次日回程、开会时间即时保存、命名草稿与刷新恢复、模块内记录/错题导航、390px 手机布局、实际 XLSX 下载并读回九列内容。包内源码与该实现一致。
- 旧 `quizforge-6.2.2-flights-20261010.zip` 保持原 SHA256 `7cda2fc82533b895d0eec0c95179751b9904742a608123a6ad4be209bb4b667c`。
- 6.2.1 / 6.2.2 升级无需数据库迁移。服务端草稿独立存放于 `DATA_DIR/flight-drafts`，使用 MySQL 也需持久化并备份该目录；原 `.env`、data、uploads 和业务数据库须保留。
- 生产 MySQL、服务器升级、手机真机和 OpenClaw 实际服务尚未验收；交付部署包不代表已上线。升级和回滚以包内 WORKBENCH-DEPLOY.md 为准。
