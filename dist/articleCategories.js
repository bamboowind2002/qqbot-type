import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ARTICLE_CATEGORY_DIR, ARTICLE_TEXT_DIR } from './articlePaths.js';
import { validateArticleTitle } from './articleStorage.js';
import { articleUserError } from './articleErrors.js';

export function validateCategoryName(name) {
  name = String(name ?? '').trim();
  if (!name || name === '.' || name === '..') throw new Error('分类名不能为空。');
  if ([...name].length > 255) throw new Error('分类名不能超过 255 个字符。');
  if (/[\\/\u0000-\u001f\u007f]/u.test(name)) throw new Error('分类名不能包含路径分隔符或控制字符。');
  if (/\p{White_Space}/u.test(name)) throw new Error('分类名不能包含空格或其他空白字符。');
  return name;
}

function categoryPath(name) { return path.join(ARTICLE_CATEGORY_DIR, validateCategoryName(name)); }
function linkPath(category, title) { return path.join(categoryPath(category), `${validateArticleTitle(title)}.txt`); }

export function listCategories() {
  if (!fs.existsSync(ARTICLE_CATEGORY_DIR)) return [];
  return fs.readdirSync(ARTICLE_CATEGORY_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export async function renameArticleCategory(oldCategory, newCategory) {
  oldCategory = validateCategoryName(oldCategory);
  newCategory = validateCategoryName(newCategory);
  if (oldCategory === newCategory) throw new Error('新旧分类名相同，无需重命名。');
  const source = categoryPath(oldCategory), target = categoryPath(newCategory);
  const sourceStat = await fsp.lstat(source).catch(err => {
    if (err.code === 'ENOENT') throw articleUserError(`分类“${oldCategory}”不存在。`, { cause: err });
    throw err;
  });
  if (!sourceStat.isDirectory()) throw new Error(`分类“${oldCategory}”不是目录。`);
  try {
    await fsp.lstat(target);
    throw new Error(`分类“${newCategory}”已存在。`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await fsp.rename(source, target);
  return { oldCategory, newCategory };
}

export async function renameArticleCategoryLinks(oldTitle, newTitle) {
  oldTitle = validateArticleTitle(oldTitle);
  newTitle = validateArticleTitle(newTitle);
  const changes = [];
  for (const category of listCategories()) {
    const dir = categoryPath(category);
    const oldLink = linkPath(category, oldTitle), newLink = linkPath(category, newTitle);
    let oldStat;
    try { oldStat = await fsp.lstat(oldLink); } catch (err) { if (err.code === 'ENOENT') continue; throw err; }
    if (!oldStat.isSymbolicLink()) throw new Error(`分类“${category}”中的文章条目不是软链接。`);
    try {
      await fsp.lstat(newLink);
      throw new Error(`分类“${category}”中已存在文章“${newTitle}”。`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    changes.push({ category, dir, oldLink, newLink });
  }
  const created = [];
  const removed = [];
  try {
    for (const change of changes) {
      await fsp.unlink(change.oldLink);
      removed.push(change);
      await fsp.symlink(path.relative(change.dir, path.join(ARTICLE_TEXT_DIR, `${newTitle}.txt`)), change.newLink, 'file');
      created.push(change);
    }
  } catch (err) {
    for (const change of created) await fsp.unlink(change.newLink).catch(() => {});
    for (const change of removed) await fsp.symlink(path.relative(change.dir, path.join(ARTICLE_TEXT_DIR, `${oldTitle}.txt`)), change.oldLink, 'file').catch(() => {});
    throw err;
  }
  return changes.length;
}

export async function addArticleCategory(category, title) {
  category = validateCategoryName(category); title = validateArticleTitle(title);
  const source = path.join(ARTICLE_TEXT_DIR, `${title}.txt`);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`文章“${title}”不存在。`);
  const dir = categoryPath(category), link = linkPath(category, title);
  await fsp.mkdir(dir, { recursive: true });
  try {
    const stat = await fsp.lstat(link);
    if (stat.isSymbolicLink() && await fsp.readlink(link) === path.relative(dir, source)) return { category, title, existed: true };
    throw new Error(`分类“${category}”中已存在同名条目。`);
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
  await fsp.symlink(path.relative(dir, source), link, 'file');
  return { category, title, existed: false };
}

export async function removeArticleCategory(category, title) {
  category = validateCategoryName(category); title = validateArticleTitle(title);
  const link = linkPath(category, title);
  try {
    await fsp.unlink(link);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw articleUserError(`分类“${category}”中不存在文章“${title}”。`, { cause: err });
    throw err;
  }
  try { if (!(await fsp.readdir(categoryPath(category))).length) await fsp.rmdir(categoryPath(category)); } catch (_) {}
  return { category, title };
}

export function listCategoryArticles(category) {
  const dir = categoryPath(category);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.name.endsWith('.txt') && entry.isSymbolicLink())
    .map(entry => entry.name.slice(0, -4)).filter(title => {
      try { const target = fs.realpathSync(path.join(dir, `${title}.txt`)); return target.startsWith(`${path.resolve(ARTICLE_TEXT_DIR)}${path.sep}`) && fs.statSync(target).isFile(); } catch (_) { return false; }
    }).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export async function removeArticleFromAllCategories(title) {
  title = validateArticleTitle(title); let removed = 0;
  for (const category of listCategories()) {
    try { await fsp.unlink(linkPath(category, title)); removed++; } catch (err) { if (err.code !== 'ENOENT') throw err; }
    try { if (!(await fsp.readdir(categoryPath(category))).length) await fsp.rmdir(categoryPath(category)); } catch (_) {}
  }
  return removed;
}

export function categoryStatus() { return listCategories().map(category => ({ category, titles: listCategoryArticles(category) })); }
