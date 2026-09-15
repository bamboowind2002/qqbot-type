import { randomInt } from 'node:crypto';

export const WORD_HINT_ADMIN_QQ_IDS = new Set(['1144107042']);

export const DEFAULT_WORD_HINT_CONFIG = Object.freeze({
    candidate: "_;'4567890",
    maxlen: 4,
    punct: ''
});

const LIST_KINDS = new Set(['全部', '公共', '私人']);
const CONFIG_FIELDS = new Set(['选重键', '最大码长', '标点引导键']);

export class AdminCommandError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AdminCommandError';
    }
}

export function isWordHintAdmin(userId) {
    return WORD_HINT_ADMIN_QQ_IDS.has(String(userId));
}

export function extractDirectAdminCommandText(message) {
    if (!Array.isArray(message)) return '';
    return message
        .filter(segment => segment?.type === 'text')
        .map(segment => String(segment.data?.text || ''))
        .join('')
        .trim();
}

export function parseWordHintAdminCommand(text) {
    const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (parts[0] !== '码表管理') return null;
    const action = parts[1] || '帮助';

    if (action === '帮助') {
        if (parts.length !== 2 && parts.length !== 1) throw new AdminCommandError('正确格式：码表管理 帮助');
        return { action: 'help' };
    }
    if (action === '列表') {
        if (parts.length > 4) throw new AdminCommandError('正确格式：码表管理 列表 [全部|公共|私人] [关键词]');
        const kind = parts[2] || '全部';
        if (!LIST_KINDS.has(kind)) throw new AdminCommandError('列表类型只能是“全部”“公共”或“私人”。');
        return { action: 'list', kind, keyword: parts[3] || '' };
    }
    if (action === '查看' || action === '删除') {
        if (parts.length !== 3) throw new AdminCommandError(`正确格式：码表管理 ${action} <方案名>`);
        return { action: action === '查看' ? 'show' : 'delete', name: parts[2] };
    }
    if (action === '查QQ') {
        if (parts.length !== 3) throw new AdminCommandError('正确格式：码表管理 查QQ <QQ号>');
        if (!/^\d{5,12}$/.test(parts[2])) throw new AdminCommandError('QQ 号格式不正确。');
        return { action: 'lookup-qq', qqid: parts[2] };
    }
    if (action === '确认删除') {
        if (parts.length !== 3) throw new AdminCommandError('正确格式：码表管理 确认删除 <确认码>');
        return { action: 'confirm-delete', token: parts[2] };
    }
    if (action === '取消上传') {
        if (parts.length !== 2 && parts.length !== 3) throw new AdminCommandError('正确格式：码表管理 取消上传 [方案名]');
        return { action: 'cancel-upload', name: parts[2] || null };
    }
    if (action === '上传') {
        const kind = parts[2];
        const replace = parts.at(-1) === '替换';
        if (kind === '公共') {
            if (parts.length !== (replace ? 5 : 4)) {
                throw new AdminCommandError('正确格式：码表管理 上传 公共 <方案名> [替换]');
            }
            return { action: 'upload', kind: 'public', name: parts[3], replace };
        }
        if (kind === '私人') {
            if (parts.length !== (replace ? 6 : 5)) {
                throw new AdminCommandError('正确格式：码表管理 上传 私人 <QQ号> <方案名> [替换]');
            }
            if (!/^\d{5,12}$/.test(parts[3])) throw new AdminCommandError('目标 QQ 号格式不正确。');
            return { action: 'upload', kind: 'private', qqid: parts[3], name: parts[4], replace };
        }
        throw new AdminCommandError('上传类型只能是“公共”或“私人”。');
    }
    if (action === '设置') {
        if (parts.length !== 5) {
            throw new AdminCommandError('正确格式：码表管理 设置 <方案名> <选重键|最大码长|标点引导键> <值|默认|无>');
        }
        if (!CONFIG_FIELDS.has(parts[3])) throw new AdminCommandError('不支持的配置字段。');
        return { action: 'set', name: parts[2], field: parts[3], value: parts[4] };
    }
    throw new AdminCommandError(`未知的码表管理命令：“${action}”。发送“码表管理 帮助”查看用法。`);
}

