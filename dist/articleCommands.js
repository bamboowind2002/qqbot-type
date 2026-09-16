export const ARTICLE_ADMIN_QQ = '1144107042';

export function isArticleAdmin(id) { return String(id) === ARTICLE_ADMIN_QQ; }

export function parseArticleCommand(raw) {
  const text = String(raw ?? '').trim();
  if (!text.startsWith('》')) return null;
  const body = text.slice(1).trim();
  if (!body) return { action: 'help' };
  const [head, ...rest] = body.split(/\s+/);
  if (head === '文' || head === '文章列表') {
    const page = /^\d+$/.test(rest.at(-1) || '') ? Number(rest.pop()) : 1;
    return { action: 'list', keyword: rest.join(' '), page };
  }
  if (head === '管' || head === '文章管理') {
    let op = rest.shift() || '帮助';
    if (op === '确认' && rest[0] === '删除') { op = '确认删除'; rest.shift(); }
    const map = { '传': 'upload', '上传': 'upload', '改': 'replace', '替换': 'replace', '删': 'delete', '删除': 'delete', '确认': 'confirm-delete', '确认删除': 'confirm-delete' };
    return { action: map[op] || 'admin-help', args: rest };
  }
  const difficultyAliases = new Set(['淼', '水', '易', '普', '难', '虐', '爆', '难度发文']);
  return { action: head, args: rest, difficulty: difficultyAliases.has(head) };
}

export function extractDirectArticleText(message) {
  return Array.isArray(message) ? message.filter(x => x?.type === 'text').map(x => String(x.data?.text || '')).join('').trim() : '';
}

export const ARTICLE_HELP = '发文命令\n》文 [关键词] [页码]：查看文章列表\n》管 传 <标题>：管理员上传 txt 文章（可直接附文件或引用文件）\n》管 改 <起点> <终点> <标题>：下一行正则，第三行起填写替换文本\n》管 删 <标题>：请求删除文章\n》管 确认 <确认码>：确认删除';
