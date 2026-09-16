import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArticleText, validateArticleTitle } from '../dist/articleStorage.js';
import { parseArticleCommand, extractDirectArticleText } from '../dist/articleCommands.js';
import { formatArticleMessage } from '../dist/articleMessage.js';

test('normalizes BOM, supported legacy encodings, and all Unicode whitespace', () => {
  assert.equal(normalizeArticleText(Buffer.from('\ufeff 你\n 好\t', 'utf8')), '你好');
  assert.equal(normalizeArticleText(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), 'gb18030'), '你好');
});

test('validates article titles as path-safe Unicode names', () => {
  assert.equal(validateArticleTitle('  中文  '), '中文');
  assert.throws(() => validateArticleTitle('../秘密'), /路径/);
  assert.throws(() => validateArticleTitle(''), /不能为空/);
});

test('parses short and long list commands and preserves direct text only', () => {
  assert.deepEqual(parseArticleCommand('》文 中秋节 2'), { action: 'list', keyword: '中秋节', page: 2 });
  assert.deepEqual(parseArticleCommand('》文章列表 中秋节 2'), { action: 'list', keyword: '中秋节', page: 2 });
  assert.equal(extractDirectArticleText([{ type: 'reply' }, { type: 'text', data: { text: '》文' } }]), '》文');
});

test('formats a three-line article message with Unicode character count', () => {
  const result = formatArticleMessage('你\n好😀', { title: '测试', segment: '12345', trigger: '昵称' });
  assert.match(result, /^测试-(?:淼|水|易|普|难|虐|爆表)\d+\.\d{2}\n你好😀\n-----第12345段-共3字-昵称$/);
});
