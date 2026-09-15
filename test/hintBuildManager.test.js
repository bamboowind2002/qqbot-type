import test from 'node:test';
import assert from 'node:assert/strict';

import {
    beginLatestUserUpload,
    cancelLatestUserUpload,
    finishLatestUserUpload
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
