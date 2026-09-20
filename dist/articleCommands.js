export const ARTICLE_ADMIN_QQ = '1144107042';
export const ARTICLE_PREFIX = '-';

export function isArticleAdmin(id) { return String(id) === ARTICLE_ADMIN_QQ; }

export function parseArticleCommand(raw) {
  const text = String(raw ?? '').split(/\r?\n/, 1)[0].trim();
  if (!text.startsWith(ARTICLE_PREFIX)) return null;
  const body = text.slice(ARTICLE_PREFIX.length).trim();
  if (!body) return { action: 'help' };
  const [head, ...rest] = body.split(/\s+/);
  if (head === '文' || head === '文章列表') {
    if (rest[0] === '分类列表') return { action: 'category-list', args: [] };
    let category = null;
    let showLength = rest[0] === '长度' || rest[0] === '字数';
    if (showLength) rest.shift();
    if (rest[0] === '分类') { rest.shift(); category = rest.shift() || ''; }
    if (rest[0] === '长度' || rest[0] === '字数') { rest.shift(); showLength = true; }
    const page = /^\d+$/.test(rest.at(-1) || '') ? Number(rest.pop()) : 1;
    const extra = showLength ? { showLength: true } : {};
    return category === null ? { action: 'list', keyword: rest.join(' '), page, ...extra } : { action: 'list', keyword: rest.join(' '), page, category, ...extra };
  }
  if (head === '管' || head === '文章管理') {
    let op = rest.shift() || '帮助';
    if (op === '确认' && rest[0] === '删除') { op = '确认删除'; rest.shift(); }
    if (op === '分类') {
      const sub = rest.shift() || '帮助';
      const categoryMap = { '添加': 'category-add', '删除': 'category-remove', '列表': 'category-list', '重命名': 'category-rename', '改名': 'category-rename', '难度列表': 'category-difficulty-list', '难度查看': 'category-difficulty-view', '难度启用': 'category-difficulty-enable', '难度停用': 'category-difficulty-disable' };
      return { action: categoryMap[sub] || 'category-help', args: rest };
    }
    const map = { '传': 'upload', '上传': 'upload', '批传': 'batch-upload', '批量传': 'batch-upload', '批量上传': 'batch-upload', '改': 'replace', '替换': 'replace', '重命名': 'article-rename', '文章重命名': 'article-rename', '文章改名': 'article-rename', '删': 'delete', '删除': 'delete', '确认': 'confirm-delete', '确认删除': 'confirm-delete' };
    return { action: map[op] || 'admin-help', args: rest };
  }
  if (head === '帮助' || head === '发文帮助') return { action: 'help', args: rest };
  const difficultyAliases = new Set(['淼', '水', '易', '普', '难', '虐', '爆', '难度发文']);
  if (head === '条件') return { action: '条件', args: rest };
  return { action: head, args: rest, difficulty: difficultyAliases.has(head) };
}

export function extractDirectArticleText(message) {
  return Array.isArray(message) ? message.filter(x => x?.type === 'text').map(x => String(x.data?.text || '')).join('').trim() : '';
}

export const ARTICLE_HELP = `发文帮助目录

-帮助 查找文章
-帮助 选择文章
-帮助 普通发文
-帮助 难度发文
-帮助 发文后的操作
-帮助 自动续段

请发送对应的命令查看详细说明。`;

