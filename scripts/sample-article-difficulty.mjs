#!/usr/bin/env node

import dotenv from 'dotenv';
import mysql from 'mysql';
import { loadDifficultyIndex, weightedDifficultySelection } from '../dist/articleDifficultyCatalog.js';
import { readRandomArticleSelection } from '../dist/articleStorage.js';
import { DIFFICULTY_RANGES, getArticleRank } from '../dist/articleDifficulty.js';

dotenv.config();

export const DIFFICULTY_NAMES = Object.freeze(['淼', '水', '易', '普', '难', '虐', '爆表', '无效']);

function usage() {
  return '用法：node scripts/sample-article-difficulty.mjs <字数> <样本数>';
}

export function parseArguments(args) {
  if (args.length !== 2) throw new Error(usage());
  const length = Number(args[0]);
  const sampleCount = Number(args[1]);
  if (!Number.isSafeInteger(length) || length < 10 || length > 2000) {
    throw new Error('字数必须是 10 至 2000 的整数。');
  }
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new Error('样本数必须是正整数。');
  }
  return { length, sampleCount };
}

export function classifyDifficulty(score, rank, error = false) {
  if (error || !Number.isFinite(score) || score < 0) return '无效';
  for (const name of DIFFICULTY_NAMES.slice(0, 7)) {
    const [low, high] = DIFFICULTY_RANGES[name];
    if (score >= low && score < high) return name;
  }
  return rank && DIFFICULTY_NAMES.includes(rank) ? rank : '无效';
}

export function createCounts() {
  return Object.fromEntries(DIFFICULTY_NAMES.map(name => [name, 0]));
}

export function totalSampleCapacity(index, length) {
  return index.items.reduce((total, item) => total + item.length - length + 1, 0);
}

function query(connection, sql, values = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, values, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function databaseConfigFromEnvironment() {
  const required = ['BOT_DB_HOST', 'BOT_DB_PORT', 'BOT_DB_USER', 'BOT_DB_PASSWORD', 'BOT_DB_NAME'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`缺少数据库环境变量：${missing.join('、')}。`);
  const port = Number(process.env.BOT_DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('BOT_DB_PORT 必须是有效端口。');
  return {
    host: process.env.BOT_DB_HOST,
    port,
    user: process.env.BOT_DB_USER,
    password: process.env.BOT_DB_PASSWORD,
    database: process.env.BOT_DB_NAME,
    charset: 'utf8mb4'
  };
}

function closeConnection(connection) {
  return new Promise((resolve, reject) => connection.end(error => error ? reject(error) : resolve()));
}

function formatPercentage(value, total) {
  return `${(value * 100 / total).toFixed(2)}%`;
}

export function formatReport({ length, requested, counts }) {
  const total = DIFFICULTY_NAMES.reduce((sum, name) => sum + counts[name], 0);
  const lines = [
    `片段长度：${length}`,
    `样本数：${total}/${requested}`,
    '难度\t频数\t占比'
  ];
  for (const name of DIFFICULTY_NAMES) {
    lines.push(`${name}\t${counts[name]}\t${formatPercentage(counts[name], total)}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function collectSamples(index, length, sampleCount, random = Math.random) {
  const capacity = totalSampleCapacity(index, length);
  if (sampleCount > capacity) {
    throw new Error(`唯一样本最多 ${capacity} 个，无法抽取 ${sampleCount} 个。`);
  }

  const samples = new Set();
  const counts = createCounts();
  while (samples.size < sampleCount) {
    const selected = weightedDifficultySelection(index, length, random);
    const key = `${selected.title}:${selected.start}`;
    if (samples.has(key)) continue;
    samples.add(key);

    const result = await readRandomArticleSelection(selected.title, {
      start: selected.start,
      length,
      articleLength: selected.articleLength,
      indexKey: selected.indexKey
    });
    const text = result.text;
    const [score, , rank, error] = getArticleRank(text, selected.title);
    counts[classifyDifficulty(score, rank, error)]++;
  }
  return { counts, sampleCount: samples.size };
}

export async function main(args = process.argv.slice(2)) {
  const { length, sampleCount } = parseArguments(args);
  const connection = mysql.createConnection(databaseConfigFromEnvironment());
  try {
    await query(connection, 'select 1');
    const index = await loadDifficultyIndex(connection);
    if (!index.items.length || !index.items.some(item => item.length >= length)) {
      throw new Error(`难度发文取样池中没有长度达到 ${length} 字的文章。`);
    }
    const result = await collectSamples(index, length, sampleCount);
    process.stdout.write(formatReport({ length, requested: sampleCount, counts: result.counts }));
  } finally {
    await closeConnection(connection).catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`错误：${error.message || error}`);
    process.exitCode = 1;
  });
}
