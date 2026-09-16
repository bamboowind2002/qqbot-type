# 发文本地 CLI

该工具直接读取本地 `data/articles/text/`，不连接 NapCat 或 MySQL，适合检查发文、搜索、进度和难度候选。

在项目根目录运行：

```bash
node article_cli/cli.js
```

输入 `帮助` 查看命令。输入 `退出` 结束。CLI 中的顺序进度只保存在本次进程内，不写入数据库。
