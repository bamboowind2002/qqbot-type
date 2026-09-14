# 项目协作说明

## 工作位置、Git 与操作边界

- **本地开发工作树**直接位于 `/home/bamboowind/qqbot/`；其 `origin` 是私有仓库 `git@github.com:bamboowind2002/qqbot-type.git`，以 `main` 为唯一协作分支。所有源码检查、编辑、构建和测试优先在此工作树进行。
- **远端部署工作树**位于 `ssh lbamboo` 后的 `~/oicq-template-main/`（当前为 `/home/ubuntu/oicq-template-main/`）。远端只用于部署、读取真实外部运行数据和必要的生产验证；不要在远端直接开发。
- 正常同步流程：本地修改、验证、`git add` / `git commit` / `git push origin main`；随后远端执行 `git pull --ff-only origin main`。远端紧急修复必须立即提交并推送，再在本地 `git pull --ff-only`，避免两个工作树分叉。
- 本地顶层就是 Git 工作树，`.git` 与源码均直接位于 `/home/bamboowind/qqbot/`；本 `AGENTS.md` 已受 Git 跟踪，任何流程变更都应随代码提交并推送。
- `.env` 是生产凭据的唯一项目内来源，受 Git 忽略；绝不提交、复制、打印或在日志/回复中泄露其 MySQL 或 NapCat 值。`dist/bot.js` 必须从 `dist/config.js` 加载这些配置。
- 词库、Rime 方案、依赖、Librime、构建物和运行数据均不进 Git，且不要为本地开发从远端复制生产数据，除非用户明确要求。
- 远端使用专用 GitHub SSH 部署密钥；不要输出私钥或修改该密钥。GitHub remote 已配置为 SSH。
- 部署涉及真实 NapCat、MySQL 和 QQ 消息。代码或 `.env` 更新后，只有在用户明确授权部署时才运行：`pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save`。若 `package-lock.json` 有变化，先在远端运行 `npm ci --ignore-scripts`；若 `binding.gyp`、`word_hint0206_4.cc` 或 `word_hint0206/` 有变化，另行重新构建原生模块。
- 启动机器人会连接真实 NapCat、读取/写入真实 MySQL，并可能向 QQ 发送消息。未经用户明确要求，不要运行 `npm run dev`、`npm start` 或启动 PM2；优先做局部、无外部副作用的验证。

## 运行入口与词提主链路

- `package.json` 的开发入口是 `node ./dist/main.js`；生产脚本用 PM2 启动同一文件。
- `dist/main.js` 导入 `dist/plugin-wordhint2.js`；后者从 `dist/bot.js` 取得 NapCat WebSocket 客户端和 MySQL 连接，注册多组消息监听器。
- 当前实际词提插件是 `dist/plugin-wordhint2.js`。`dist/bak/`、`word_hint.cc`、`word_hint1222.cc`、`word_hint0206.cc`、`word_hint0206_3.cc` 等是旧实现或备份，理解和修改现行功能时不要误用。
- JavaScript 插件通过 `require('../build/Release/word_hint.node')` 调用本地 Node-API 扩展。
- `binding.gyp` 中 `word_hint` target 的当前源文件是 `word_hint0206_4.cc`，核心算法头文件是 `word_hint0206/solver4.hpp`。构建产物为 `build/Release/word_hint.node`。

## 码表数据与编译格式

- 方案文件统一放在 `word_hint_module/word_hint/`，一个方案通常对应同名的三份文件：
  - `.txt`：UTF-8 无 BOM 原始码表，每行格式为 `编码<TAB>候选1<TAB>候选2...`；同一编码可出现多行，候选顺序按文件中的出现顺序累积。
  - `.hint`：由 C++ 扩展生成的二进制查询数据，包含“编码 Trie”和“词条 Trie”。词条 Trie 预计算 failure/last 链，用于在文章中匹配所有词条；查询时通过 `mmap` 只读加载。
  - `.config`：二进制方案配置，保存选重键 `candidate`、最大码长 `maxlen`、标点引导键 `punct` 和从码表推导出的码元集合 `codeelem`。
- `word_hint.save_table(<无扩展名路径>)` 读取 `.txt`，按“码长、编码、原文件候选次序”排序，构建双 Trie，并重新生成 `.hint` 和默认 `.config`。默认选重键为 `_;'4567890`，默认最大码长为 4，默认无标点引导键。
- 重新编译扩展或重新生成 `.hint/.config` 都会改动运行数据；执行前确认用户确实要求，并避免对全部方案做批量转换。

## 方案登记与上传

