# 文章语料导入器

这是一个一次性、受限的极速打字网文章导入工具。它使用网页文本选择器实际调用的公开 POST 接口 `/Home/Cloud/getTextList`，接口直接返回文本名称和正文；也兼容从排行榜页面发现 `result_search` 详情链接的旧路径。

运行：

```bash
node article_import/importer.js
```

也可以传入排行榜页面 URL，作为接口不可用时的详情页路径：

```bash
node article_import/importer.js https://www.jsxiaoshi.com/result_rank.html
```

工具固定限制单次最多 10 篇、正文总大小最多 20 MiB，并在请求之间至少间隔 1 秒。来源清单写入运行目录 `data/articles/import-sources.json`，不进入 Git。若排行榜页面只返回空壳 HTML、没有详情链接，应先人工导出少量正文，再用管理员命令 `》管 传 <标题>` 导入。
