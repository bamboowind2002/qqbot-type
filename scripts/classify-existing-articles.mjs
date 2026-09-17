import { addArticleCategory } from '../dist/articleCategories.js';
import { listArticles } from '../dist/articleStorage.js';

const category = process.argv[2] || '极速中文网';
const titles = listArticles();
let added = 0;
let existed = 0;
for (const [index, title] of titles.entries()) {
  const result = await addArticleCategory(category, title);
  if (result.existed) existed++;
  else added++;
  if ((index + 1) % 100 === 0 || index + 1 === titles.length) {
    process.stdout.write(`\r已处理 ${index + 1}/${titles.length} 篇`);
  }
}
process.stdout.write(`\n分类“${category}”归类完成：新增 ${added} 篇，已有 ${existed} 篇。\n`);
