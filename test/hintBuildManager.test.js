import test from 'node:test';
import assert from 'node:assert/strict';

import {
    beginLatestUserUpload,
    cancelLatestUserUpload,
    cancelUploadsForSchemes,
    finishLatestUserUpload,
    withUserMutation,
    withUserMutations
} from '../dist/hintBuildManager.js';

test('different scheme uploads for one user remain active independently', () => {
    const first = beginLatestUserUpload('multi-user-1', '方案甲');
    const second = beginLatestUserUpload('multi-user-1', '方案乙');
    assert.equal(first.controller.signal.aborted, false);
    assert.equal(second.controller.signal.aborted, false);
    assert.equal(second.previousState, 'none');
    finishLatestUserUpload(first);
    finishLatestUserUpload(second);
});

test('a newer upload only supersedes an upload with the same scheme name', () => {
    const first = beginLatestUserUpload('multi-user-2', '方案甲');
    const other = beginLatestUserUpload('multi-user-2', '方案乙');
    const replacement = beginLatestUserUpload('multi-user-2', '方案甲');
    assert.equal(first.controller.signal.aborted, true);
    assert.equal(first.controller.signal.reason.code, 'UPLOAD_SUPERSEDED');
    assert.equal(other.controller.signal.aborted, false);
    assert.equal(replacement.previousState, 'cancelled');
    finishLatestUserUpload(first);
    finishLatestUserUpload(other);
    finishLatestUserUpload(replacement);
});

test('cancellation selects a named task or the newest task by default', () => {
    const first = beginLatestUserUpload('multi-user-3', '方案甲');
    const second = beginLatestUserUpload('multi-user-3', '方案乙');
    assert.deepEqual(cancelLatestUserUpload('multi-user-3', '方案甲'), {
        state: 'cancelled', name: '方案甲', phase: '已接收上传请求'
    });
    assert.equal(first.controller.signal.aborted, true);
    assert.equal(second.controller.signal.aborted, false);
    assert.deepEqual(cancelLatestUserUpload('multi-user-3'), {
        state: 'cancelled', name: '方案乙', phase: '已接收上传请求'
    });
    assert.equal(second.controller.signal.aborted, true);
    finishLatestUserUpload(first);
    finishLatestUserUpload(second);
    assert.deepEqual(cancelLatestUserUpload('multi-user-3'), { state: 'none' });
});

test('a committing named upload cannot be cancelled and its replacement is queued', () => {
    const committing = beginLatestUserUpload('multi-user-4', '方案甲');
    committing.cancelable = false;
    assert.deepEqual(cancelLatestUserUpload('multi-user-4', '方案甲'), {
        state: 'committing', name: '方案甲', phase: '已接收上传请求'
    });
    const replacement = beginLatestUserUpload('multi-user-4', '方案甲');
    assert.equal(committing.controller.signal.aborted, false);
    assert.equal(replacement.previousState, 'committing');
    assert.equal(cancelLatestUserUpload('multi-user-4', '方案甲').state, 'cancelled');
    finishLatestUserUpload(replacement);
    assert.equal(cancelLatestUserUpload('multi-user-4', '方案甲').state, 'committing');
    finishLatestUserUpload(committing);
});

test('multi-user mutation locks exclude operations for every named user', async () => {
    let release;
    const blocker = new Promise(resolve => { release = resolve; });
    const entered = [];
    const transfer = withUserMutations(['lock-user-b', 'lock-user-a'], async () => {
        entered.push('transfer');
        await blocker;
    });
    await Promise.resolve();
    const competing = withUserMutation('lock-user-a', async () => {
        entered.push('competing');
    });
    await Promise.resolve();
    assert.deepEqual(entered, ['transfer']);
    release();
    await Promise.all([transfer, competing]);
    assert.deepEqual(entered, ['transfer', 'competing']);
});

test('scheme rename cancellation stops matching uploads across users', () => {
    const oldName = beginLatestUserUpload('rename-user-1', '旧方案');
    const newName = beginLatestUserUpload('rename-user-2', '新方案');
    const unrelated = beginLatestUserUpload('rename-user-3', '其他方案');
    const committing = beginLatestUserUpload('rename-user-4', '旧方案');
    committing.cancelable = false;
    assert.deepEqual(
        cancelUploadsForSchemes(['旧方案', '新方案'], { oldName: '旧方案', newName: '新方案' }),
        { cancelled: 0, committing: 1 }
    );
    assert.equal(oldName.controller.signal.aborted, false);
    assert.equal(newName.controller.signal.aborted, false);
    committing.cancelable = true;
    assert.deepEqual(
        cancelUploadsForSchemes(['旧方案', '新方案'], { oldName: '旧方案', newName: '新方案' }),
        { cancelled: 3, committing: 0 }
    );
    assert.equal(oldName.controller.signal.reason.code, 'UPLOAD_SCHEME_RENAMED');
    assert.equal(oldName.controller.signal.reason.newName, '新方案');
    assert.equal(newName.controller.signal.aborted, true);
    assert.equal(unrelated.controller.signal.aborted, false);
    assert.equal(committing.controller.signal.aborted, true);
    finishLatestUserUpload(oldName);
    finishLatestUserUpload(newName);
    finishLatestUserUpload(unrelated);
    finishLatestUserUpload(committing);
});
