import test from 'node:test';
import assert from 'node:assert/strict';

import { assertUserUploadCapacity, MAX_USER_PRIVATE_SCHEMES, resolveOwnedScheme, resolveUserConfigSelection } from '../dist/wordHintUser.js';

const one = [{ name: '方案甲' }];
const many = [{ name: '方案甲' }, { name: '方案乙' }];

test('single-scheme commands remain compatible without an explicit scheme name', () => {
    assert.equal(resolveOwnedScheme(one, null, '删除词提 <方案名>'), '方案甲');
    assert.deepEqual(resolveUserConfigSelection(one, ['abc'], '设置选重键 <方案名> <值|默认>'), {
        name: '方案甲', value: 'abc'
    });
    assert.deepEqual(resolveUserConfigSelection(one, [], '设置选重键 <方案名> <值|默认>'), {
        name: '方案甲', value: null
    });
});

test('multiple-scheme commands require and validate an explicit owned scheme', () => {
    assert.throws(() => resolveOwnedScheme(many, null, '删除词提 <方案名>'), /多个私人方案/);
    assert.equal(resolveOwnedScheme(many, '方案乙', '删除词提 <方案名>'), '方案乙');
    assert.throws(() => resolveOwnedScheme(many, '他人方案', '删除词提 <方案名>'), /未找到属于你的方案/);
    assert.deepEqual(resolveUserConfigSelection(many, ['方案乙', '默认'], '设置选重键 <方案名> <值|默认>'), {
        name: '方案乙', value: '默认'
    });
    assert.throws(
        () => resolveUserConfigSelection(many, ['默认'], '设置选重键 <方案名> <值|默认>'),
        /多个私人方案/
    );
});

test('owned-scheme resolution reports no registration and malformed configuration commands', () => {
    assert.throws(() => resolveOwnedScheme([], null, '删除词提 <方案名>'), /请先上传/);
    assert.throws(
        () => resolveUserConfigSelection(one, ['方案甲', '默认', '多余'], '设置选重键 <方案名> <值|默认>'),
        /正确格式/
    );
});

test('ordinary users may create at most ten private schemes while retaining same-name updates', () => {
    const nine = Array.from({ length: MAX_USER_PRIVATE_SCHEMES - 1 }, (_, index) => ({ name: `方案${index}` }));
    const ten = [...nine, { name: '已有方案' }];
    const eleven = [...ten, { name: '管理员添加' }];

    assert.doesNotThrow(() => assertUserUploadCapacity(nine, '新方案'));
    assert.throws(
        () => assertUserUploadCapacity(ten, '新方案'),
        error => /最多拥有10个.*请先删除/.test(error.message) && error.userMessage === error.message
    );
    assert.doesNotThrow(() => assertUserUploadCapacity(ten, '已有方案'));
    assert.doesNotThrow(() => assertUserUploadCapacity(eleven, '管理员添加'));
    assert.throws(() => assertUserUploadCapacity(eleven, '另一个新方案'), /当前已有11个.*请先删除/);
});
