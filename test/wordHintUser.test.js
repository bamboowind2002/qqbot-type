import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveOwnedScheme, resolveUserConfigSelection } from '../dist/wordHintUser.js';

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
