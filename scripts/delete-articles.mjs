#!/usr/bin/env node

import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import mysql from 'mysql';
import { deleteArticle, removeArticleIndexFile, validateArticleTitle } from '../dist/articleStorage.js';
import { removeArticleCatalog } from '../dist/articleDifficultyCatalog.js';

dotenv.config();

function usage() {
  return `用法：
  node scripts/delete-articles.mjs --titles-file=<文件>
  node scripts/delete-articles.mjs --pattern=<正则>
  node scripts/delete-articles.mjs --titles-file=<文件> --apply --confirm=DELETE
  node scripts/delete-articles.mjs --pattern=<正则> --apply --confirm=DELETE

清单格式：每行一个文章标题；空行和以 # 开头的行会被忽略。
--pattern 按 JavaScript Unicode 正则匹配数据库中的文章标题。
默认只预览，不会删除任何内容。`;
}

export function parseArguments(args) {
  const options = { apply: false, confirm: null, titlesFile: null, pattern: null };
  for (const arg of args) {
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--confirm=')) options.confirm = arg.slice('--confirm='.length);
    else if (arg.startsWith('--titles-file=')) options.titlesFile = arg.slice('--titles-file='.length);
    else if (arg.startsWith('--pattern=')) options.pattern = arg.slice('--pattern='.length);
    else if (arg === '--help' || arg === '-h') return { help: true };
    else throw new Error(`未知参数：${arg}\n${usage()}`);
  }
  if (!options.titlesFile && !options.pattern) throw new Error(`必须指定 --titles-file 或 --pattern。\n${usage()}`);
  if (options.titlesFile && options.pattern) throw new Error('--titles-file 和 --pattern 只能二选一。');
  if (options.pattern) {
    try { options.pattern = new RegExp(options.pattern, 'u'); }
    catch (error) { throw new Error(`正则无效：${error.message}`); }
  }
  if (options.apply && options.confirm !== 'DELETE') {
    throw new Error('真正删除必须同时指定 --apply --confirm=DELETE。');
  }
  if (!options.apply && options.confirm) throw new Error('--confirm 只能与 --apply 一起使用。');
  return options;
}

export function parseTitleList(content) {
  const titles = [];
  const seen = new Set();
  for (const [index, rawLine] of String(content).split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let title;
    try {
      title = validateArticleTitle(line);
    } catch (error) {
      throw new Error(`标题清单第 ${index + 1} 行无效：${error.message}`);
    }
    if (seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

function query(connection, sql, values = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, values, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function closeConnection(connection) {
  return new Promise((resolve, reject) => connection.end(error => error ? reject(error) : resolve()));
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

async function findExistingTitles(connection, titles) {
  if (!titles.length) return [];
  const rows = await query(connection, 'select title from article_catalog where title in (?) order by title', [titles]);
  const existing = new Set(rows.map(row => String(row.title)));
  return titles.filter(title => existing.has(title));
}

async function findPatternTitles(connection, pattern) {
  const rows = await query(connection, 'select title from article_catalog order by title');
  return rows.map(row => String(row.title)).filter(title => {
    pattern.lastIndex = 0;
    return pattern.test(title);
  });
}

export async function deleteOneArticle(connection, title) {
  const rows = await query(connection, 'select index_key from article_catalog where title = ? limit 1', [title]);
  const indexKey = rows[0]?.index_key || null;
  await deleteArticle(title);
  await removeArticleCatalog(connection, title);
  if (indexKey) {
    const references = await query(connection, 'select count(*) as count from article_catalog where index_key = ?', [indexKey]);
    if (!Number(references[0]?.count || 0)) await removeArticleIndexFile(indexKey);
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const titles = options.titlesFile ? parseTitleList(await fs.readFile(options.titlesFile, 'utf8')) : null;
  if (titles && !titles.length) throw new Error('标题清单为空。');

  const connection = mysql.createConnection(databaseConfigFromEnvironment());
  try {
    const existing = options.pattern
      ? await findPatternTitles(connection, options.pattern)
      : await findExistingTitles(connection, titles);
    const existingSet = new Set(existing);
    const missing = titles ? titles.filter(title => !existingSet.has(title)) : [];
    process.stdout.write(options.pattern
      ? `匹配正则：${options.pattern.source}\n`
      : `清单标题：${titles.length} 个\n`);
    process.stdout.write(`数据库中存在：${existing.length} 个\n`);
    process.stdout.write(`数据库中不存在：${missing.length} 个\n`);
    if (missing.length) process.stdout.write(`跳过：${missing.join('、')}\n`);
    if (!options.apply) {
      process.stdout.write('当前为预览模式，未删除任何内容。\n');
      return;
    }

    for (const [index, title] of existing.entries()) {
      await deleteOneArticle(connection, title);
      process.stdout.write(`已删除 ${index + 1}/${existing.length}：${title}\n`);
    }
    process.stdout.write(`批量删除完成：${existing.length} 个。\n`);
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
