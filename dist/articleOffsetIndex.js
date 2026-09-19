import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { ARTICLE_DIR } from './articlePaths.js';

export const ARTICLE_INDEX_DIR = path.join(ARTICLE_DIR, 'random_index');
export const ARTICLE_INDEX_MAGIC = Buffer.from('QQARTIDX');
export const ARTICLE_INDEX_VERSION = 1;
export const ARTICLE_INDEX_STRIDE = 4096;
const HEADER_BYTES = 8 + 4 + 4 + 8 + 8 + 32 + 8;

export function articleIndexPath(indexKey) {
  if (!/^[0-9a-f]{64}$/u.test(String(indexKey))) throw new Error('文章索引键无效。');
  return path.join(ARTICLE_INDEX_DIR, `${indexKey}.idx`);
}

export function buildArticleOffsetIndex(text, fileByteSize, contentSha256, stride = ARTICLE_INDEX_STRIDE) {
  text = String(text);
  if (!Number.isInteger(stride) || stride < 1) throw new Error('文章索引步长无效。');
  if (!Number.isSafeInteger(fileByteSize) || fileByteSize < 0) throw new Error('文章文件大小无效。');
  if (!/^[0-9a-f]{64}$/u.test(String(contentSha256))) throw new Error('文章正文 hash 无效。');
  const checkpoints = [{ compactPosition: 0, fileByteOffset: 0 }];
  let compactPosition = 0, fileByteOffset = 0;
  for (const char of text) {
    fileByteOffset += Buffer.byteLength(char, 'utf8');
    if (char !== '\n') {
      compactPosition++;
      if (compactPosition % stride === 0) checkpoints.push({ compactPosition, fileByteOffset });
    }
  }
  return { stride, compactLength: compactPosition, fileByteSize, contentSha256, checkpoints };
}

export function encodeArticleOffsetIndex(index) {
  const hash = Buffer.from(index.contentSha256, 'hex');
  const output = Buffer.alloc(HEADER_BYTES + index.checkpoints.length * 16);
  ARTICLE_INDEX_MAGIC.copy(output, 0);
  output.writeUInt32LE(ARTICLE_INDEX_VERSION, 8);
  output.writeUInt32LE(index.stride, 12);
  output.writeBigUInt64LE(BigInt(index.compactLength), 16);
  output.writeBigUInt64LE(BigInt(index.fileByteSize), 24);
  hash.copy(output, 32);
  output.writeBigUInt64LE(BigInt(index.checkpoints.length), 64);
  index.checkpoints.forEach((point, i) => {
    const offset = HEADER_BYTES + i * 16;
    output.writeBigUInt64LE(BigInt(point.compactPosition), offset);
    output.writeBigUInt64LE(BigInt(point.fileByteOffset), offset + 8);
  });
  return output;
}

export function decodeArticleOffsetIndex(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_BYTES || !buffer.subarray(0, 8).equals(ARTICLE_INDEX_MAGIC)) {
    throw new Error('文章随机索引格式无效。');
  }
  const version = buffer.readUInt32LE(8), stride = buffer.readUInt32LE(12);
  const compactLength = Number(buffer.readBigUInt64LE(16));
  const fileByteSize = Number(buffer.readBigUInt64LE(24));
  const contentSha256 = buffer.subarray(32, 64).toString('hex');
  const count = Number(buffer.readBigUInt64LE(64));
  if (version !== ARTICLE_INDEX_VERSION || stride < 1 || !Number.isSafeInteger(compactLength) || !Number.isSafeInteger(fileByteSize) ||
      !Number.isSafeInteger(count) || count < 1 || HEADER_BYTES + count * 16 !== buffer.length) throw new Error('文章随机索引内容无效。');
  const checkpoints = [];
  for (let i = 0; i < count; i++) {
    const offset = HEADER_BYTES + i * 16;
    checkpoints.push({ compactPosition: Number(buffer.readBigUInt64LE(offset)), fileByteOffset: Number(buffer.readBigUInt64LE(offset + 8)) });
  }
  if (checkpoints[0].compactPosition !== 0 || checkpoints[0].fileByteOffset !== 0) throw new Error('文章随机索引起点无效。');
  for (let i = 1; i < checkpoints.length; i++) {
    if (checkpoints[i].compactPosition <= checkpoints[i - 1].compactPosition || checkpoints[i].fileByteOffset <= checkpoints[i - 1].fileByteOffset ||
        checkpoints[i].compactPosition > compactLength || checkpoints[i].fileByteOffset > fileByteSize) throw new Error('文章随机索引顺序无效。');
  }
  return { version, stride, compactLength, fileByteSize, contentSha256, checkpoints };
}

export async function writeArticleOffsetIndex(indexKey, index, temporaryPath = null) {
  await fsp.mkdir(ARTICLE_INDEX_DIR, { recursive: true });
  const target = articleIndexPath(indexKey);
  const output = temporaryPath || path.join(ARTICLE_INDEX_DIR, `.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fsp.writeFile(output, encodeArticleOffsetIndex(index), { flag: 'wx' });
    if (!temporaryPath) await fsp.rename(output, target);
  } finally { if (!temporaryPath) await fsp.rm(output, { force: true }).catch(() => {}); }
  return target;
}

function findCheckpoint(checkpoints, position) {
  let low = 0, high = checkpoints.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (checkpoints[middle].compactPosition <= position) low = middle + 1;
    else high = middle;
  }
  return checkpoints[Math.max(0, low - 1)];
}

function indexError(message) { const error = new Error(message); error.code = 'ARTICLE_INDEX_INVALID'; return error; }

export async function readRandomArticleSelection(file, indexKey, start, length, articleLength = null, indexFile = articleIndexPath(indexKey)) {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 0) throw new Error('文章片段范围无效。');
  const index = await fsp.readFile(indexFile).catch(error => { throw indexError(`文章随机索引不可用：${error.message}`); });
  let header;
  try { header = decodeArticleOffsetIndex(index); } catch (error) { throw indexError(error.message); }
  if (header.contentSha256 !== indexKey || (articleLength != null && header.compactLength !== articleLength) || start + length > header.compactLength) throw indexError('文章随机索引与目录不一致。');
  const stat = await fsp.stat(file).catch(error => { throw error; });
  if (stat.size !== header.fileByteSize) throw indexError('文章正文与随机索引不一致。');
  if (length === 0) return '';
  const checkpoint = findCheckpoint(header.checkpoints, start);
  const decoder = new StringDecoder('utf8');
  const stream = fs.createReadStream(file, { start: checkpoint.fileByteOffset });
  let compactPosition = checkpoint.compactPosition;
  const output = [];
  const consume = text => {
    for (const char of text) {
      if (char !== '\n') {
        if (compactPosition >= start && output.length < length) output.push(char);
        compactPosition++;
        if (output.length >= length) return true;
      }
    }
    return false;
  };
  try {
    for await (const chunk of stream) if (consume(decoder.write(chunk))) break;
    if (output.length < length) consume(decoder.end());
  } finally { stream.destroy(); }
  if (output.length !== length) throw indexError('文章正文未能读取完整片段。');
  return output.join('');
}
