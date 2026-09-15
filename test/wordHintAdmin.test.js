import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AdminCommandError,
    AdminDeleteConfirmationStore,
    assertAdminUploadTarget,
    assertOwnershipChange,
    assertSchemeRename,
    extractDirectAdminCommandText,
    isWordHintAdmin,
    normalizeAdminConfigValue,
    parseWordHintAdminCommand,
    validateSchemeName
} from '../dist/wordHintAdmin.js';

test('only the configured QQ is an administrator', () => {
    assert.equal(isWordHintAdmin(1144107042), true);
    assert.equal(isWordHintAdmin('1144107042'), true);
    assert.equal(isWordHintAdmin(123456789), false);
});

test('extracts only direct command text and ignores replied file content', () => {
    const message = [
        { type: 'reply', data: { id: '123' } },
        { type: 'file', data: { file: 'table.txt' } },
        { type: 'text', data: { text: '码表管理 上传 公共 测试' } }
    ];
    assert.equal(extractDirectAdminCommandText(message), '码表管理 上传 公共 测试');
    assert.equal(extractDirectAdminCommandText(null), '');
});

test('parses public and private create uploads', () => {
    assert.deepEqual(parseWordHintAdminCommand('码表管理 上传 公共 小鹤'), {
        action: 'upload', kind: 'public', name: '小鹤', replace: false
    });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 上传 私人 123456789 五笔'), {
        action: 'upload', kind: 'private', qqid: '123456789', name: '五笔', replace: false
    });
});

test('replacement must be an explicit final argument', () => {
    assert.deepEqual(parseWordHintAdminCommand('码表管理 上传 公共 小鹤 替换'), {
        action: 'upload', kind: 'public', name: '小鹤', replace: true
    });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 上传 私人 123456789 五笔 替换'), {
        action: 'upload', kind: 'private', qqid: '123456789', name: '五笔', replace: true
    });
    assert.throws(
        () => parseWordHintAdminCommand('码表管理 上传 公共 替换'),
        AdminCommandError
    );
    assert.throws(
        () => parseWordHintAdminCommand('码表管理 上传 公共 小鹤 覆盖'),
        AdminCommandError
    );
});

test('parses optional scheme name for administrator upload cancellation', () => {
    assert.deepEqual(parseWordHintAdminCommand('码表管理 取消上传'), {
        action: 'cancel-upload', name: null
    });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 取消上传 五笔'), {
        action: 'cancel-upload', name: '五笔'
    });
    assert.throws(() => parseWordHintAdminCommand('码表管理 取消上传 五笔 多余'), /正确格式/);
});

test('parses list, inspection, configuration, and deletion commands', () => {
    assert.deepEqual(parseWordHintAdminCommand('码表管理 列表'), { action: 'list', kind: '全部', keyword: '' });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 列表 私人 五笔'), { action: 'list', kind: '私人', keyword: '五笔' });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 查看 小鹤'), { action: 'show', name: '小鹤' });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 查QQ 123456789'), { action: 'lookup-qq', qqid: '123456789' });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 设置 小鹤 最大码长 -1'), {
        action: 'set', name: '小鹤', field: '最大码长', value: '-1'
    });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 删除 小鹤'), { action: 'delete', name: '小鹤' });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 确认删除 123456'), { action: 'confirm-delete', token: '123456' });
});

test('parses ownership changes to a QQ or public registration', () => {
    assert.deepEqual(parseWordHintAdminCommand('码表管理 归属 小鹤 123456789'), {
        action: 'ownership',
        name: '小鹤',
        target: { kind: 'private', qqid: '123456789' }
    });
    assert.deepEqual(parseWordHintAdminCommand('码表管理 归属 小鹤 公共'), {
        action: 'ownership',
        name: '小鹤',
        target: { kind: 'public', qqid: null }
    });
    assert.throws(() => parseWordHintAdminCommand('码表管理 归属 小鹤'), /正确格式/);
    assert.throws(() => parseWordHintAdminCommand('码表管理 归属 小鹤 abc'), /完整 QQ 号/);
});

test('parses administrator scheme rename commands', () => {
    assert.deepEqual(parseWordHintAdminCommand('码表管理 重命名 旧方案 新方案'), {
        action: 'rename', oldName: '旧方案', newName: '新方案'
    });
    assert.throws(() => parseWordHintAdminCommand('码表管理 重命名 旧方案'), /正确格式/);
    assert.throws(() => parseWordHintAdminCommand('码表管理 重命名 旧方案 新方案 多余'), /正确格式/);
});

test('validates scheme names and rename collision rules', () => {
    const command = { oldName: '旧方案', newName: '新方案' };
    const current = { name: '旧方案', kind: 'private', qqid: '123456789' };
    assert.doesNotThrow(() => validateSchemeName('新方案'));
    assert.throws(() => validateSchemeName('a'), /长度/);
    assert.throws(() => validateSchemeName('码表管理'), /保留名称/);
    assert.doesNotThrow(() => assertSchemeRename(command, current, null, []));
    assert.throws(() => assertSchemeRename(command, null, null, []), /未找到原方案/);
    assert.throws(() => assertSchemeRename(command, current, { name: '新方案', kind: 'public', qqid: null }, []), /占用/);
    assert.throws(() => assertSchemeRename(command, current, null, ['旧方案']), /a_list\.txt/);
    assert.throws(() => assertSchemeRename({ oldName: '旧方案', newName: '旧方案' }, current, current, []), /无需重命名/);
});

