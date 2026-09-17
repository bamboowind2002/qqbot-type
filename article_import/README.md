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

单页导入器当前限制单次最多 1000 篇、正文总大小最多 20 MiB，并在请求之间至少间隔 200ms。来源清单写入运行目录 `data/articles/import-sources.json`，不进入 Git。若排行榜页面只返回空壳 HTML、没有详情链接，应优先使用默认的文本列表接口；也可以人工导出少量正文，再用管理员命令 `-管 传 <标题>` 导入。

## 批量导入全部文本

`batch-importer.js` 按文本列表接口分页抓取并直接写入当前文章目录，适合在服务器的 `tmux` 中长期运行。它会在每页完成后写入断点文件，默认跳过已经存在的标题；重复执行可以从上次中断的页面继续。

在服务器项目根目录运行：

```bash
tmux new -s article-import
node article_import/batch-importer.js --page-size=100 --interval=500
```

退出 tmux 但保持任务运行：按 `Ctrl-b`，再按 `d`。查看输出：

```bash
tmux attach -t article-import
```

断点状态默认保存在 `data/articles/import-batch-state.json`。如果进程被中断，重新执行同一条命令即可继续。常用参数：

```bash
# 从指定页面开始
node article_import/batch-importer.js --start-page=1

# 允许覆盖同名文章（请谨慎使用）
node article_import/batch-importer.js --overwrite

# 只跑 1 页，用于先验证远端效果
node article_import/batch-importer.js --max-pages=1

# 自定义断点文件
node article_import/batch-importer.js --state=/tmp/article-import-state.json
```

脚本只写文章文件，不连接 NapCat，也不修改数据库；文章进度和用户设置不受影响。全部导入后，如需使用难度发文，使用机器人管理员命令 `-管 索` 同步难度地图。
