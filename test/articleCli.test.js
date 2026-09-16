import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliLine } from '../article_cli/cli.js';

test('parses local CLI commands without starting the interactive loop', () => {
  assert.deepEqual(parseCliLine('乱 20 1-100'), { command: '乱', args: ['20', '1-100'] });
  assert.deepEqual(parseCliLine('  选 冰灯  '), { command: '选', args: ['冰灯'] });
  assert.equal(parseCliLine(''), null);
});