test('ownership changes require an existing scheme and a different target', () => {
    assert.doesNotThrow(() => assertOwnershipChange(
        { name: '小鹤', kind: 'private', qqid: '123456789' },
        { kind: 'private', qqid: '987654321' }
    ));
    assert.doesNotThrow(() => assertOwnershipChange(
        { name: '小鹤', kind: 'private', qqid: '123456789' },
        { kind: 'public', qqid: null }
    ));
    assert.doesNotThrow(() => assertOwnershipChange(
        { name: '小鹤', kind: 'public', qqid: null },
        { kind: 'private', qqid: '123456789' }
    ));
    assert.throws(() => assertOwnershipChange(null, { kind: 'public', qqid: null }), /未找到/);
    assert.throws(() => assertOwnershipChange(
        { name: '小鹤', kind: 'public', qqid: null },
        { kind: 'public', qqid: null }
    ), /无需调整/);
    assert.throws(() => assertOwnershipChange(
        { name: '小鹤', kind: 'private', qqid: '123456789' },
        { kind: 'private', qqid: '123456789' }
    ), /无需调整/);
});

test('QQ lookup requires one complete numeric QQ identifier', () => {
    assert.throws(() => parseWordHintAdminCommand('码表管理 查QQ'), /正确格式/);
    assert.throws(() => parseWordHintAdminCommand('码表管理 查QQ abcdef'), /格式不正确/);
    assert.throws(() => parseWordHintAdminCommand('码表管理 查QQ 1234'), /格式不正确/);
    assert.throws(() => parseWordHintAdminCommand('码表管理 查QQ 123456789 extra'), /正确格式/);
});

test('normalizes and validates configuration values', () => {
    assert.equal(normalizeAdminConfigValue('选重键', '默认'), "_;'4567890");
    assert.equal(normalizeAdminConfigValue('最大码长', '默认'), 4);
    assert.equal(normalizeAdminConfigValue('最大码长', '-1'), -1);
    assert.equal(normalizeAdminConfigValue('标点引导键', '无'), '');
    assert.throws(() => normalizeAdminConfigValue('选重键', 'aa'), /重复/);
    assert.throws(() => normalizeAdminConfigValue('最大码长', '1.5'), /整数/);
});

test('enforces the public upload collision matrix', () => {
    const create = { kind: 'public', replace: false };
    const replace = { kind: 'public', replace: true };
    assert.doesNotThrow(() => assertAdminUploadTarget(create, null));
    assert.throws(() => assertAdminUploadTarget(create, { kind: 'public' }), /替换/);
    assert.doesNotThrow(() => assertAdminUploadTarget(replace, { kind: 'public' }));
    assert.throws(() => assertAdminUploadTarget(replace, null), /没有可替换/);
    assert.throws(() => assertAdminUploadTarget(replace, { kind: 'private' }), /私人方案/);
});

test('enforces the private upload collision matrix', () => {
    const create = { kind: 'private', qqid: '123456789', replace: false };
    const replace = { kind: 'private', qqid: '123456789', replace: true };
    assert.doesNotThrow(() => assertAdminUploadTarget(create, null));
    assert.throws(() => assertAdminUploadTarget(create, { kind: 'public' }), /已被占用/);
    assert.throws(() => assertAdminUploadTarget(create, { kind: 'private', qqid: '123456789' }), /已被占用/);
    assert.doesNotThrow(() => assertAdminUploadTarget(replace, { kind: 'private', qqid: '123456789' }));
    assert.throws(() => assertAdminUploadTarget(replace, null), /没有可替换/);
    assert.throws(
        () => assertAdminUploadTarget(replace, { kind: 'private', qqid: '987654321' }),
        /其他用户/
    );
    assert.throws(() => assertAdminUploadTarget(replace, { kind: 'public' }), /公共方案/);
});

test('delete confirmations are bound, one-shot, and expire', () => {
    let now = 1000;
    let nextToken = 123456;
    const store = new AdminDeleteConfirmationStore({
        ttlMs: 300000,
        now: () => now,
        tokenFactory: () => String(nextToken++)
    });
    const scheme = { name: '小鹤', kind: 'private', qqid: '123456789' };
    const token = store.create('1144107042', scheme);
    assert.throws(() => store.consume('999999999', token), /不匹配/);
    assert.deepEqual(store.consume('1144107042', token), scheme);
    assert.throws(() => store.consume('1144107042', token), /不存在/);

    const expired = store.create('1144107042', scheme);
    now += 300001;
    assert.throws(() => store.consume('1144107042', expired), /过期/);
});
