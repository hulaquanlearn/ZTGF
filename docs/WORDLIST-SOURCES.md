# 考研英语与雅思词库来源方案

## 原则

- 系统自带的少量中英词条只用于功能验证，不冒充完整考试大纲。
- 不从没有批量导出授权的背词软件抓取数据，也不把个人账号内容重新分发。
- 每个导入词条保留来源、来源网址、许可、署名和审核状态。
- OpenClaw 可以补齐释义、词性和例句，但生成内容只能进入 `needs-review`，不能自动变成考试答案。

## 考研英语词汇

优先使用个人合法取得的当前年份考试大纲或配套附录。将词表整理为 UTF-8 文本，每行一个英文词，可在第二列填写频次：

```text
abandon
ability
abstract
```

生成候选表：

```bash
npm run words:prepare -- \
  --input=/opt/quizforge-import/postgraduate-2027.txt \
  --track=postgraduate \
  --limit=5500 \
  --output=seed-data/postgraduate-core-5500-source.xlsx \
  --source="当前年份考研英语大纲词汇附录（个人合法取得）" \
  --license="personal-licensed-use"
```

## 雅思词汇

雅思没有一个可以直接等同于“官方固定核心词表”的单一清单。可导入个人购买并获准使用的教材词表、自己的学习笔记，或许可允许再利用的开放词表，并按 `ielts` 学习方向标记：

```bash
npm run words:prepare -- \
  --input=/opt/quizforge-import/ielts-vocabulary.txt \
  --track=ielts \
  --limit=8000 \
  --output=seed-data/ielts-vocabulary-source.xlsx \
  --source="实际来源名称" \
  --license="实际许可或 personal-notes"
```

## 补全与审核

```bash
npm run words:enrich -- --input=seed-data/postgraduate-core-5500-source.xlsx --output=seed-data/postgraduate-core-5500-enriched.xlsx --batch=20
npm run words:import -- --file=seed-data/postgraduate-core-5500-enriched.xlsx
```

导入前至少检查：重复词、词性、熟词僻义、明显错译、例句版权、来源和许可字段。审核通过的行再把状态从 `needs-review` 改为 `approved`。
