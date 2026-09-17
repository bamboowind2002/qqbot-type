export const ARTICLE_ADMIN_QQ = '1144107042';
export const ARTICLE_PREFIX = '-';

export function isArticleAdmin(id) { return String(id) === ARTICLE_ADMIN_QQ; }

export function parseArticleCommand(raw) {
  const text = String(raw ?? '').trim();
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
      const categoryMap = { '添加': 'category-add', '删除': 'category-remove', '列表': 'category-list', '重命名': 'category-rename', '改名': 'category-rename' };
      return { action: categoryMap[sub] || 'category-help', args: rest };
    }
    const map = { '传': 'upload', '上传': 'upload', '批传': 'batch-upload', '批量传': 'batch-upload', '批量上传': 'batch-upload', '改': 'replace', '替换': 'replace', '重命名': 'article-rename', '文章重命名': 'article-rename', '文章改名': 'article-rename', '删': 'delete', '删除': 'delete', '确认': 'confirm-delete', '确认删除': 'confirm-delete', '索': 'map-sync', '同步难度地图': 'map-sync', '状': 'map-status', '难度地图状态': 'map-status', '取消': 'map-cancel', '取消建图': 'map-cancel' };
    return { action: map[op] || 'admin-help', args: rest };
  }
  const difficultyAliases = new Set(['淼', '水', '易', '普', '难', '虐', '爆', '难度发文']);
  if (head === '条件') return { action: '条件', args: rest };
  return { action: head, args: rest, difficulty: difficultyAliases.has(head) };
}

export function extractDirectArticleText(message) {
  return Array.isArray(message) ? message.filter(x => x?.type === 'text').map(x => String(x.data?.text || '')).join('').trim() : '';
}

export const ARTICLE_HELP = `发文命令
-文 [关键词] [页码]：查看文章列表
-文 长度 [关键词] [页码]：查看文章列表及紧凑正文长度
-文 分类 <分类名> [关键词] [页码]：按分类查看文章
-文 分类 <分类名> 长度 [关键词] [页码]：查看分类文章及长度
 -文 分类列表：查看所有分类名称
-选 <标题>：选择当前文章
-进 [+/−/=数字]：查看或调整顺序发文进度
-顺 [字数] [标题]：顺序发文
-随 [字数] [标题]：随机连续段落发文
-乱 [字数] [标题] [起点-终点]：按不同有效行下标随机拼接，最后一行可截断
-难度发文 <淼|水|易|普|难|虐|爆表> [字数]：按难度发文
-淼/水/易/普/难/虐/爆 [字数]：难度发文快捷命令
-搜 <关键词> [页码] [于 <标题>]：搜索文章正文
-上/下：上一段或下一段（上一段仅顺序发文支持）
-发：重复当前会话上一条发文消息；会话失效时按用户上次配置重新发文
-自 [成绩条件]：设置自动续段条件，不带条件表示无条件续段
-条件：查看当前会话或已保存的自动续段条件
-停：结束当前发文会话

成绩条件示例：速度>=100 且 错字=0；(速度>=100 或 击键>=5) 且 键准>=95%

管理员命令
-管 传 <分类> <标题>：上传或更新 txt 文章并加入分类
-管 批量传 <分类>：上传 zip 压缩包中的全部 txt 文章并加入分类
-管 改 <起点> <终点> <标题>：下一行填写正则，第三行起填写替换文本
-管 删 <标题>：请求删除文章
-管 确认 <确认码>：确认删除
-管 分类 添加/删除 <分类名> <标题>：维护分类软链接
-管 分类 重命名 <旧分类名> <新分类名>：重命名分类
-管 重命名 <旧标题> <新标题>：重命名文章（“文章重命名”同义）
-管 分类 列表：查看分类（兼容旧命令，普通用户也可用）
-管 索：同步难度地图
-管 状：查看难度地图同步状态
-管 取消：取消难度地图同步`;
