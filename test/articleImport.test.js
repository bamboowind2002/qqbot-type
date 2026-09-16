import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRankPage, parseArticleDetail, parseTextListResponse, IMPORT_LIMIT, IMPORT_MAX_BYTES } from '../article_import/importer.js';

test('extracts unique result detail links from a rank page', () => {
  const html = '<a href="/result_search?ranktext=%E7%94%B2">甲</a><a href="/result_search?ranktext=%E7%94%B2">重复</a><a href="/result_search?ranktext=%E4%B9%99">乙</a>';
  assert.deepEqual(parseRankPage(html).map(item => item.url), [
    'https://www.jsxiaoshi.com/result_search?ranktext=%E7%94%B2',
    'https://www.jsxiaoshi.com/result_search?ranktext=%E4%B9%99'
  ]);
});

test('extracts title and body from a result detail page', () => {
  const result = parseArticleDetail('<div>文本名：银杏</div><div>文本内容：<br>我们的小区里，有一棵树。<br>秋天很美。</div><div>评论(0)</div>');
  assert.deepEqual(result, { title: '银杏', body: '我们的小区里，有一棵树。\n秋天很美。' });
});

test('keeps import limits explicit', () => {
  assert.equal(IMPORT_LIMIT, 10);
  assert.equal(IMPORT_MAX_BYTES, 20 * 1024 * 1024);
});

test('parses the public text-list API response', () => {
  const result = parseTextListResponse({ list: [{ a_id: '2', a_name: '冰灯', a_content: '正文', a_author: '作者', a_zs: '2' }] });
  assert.equal(result[0].title, '冰灯');
  assert.equal(result[0].body, '正文');
  assert.match(result[0].source, /a_id=2/);
});