export function normalizeAdminConfigValue(field, value) {
    if (field === '选重键') {
        const candidate = value === '默认' ? DEFAULT_WORD_HINT_CONFIG.candidate : value;
        if ([...candidate].length === 0) throw new AdminCommandError('选重键不能为空。');
        if (new Set([...candidate]).size !== [...candidate].length) throw new AdminCommandError('选重键不能包含重复字符。');
        return candidate;
    }
    if (field === '最大码长') {
        if (value === '默认') return DEFAULT_WORD_HINT_CONFIG.maxlen;
        if (!/^-?\d+$/.test(value)) throw new AdminCommandError('最大码长必须是整数或“默认”。');
        const maxlen = Number(value);
        if (!Number.isSafeInteger(maxlen) || maxlen < -2147483648 || maxlen > 2147483647) {
            throw new AdminCommandError('最大码长超出 32 位整数范围。');
        }
        return maxlen;
    }
    if (field === '标点引导键') {
        return value === '默认' || value === '无' ? DEFAULT_WORD_HINT_CONFIG.punct : value;
    }
    throw new AdminCommandError('不支持的配置字段。');
}

export function assertAdminUploadTarget(command, namedScheme) {
    if (command.kind === 'public') {
        if (!command.replace && namedScheme !== null) {
            throw new AdminCommandError('方案名已被占用；如需覆盖同名公共方案，请在命令末尾添加“替换”。');
        }
        if (command.replace && (namedScheme === null || namedScheme.kind !== 'public')) {
            throw new AdminCommandError(namedScheme === null ? '没有可替换的同名公共方案。' : '该名称属于私人方案，不能作为公共方案替换。');
        }
        return;
    }
    if (!command.replace) {
        if (namedScheme !== null) throw new AdminCommandError('方案名已被占用。');
        return;
    }
    if (namedScheme === null) {
        throw new AdminCommandError('目标 QQ 没有可替换的同名私人方案；请去掉命令末尾的“替换”以新建。');
    }
    if (!(namedScheme.kind === 'private' && namedScheme.qqid === command.qqid)) {
        throw new AdminCommandError('该方案名属于公共方案或其他用户，不能替换。');
    }
}

export class AdminDeleteConfirmationStore {
    constructor({ ttlMs = 5 * 60 * 1000, now = () => Date.now(), tokenFactory = () => String(randomInt(100000, 1000000)) } = {}) {
        this.ttlMs = ttlMs;
        this.now = now;
        this.tokenFactory = tokenFactory;
        this.pending = new Map();
    }

    create(adminId, scheme) {
        const token = this.tokenFactory();
        this.pending.set(String(adminId), { token, expiresAt: this.now() + this.ttlMs, scheme: { ...scheme } });
        return token;
    }

    consume(adminId, token) {
        const key = String(adminId);
        const item = this.pending.get(key);
        if (!item || item.token !== token) throw new AdminCommandError('确认码不存在或不匹配，请重新发起删除。');
        this.pending.delete(key);
        if (this.now() > item.expiresAt) throw new AdminCommandError('确认码已过期，请重新发起删除。');
        return item.scheme;
    }
}

export const WORD_HINT_ADMIN_HELP = `管理员码表命令
码表管理 列表 [全部|公共|私人] [关键词]
码表管理 查看 <方案名>
码表管理 查QQ <QQ号>
码表管理 上传 公共 <方案名> [替换]
码表管理 上传 私人 <QQ号> <方案名> [替换]
码表管理 取消上传 [方案名]
码表管理 设置 <方案名> 选重键 <值|默认>
码表管理 设置 <方案名> 最大码长 <整数|默认>
码表管理 设置 <方案名> 标点引导键 <值|无|默认>
码表管理 删除 <方案名>
码表管理 确认删除 <确认码>

上传时请引用私聊中的 .txt 文件。不带“替换”只允许新建；“替换”只覆盖同类型、同归属的同名方案。一个 QQ 可以拥有多个私人方案。`;
