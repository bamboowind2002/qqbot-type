import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArticleText, compactArticleText, splitArticleLines, validateArticleTitle } from '../dist/articleStorage.js';
import { parseArticleCommand, extractDirectArticleText, ARTICLE_HELP } from '../dist/articleCommands.js';
import { formatArticleMessage } from '../dist/articleMessage.js';

test('normalizes BOM and whitespace while preserving line breaks', () => {
  const text = normalizeArticleText(Buffer.from('\ufeff 你\n 好\t', 'utf8'));
  assert.equal(text, '你\n好');
  assert.equal(compactArticleText(text), '你好');
  assert.deepEqual(splitArticleLines(text), ['你', '好']);
  assert.equal(normalizeArticleText(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), 'gb18030'), '你好');
});

test('validates article titles as path-safe Unicode names', () => {
  assert.equal(validateArticleTitle('中文'), '中文');
  assert.equal(validateArticleTitle('中文 标题'), '中文标题');
  assert.equal(validateArticleTitle('中文\u3000标题'), '中文标题');
  assert.throws(() => validateArticleTitle(' \u3000\t'), /不能为空/);
  assert.throws(() => validateArticleTitle('../秘密'), /路径/);
  assert.throws(() => validateArticleTitle(''), /不能为空/);
});

test('parses short and long list commands and preserves direct text only', () => {
  assert.deepEqual(parseArticleCommand('-文 中秋节 2'), { action: 'list', keyword: '中秋节', page: 2 });
  assert.deepEqual(parseArticleCommand('-文 长度 中秋节 2'), { action: 'list', keyword: '中秋节', page: 2, showLength: true });
  assert.deepEqual(parseArticleCommand('-文 分类 古典 长度 2'), { action: 'list', keyword: '', page: 2, category: '古典', showLength: true });
  assert.deepEqual(parseArticleCommand('-文章列表 中秋节 2'), { action: 'list', keyword: '中秋节', page: 2 });
  assert.equal(extractDirectArticleText([{ type: 'reply' }, { type: 'text', data: { text: '-文' } }]), '-文');
  assert.deepEqual(parseArticleCommand('-文 分类 古典 3'), { action: 'list', keyword: '', page: 3, category: '古典' });
  assert.deepEqual(parseArticleCommand('-管 分类 添加 古典 文章'), { action: 'category-add', args: ['古典', '文章'] });
  assert.deepEqual(parseArticleCommand('-管 传 极速中文网 文章'), { action: 'upload', args: ['极速中文网', '文章'] });
  assert.deepEqual(parseArticleCommand('-管 批量传 极速中文网'), { action: 'batch-upload', args: ['极速中文网'] });
  assert.deepEqual(parseArticleCommand('-管 分类 难度启用 古典'), { action: 'category-difficulty-enable', args: ['古典'] });
  assert.deepEqual(parseArticleCommand('-管 分类 难度列表'), { action: 'category-difficulty-list', args: [] });
  assert.deepEqual(parseArticleCommand('-管 改 1 100 四季。\n.\n替换文本'), { action: 'replace', args: ['1', '100', '四季。'] });
  assert.deepEqual(parseArticleCommand('-发'), { action: '发', args: [], difficulty: false });
  assert.deepEqual(parseArticleCommand('-条件'), { action: '条件', args: [] });
  assert.deepEqual(parseArticleCommand('-模式'), { action: '模式', args: [], difficulty: false });
  assert.equal(parseArticleCommand('》文 中秋节 2'), null);
});

test('formats a three-line article message with Unicode character count', () => {
  const result = formatArticleMessage('你\n好😀', { title: '测试', segment: '12345', trigger: '昵称' });
  assert.match(result, /^测试-(?:淼|水|易|普|难|虐|爆表)\d+\.\d{2}\n你好😀\n-----第12345段-共3字-昵称$/);
});

test('includes the main user-facing article commands in built-in help', () => {
  for (const command of ['-文', '-选', '-模式', '-进', '-顺', '-随', '-乱', '-难度发文', '-搜', '-上', '-下', '-发', '-自', '-停']) assert.match(ARTICLE_HELP, new RegExp(command));
});
