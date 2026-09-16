# 文章语料导入器

这是一个一次性、受限的极速打字网文章导入工具。它从排行榜页面发现 `result_search` 详情链接，逐篇读取正文并复用机器人文章存储模块保存。

运行：

```bash
node article_import/importer.js https://www.jsxiaoshi.com/result_rank.html
```

工具固定限制单次最多 10 篇、正文总大小最多 20 MiB，并在请求之间至少间隔 1 秒。来源清单写入运行目录 `data/articles/import-sources.json`，不进入 Git。若排行榜页面只返回空壳 HTML、没有详情链接，应先人工导出少量正文，再用管理员命令 `》管 传 <标题>` 导入。
