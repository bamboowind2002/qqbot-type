import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTICLE_DIR, listArticles } from './articleStorage.js';
import { readArticle } from './articleUser.js';
import { get_rank } from './rank.js';

export const ARTICLE_MAP_PATH = path.join(ARTICLE_DIR, 'difficulty-map.json');
export const ARTICLE_MAP_BLOCK_SIZE = 100;
export const ARTICLE_MAP_MAX_RECORDS = 100_000;
export const ARTICLE_MAP_MAX_PER_ARTICLE = 5_000;

let task = null;
let cancelRequested = false;

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function seededRandom(seed) {
  let state = Number.parseInt(seed.slice(0, 8), 16) || 1;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x1_0000_0000; };
}
async function loadMap() {
  try { return JSON.parse(await fs.readFile(ARTICLE_MAP_PATH, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return { records: [] }; throw err; }
}
async function writeMap(map) {
  await fs.mkdir(path.dirname(ARTICLE_MAP_PATH), { recursive: true });
  const temporary = `${ARTICLE_MAP_PATH}.${process.pid}.${Date.now()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(map), { flag: 'wx' }); await fs.rename(temporary, ARTICLE_MAP_PATH); }
  finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

function sampleStarts(length) {
  const count = Math.max(1, Math.min(ARTICLE_MAP_MAX_PER_ARTICLE, Math.ceil(length / ARTICLE_MAP_BLOCK_SIZE)));
  return Array.from({ length: count }, (_, index) => index * ARTICLE_MAP_BLOCK_SIZE);
}

export function getDifficultyMapStatus() {
  return task ? { ...task, running: true, cancelRequested } : { running: false };
}

export function cancelDifficultyMapSync() {
  if (!task) return false;
  cancelRequested = true;
  return true;
}

export async function syncDifficultyMap() {
  if (task) throw new Error('难度地图正在同步中。');
  task = { processed: 0, total: 0, changed: 0, records: 0, startedAt: Date.now() };
  cancelRequested = false;
  try {
    const oldMap = await loadMap();
    const oldByTitle = new Map();
    for (const record of oldMap.records || []) (oldByTitle.get(record.title) || oldByTitle.set(record.title, []).get(record.title)).push(record);
    const titles = listArticles();
    task.total = titles.length;
    const records = [];
    for (const title of titles) {
      if (cancelRequested) return { cancelled: true, ...getDifficultyMapStatus() };
      const body = await readArticle(title), revision = hash(body), chars = [...body];
      const old = oldByTitle.get(title);
      if (old?.length && old[0].revision === revision) records.push(...old);
      else {
        const random = seededRandom(revision), starts = sampleStarts(chars.length);
        for (const start of starts) {
          const maxStart = Math.max(0, chars.length - ARTICLE_MAP_BLOCK_SIZE);
          const actualStart = Math.min(maxStart, start + Math.floor(random() * Math.min(ARTICLE_MAP_BLOCK_SIZE, Math.max(1, maxStart - start + 1))));
          const text = chars.slice(actualStart, actualStart + ARTICLE_MAP_BLOCK_SIZE).join('');
          const [score, , rank, error] = get_rank(text);
          if (!error && text.length) records.push({ title, revision, start: actualStart, length: [...text].length, score, rank });
        }
        task.changed++;
      }
      task.processed++;
      task.records = records.length;
    }
    const unique = new Map(records.map(record => [`${record.title}:${record.start}`, record]));
    const limited = [...unique.values()].sort((a, b) => hash(`${a.title}:${a.start}`).localeCompare(hash(`${b.title}:${b.start}`))).slice(0, ARTICLE_MAP_MAX_RECORDS);
    const map = { version: 1, updatedAt: new Date().toISOString(), records: limited };
    await writeMap(map);
    task.records = limited.length;
    return { cancelled: false, ...map, changed: task.changed };
  } finally { task = null; cancelRequested = false; }
}
