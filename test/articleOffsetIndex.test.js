import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildArticleOffsetIndex, encodeArticleOffsetIndex, decodeArticleOffsetIndex, readRandomArticleSelection } from '../dist/articleOffsetIndex.js';

test('offset index counts code points, skips newlines, and reads from checkpoints', async () => {
  const text = `${'甲😀'.repeat(4097)}\n乙𠀀丙`;
  const file = await fs.mkdtemp(path.join(os.tmpdir(), 'qqbot-index-test-'));
  const filePath = path.join(file, 'article.txt');
  const buffer = Buffer.from(text);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const index = buildArticleOffsetIndex(text, buffer.length, hash);
  const indexPath = path.join(file, 'article.idx');
  await fs.writeFile(filePath, buffer);
  const decoded = decodeArticleOffsetIndex(encodeArticleOffsetIndex(index));
  assert.equal(decoded.compactLength, [...text].filter(char => char !== '\n').length);
  assert.equal(decoded.checkpoints[1].compactPosition, 4096);
  assert.equal(decoded.checkpoints[1].fileByteOffset, Buffer.byteLength([...text].filter(char => char !== '\n').slice(0, 4096).join('')));
  await fs.writeFile(indexPath, encodeArticleOffsetIndex(index));
  assert.equal(await readRandomArticleSelection(filePath, hash, 4090, 20, decoded.compactLength, indexPath), [...text].filter(char => char !== '\n').slice(4090, 4110).join(''));
  await fs.rm(file, { recursive: true, force: true });
});
