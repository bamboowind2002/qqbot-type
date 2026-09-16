import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCategoryName } from '../dist/articleCategories.js';

test('validates category names as safe single path components', () => {
  assert.equal(validateCategoryName('古典'), '古典');
  assert.throws(() => validateCategoryName('古 典'), /空格/);
  assert.throws(() => validateCategoryName('../秘密'), /路径/);
  assert.throws(() => validateCategoryName(''), /不能为空/);
});
