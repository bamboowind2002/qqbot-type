import { AdminCommandError } from './wordHintAdmin.js';

export const MAX_USER_PRIVATE_SCHEMES = 10;

export function assertUserUploadCapacity(rows, requestedName) {
    if (rows.some(row => row.name === requestedName)) return;
    if (rows.length >= MAX_USER_PRIVATE_SCHEMES) {
        const message = `你当前已有${rows.length}个私人方案，普通用户最多拥有${MAX_USER_PRIVATE_SCHEMES}个；请先删除不需要的方案后再上传新方案。`;
        const error = new AdminCommandError(message);
        error.userMessage = message;
        throw error;
    }
}

export function resolveOwnedScheme(rows, requestedName, usage) {
    if (rows.length === 0) throw new AdminCommandError('请先上传词提。');
    if (requestedName === null) {
        if (rows.length === 1) return rows[0].name;
        throw new AdminCommandError(`你有多个私人方案，请指定方案名。\n正确格式：${usage}`);
    }
    if (!rows.some(row => row.name === requestedName)) {
        throw new AdminCommandError(`未找到属于你的方案“${requestedName}”。`);
    }
    return requestedName;
}

export function resolveUserConfigSelection(rows, args, usage) {
    if (args.length > 2) throw new AdminCommandError(`正确格式：${usage}`);
    if (rows.length > 1 && args.length !== 2) {
        throw new AdminCommandError(`你有多个私人方案，请指定方案名。\n正确格式：${usage}`);
    }
    const requestedName = args.length === 2 ? args[0] : null;
    return {
        name: resolveOwnedScheme(rows, requestedName, usage),
        value: args.length === 2 ? args[1] : (args[0] || null)
    };
}