const ARTICLE_HELP_TOPICS = {
  '查找文章': `## 一、查找文章

### 查看文章列表

~~~text
-文 [关键词] [页码]
~~~

查看文章标题列表。

例如：

~~~text
-文
~~~

查看文章列表第一页。

~~~text
-文 红楼梦
~~~

查找标题中包含“红楼梦”的文章。

~~~text
-文 红楼梦 2
~~~

查看搜索结果第 2 页。

### 查看文章长度

~~~text
-文 长度 [关键词] [页码]
~~~

查看文章列表，并同时显示每篇文章的紧凑正文长度。

例如：

~~~text
-文 长度 红楼梦
~~~

### 按分类查找

~~~text
-文 分类 <分类名> [关键词] [页码]
~~~

只查看指定分类中的文章。

如果还想同时查看文章长度：

~~~text
-文 分类 <分类名> 长度 [关键词] [页码]
~~~

### 查看分类列表

~~~text
-文 分类列表
~~~

查看目前有哪些文章分类。`,
  '选择文章': `## 二、选择文章

三种普通发文模式都需要指定文章。

可以先选择一篇文章：

~~~text
-选 <标题>
~~~

例如：

~~~text
-选 红楼梦
~~~

选择后，后续使用以下三种普通发文模式时可以省略标题：

~~~text
-顺
-随
-乱
~~~

也可以不提前选择，直接把标题写在发文命令后面。

例如：

~~~text
-顺 500 红楼梦
~~~

~~~text
-随 500 红楼梦
~~~

随机抽行时可以指定文章“单”或文章“词”：

~~~text
-乱 20 词
~~~

直接在命令中填写标题时，会使用该文章发文，并把它设为当前文章。`,
  '普通发文': `## 三、普通发文

普通发文共有三种模式：

1. 顺序发文
2. 随机连续发文
3. 随机抽行（乱序）

三种模式都需要满足以下任意一种情况：

- 已经选择当前文章；
- 在发文命令后直接填写文章标题。

继续查看：

-帮助 普通发文 顺序发文
-帮助 普通发文 随机连续发文
-帮助 普通发文 随机抽行`,
  '普通发文 顺序发文': `### 1. 顺序发文

~~~text
-顺 [字数] [标题]
~~~

从当前文章的当前位置开始，按正文顺序发送一段。

例如：

~~~text
-顺 500
~~~

从已经选中的文章中发送约 500 字。

~~~text
-顺 500 红楼梦
~~~

从《红楼梦》中发送约 500 字，并把《红楼梦》设为当前文章。

顺序发文会记录文章进度。

继续下一段：

~~~text
-下
~~~

返回上一段：

~~~text
-上
~~~

查看进度：

~~~text
-进
~~~

调整进度：

~~~text
-进 +500
-进 -500
-进 =10000
~~~

调整进度后，使用“-发”即可从调整后的新位置发送当前段。`,
  '普通发文 随机连续发文': `### 2. 随机连续发文

~~~text
-随 [字数] [标题]
~~~

从指定文章中随机选择一个位置，截取一段连续正文。

例如：

~~~text
-随 500
~~~

从当前文章中随机发送约 500 字。

~~~text
-随 500 红楼梦
~~~

从《红楼梦》中随机发送约 500 字，并把《红楼梦》设为当前文章。

之后使用：

~~~text
-下
~~~

会按照当前随机发文设置重新随机发送一段。`,
  '普通发文 随机抽行': `### 3. 随机抽行（乱序）

~~~text
-乱 [行数] [标题] [起点-终点]
~~~

从指定文章中随机抽取若干完整行，并以乱序方式发送。

抽取时不会抽到相同的行。

例如：

~~~text
-乱 20 词
~~~

从文章“词”中随机抽取 20 行并乱序发送。

还可以限制抽取范围：

~~~text
-乱 20 词 100-500
~~~

表示只在文章“词”的第 100～500 行之间随机抽取 20 行，并乱序发送。

之后使用：

~~~text
-下
~~~

会按照当前随机抽行设置重新随机抽取一组内容。`,
  '难度发文': `## 四、难度发文

难度发文与普通发文不同：

> **不需要提前选择文章，也不需要填写文章标题。**

机器人会直接从难度发文池中随机寻找符合要求的正文。

完整命令：

~~~text
-难度发文 <难度> [字数]
~~~

支持以下难度：淼、水、易、普、难、虐、爆表。

例如：

~~~text
-难度发文 难 500
~~~

快捷命令：

~~~text
-淼 [字数]
-水 [字数]
-易 [字数]
-普 [字数]
-难 [字数]
-虐 [字数]
-爆 [字数]
~~~

例如：

~~~text
-难 500
~~~

等同于：

~~~text
-难度发文 难 500
~~~

之后使用“-下”会继续按照当前难度和字数重新寻找一段。`,
  '发文后的操作': `## 五、发文后的操作

发文后，机器人会记住当前的发文模式和相关设置。

继续发一段：

~~~text
-下
~~~

按照当前发文模式继续发送。

返回上一段：

~~~text
-上
~~~

用于顺序发文，回退到上一段并发送。

重发当前内容：

~~~text
-发
~~~

重新发送当前这一段，不推进进度，也不会重新随机。

可以用于：顺序发文、随机连续发文、随机抽行、难度发文。

结束发文：

~~~text
-停
~~~

结束当前发文会话，并停止自动续段。`,
  '自动续段': `## 六、自动续段

自动续段会在一段练习完成后，自动执行相当于“继续发一段”的操作。

可以用于：顺序发文、随机连续发文、随机抽行、难度发文。

无条件自动续段：

~~~text
-自
~~~

开启无条件自动续段。

按成绩自动续段：

~~~text
-自 <成绩条件>
~~~

例如：

~~~text
-自 速度>=100 且 错字=0
~~~

也可以组合多个条件：

~~~text
-自 (速度>=100 或 击键>=5) 且 键准>=95%
~~~

条件支持：

- 且：两个条件都要满足；
- 或：满足其中一个即可；
- ()：控制条件组合顺序。

查看自动续段条件：

~~~text
-条件
~~~

结束发文：

~~~text
-停
~~~`
};

