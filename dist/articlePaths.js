import path from 'node:path';

export const ARTICLE_DIR = path.resolve(process.env.QQBOT_ARTICLE_DIR || './data/articles');
export const ARTICLE_TEXT_DIR = path.join(ARTICLE_DIR, 'text');
export const ARTICLE_CATEGORY_DIR = path.join(ARTICLE_DIR, 'categories');
