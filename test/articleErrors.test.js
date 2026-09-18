import test from 'node:test';
import assert from 'node:assert/strict';
import { articleBatchErrorMessage, articleUserError, toArticleUserMessage } from '../dist/articleErrors.js';

test('filesystem errors are converted without exposing paths', () => {
  const error = Object.assign(new Error("ENOENT: no such file or directory, stat '/srv/qqbot/data/articles/text/秘密.txt'"), {
    code: 'ENOENT', path: '/srv/qqbot/data/articles/text/秘密.txt'
  });
  const message = toArticleUserMessage(error);
  assert.equal(message, '文章或分类不存在，可能已被删除。');
  assert.doesNotMatch(message, /秘密|\/srv|articles/);
});

test('known user errors remain user-facing', () => {
  assert.equal(toArticleUserMessage(articleUserError('文章标题不能包含路径分隔符。')), '文章标题不能包含路径分隔符。');
});

test('batch filesystem failures use a short safe reason', () => {
  const error = Object.assign(new Error("EACCES: permission denied, open '/tmp/qqbot-article-x/a.txt'"), { code: 'EACCES' });
  const message = articleBatchErrorMessage(error);
  assert.equal(message, '文件处理失败，请稍后重试。');
  assert.doesNotMatch(message, /tmp|qqbot-article|a\.txt/);
});

test('wrapped path errors are also hidden when the fs code was lost', () => {
  const message = toArticleUserMessage(new Error('读取失败：/var/lib/qqbot/articles/text/文章.txt'));
  assert.equal(message, '发文操作失败，请稍后重试。');
  assert.doesNotMatch(message, /var|qqbot|文章\.txt/);
});