- MySQL 数据库 `QQBot` 是可用方案的登记来源：`public_word_base(name)` 保存公共方案；`private_word_base(qqid, name)` 保存用户私有方案，主键是 `qqid`，所以每个用户只登记一个私有方案。
- 查询前 `query_cmd_exist()` 先查公共表，再查私有表；查不到的方案名会被忽略。文件存在但数据库未登记，也不能通过普通命令查询。
- 私聊中回复一个离线 `.txt` 文件并发送 `上传词提 <方案名>` 会校验文件类型、100 MiB 上限和方案名，下载到方案目录，调用 `save_table()` 生成二进制数据，然后插入或更新 `private_word_base`。
- 私聊管理命令包括 `删除词提`、`查看方案配置`、`设置选重键`、`设置最大码长`、`设置标点引导键`；`码表列表 [正则]` 汇总公共和私有方案；`%<方案名>` 显示指定方案配置。
- 上传、删除、设置配置会同时影响文件或数据库，属于真实持久化操作，不应用作随手测试。

## 查询命令到扩展 API 的映射

- `<方案> <文本>`：理论编码。单个 Unicode 字符自动走 `solve_simple()` 列出其全部编码；多字符走 `solve()`。
- `!<方案> <文本>`：`solve_one()`，仅按单字打法计算。
- `#<方案> <词模式>`：`solve_simple()`，按词反查编码；支持 `*`（零个或多个字符）、`?`（一个字符）和反斜杠转义。
- `##<方案> <正则>`：`solve_simple_func()`，用 JavaScript Unicode 正则遍历词 Trie。正则调用被放进同步 worker，并设 15 秒超时。
- `/<方案> <编码模式>`：`solve_search()`，按编码查候选，同样支持 `*`、`?` 和转义。
- `//<方案> <正则>`：`solve_search_func()`，用正则遍历编码 Trie，同样有 15 秒超时包装。
- `#/<方案>` 或 `/#<方案>`：联合正则查询，输入依次是词、码、重数模式，调用 `solve_simple_search_func()`。
- `#<n><方案>`、`/<n><方案>` 等：第 `n` 页；每页 `PAGE_NUM = 100`。
- `&<方案> <文本>`：仍调用 `solve()`，但只拼接并返回编码文本。
- `^<方案> <文本>`：只返回字数、难度、码长、选重和缺字统计；`^!<方案>` 使用单字模式。
- `<方案名>` 可替换为特殊方案 `a`，按 `a_list.txt` 中的代表性方案批量计算，并按缺字数、码长、选重数、中文方案名排序。
- `*<方案> <编码>`：调用 `solve_code()` 模拟码表输入法，将编码串反解为文字；引号内文本原样输出，并处理翻页、选重、顶屏及标点。
- 普通消息和回复消息有两套近似的解析路径；修改命令语义时必须同时检查 `dist/plugin-wordhint2.js` 中“普通查询”和“回复查询”两个监听器，避免行为分叉。

## C++ 求解行为

- `Solve::solve()` 用词条 Trie 的 failure/last 链枚举在文章当前位置结束的所有词条及其编码，再做动态规划选择整段文章的打法。
- DP 状态跟踪累计按键长度、选重次数，以及当前是否有待上屏候选和能否被后续编码/标点顶屏。`DPNode` 虽然还定义了 `que` 并在比较器中先比较它，但当前转移只传入前两个聚合字段，`que` 始终为 0；所以现行路径选择实际先最小化总按键数，再最小化选重次数。缺字通过六个问号和一次选重的代价间接受罚，最终 `num_of_que` 则从回溯出的边另行统计。
- 候选位次由 `.txt` 中出现顺序决定。位次超过一组选重键时用 `=` 翻页，再追加对应选重键；首候选、唯一候选、最大码长、顶屏和标点引导键会影响实际按键数及是否需要显式选重。
- ASCII 字母、数字和空格有直通转换；常见中英文标点有固定键位映射。无法编码的字符回退为 `??????`，计入 `num_of_que`。
- `solve()`/`solve_one()` 返回 `show_list` 以及平均码长 `code_len`、选重数 `num_of_candidate`、字符数 `num_of_char`、缺字数 `num_of_que`。`solve_simple()` 返回词对应的编码、候选序号；`solve_search()` 返回编码对应的候选词。
- `has_word()` 用词 Trie 判断词条是否有编码，插件的字频覆盖统计会遍历公共和私有方案调用它。

## 输出层

- 查询结果主要不是纯文本，而是由 Puppeteer 无头 Chrome 打开本地 HTML 模板、注入结果、截图为 JPEG，再经 NapCat 发送。
- 理论编码使用 `word_hint_template.html`；词反查使用 `simple.html`；编码查词使用 `search.html`；联合查询使用 `simple_search.html`；多方案汇总使用 `word_hint_getall.html`。对应样式位于根目录的 `style*.css`。
- 一篇理论编码的 `show_list` 每 600 项分图，超过 10 个分块时只返回不含明细的概要图；多条结果通常作为 QQ 合并转发发送。
- 修改返回字段时必须同步检查 C++ 对象封装、JavaScript 渲染函数和 HTML/CSS 模板三层。
