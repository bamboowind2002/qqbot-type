const FILE_SYSTEM_CODES = new Set([
  'EACCES', 'EBUSY', 'EEXIST', 'EISDIR', 'EMFILE', 'ENFILE', 'ENOENT',
  'ENOSPC', 'ENOTDIR', 'EPERM', 'EROFS'
]);

export class ArticleUserError extends Error {
  constructor(message, options = {}) {
    super(String(message), options);
    this.name = 'ArticleUserError';
    this.userMessage = true;
  }
}

export function articleUserError(message, options) {
  return new ArticleUserError(message, options);
}

export function toArticleUserMessage(error, fallback = '发文操作失败，请稍后重试。') {
  if (error?.userMessage === true && error.message) return String(error.message);
  if (FILE_SYSTEM_CODES.has(error?.code)) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return '文章或分类不存在，可能已被删除。';
    if (error.code === 'ENOSPC') return '磁盘空间不足，文章未保存。';
    return '发文所需文件暂时不可用，请稍后重试。';
  }
  // Errors with a system code are never safe to expose: their messages often
  // include absolute paths, temporary directories, or database details.
  if (error?.code) return fallback;
  const message = error?.message ? String(error.message) : '';
  // Some wrappers discard the original fs error code. Do not let their
  // absolute/temporary path leak through the last-resort message either.
  if (/(?:^|[\s("'：:])\/(?:[^\s/]+\/)+|[A-Za-z]:[\\/]|node_modules[\\/]|\/tmp[\\/]/u.test(message)) return fallback;
  return message || fallback;
}

export function articleBatchErrorMessage(error) {
  if (FILE_SYSTEM_CODES.has(error?.code)) return '文件处理失败，请稍后重试。';
  return toArticleUserMessage(error, '文件处理失败，请稍后重试。');
}