export function getArticleHelp(args = []) {
  const key = args.map(value => String(value)).join(' ').trim();
  if (!key) return ARTICLE_HELP;
  return ARTICLE_HELP_TOPICS[key] || '未找到这个帮助主题。\n请发送“-帮助”查看帮助目录。';
}

export const ARTICLE_ADMIN_HELP = `发文帮助
-文 [关键词] [页码]：查看文章列表
-文 长度 [关键词] [页码]：查看文章及紧凑正文长度
-文 分类 <分类名> [关键词] [页码]：按分类查看文章
-文 分类 <分类名> 长度 [关键词] [页码]：查看分类文章长度
-文 分类列表：查看所有分类名称
-选 <标题>：选择当前文章
-模式：查看当前发文模式
-搜 <关键词> [页码] [于 <标题>]：搜索文章正文
-进 [+/−/=数字]：查看当前位置，或手动调整当前段起点

二、三种普通发文
-顺 [字数] [标题]：发送当前位置的段落；填写标题时同时选中该文章
-随 [字数] [标题]：随机截取连续段落
-乱 [行数] [标题] [起点-终点]：从有效行范围随机抽取指定数量的整行，行下标不重复

三、难度发文
-难度发文 <淼|水|易|普|难|虐|爆表> [字数]
-淼/水/易/普/难/虐/爆 [字数]：难度发文快捷命令

四、会话与自动续段
-上：顺序发文回退一段并发送；会话失效或重启后仍可使用
-下：顺序发文前进一段并发送；没有会话时按上次配置恢复
-发：重复当前位置的一段且不改变进度；没有当前位置时从文章开头发送
-自 [成绩条件]：设置自动续段条件；不带条件表示无条件续段
-条件：查看当前会话或已保存的自动续段条件
-停：结束当前发文会话
成绩条件示例：速度>=100 且 错字=0；(速度>=100 或 击键>=5) 且 键准>=95%

五、管理员功能
-管 传 <分类> <标题>：上传或更新 txt 文章并加入分类
-管 批量传 <分类>：上传 zip 中的 txt 文章并加入分类
-管 改 <起点> <终点> <标题>：下一行填写正则，第三行起填写替换文本
-管 删 <标题> / -管 确认 <确认码>：删除文章
-管 分类 添加/删除 <分类名> <标题>：维护分类软链接
-管 分类 重命名 <旧分类名> <新分类名>：重命名分类
-管 重命名 <旧标题> <新标题>：重命名文章
-管 分类 列表：查看分类
-管 分类 难度列表/难度查看 <分类名>：查看难度发文取样分类
-管 分类 难度启用/难度停用 <分类名>：切换分类是否进入难度发文池
-管 传/改/删：管理文章；-管 分类：管理文章分类`;
