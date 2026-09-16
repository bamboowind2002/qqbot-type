import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWordHintHeatmap, getWordHintHeatmapStyle } from '../dist/wordHintHeatmap.js';

test('heatmap counts actual printable main-keyboard keys case-insensitively', () => {
    const result = buildWordHintHeatmap([
        { code: 'Aa1;' },
        { code: "'_ /" },
        { code: ' ' }
    ]);

    assert.equal(result.counts.a, 2);
    assert.equal(result.counts['1'], 1);
    assert.equal(result.counts[';'], 1);
    assert.equal(result.counts["'"], 1);
    assert.equal(result.counts.Space, 3);
    assert.equal(result.counts['/'], 1);
    assert.equal(result.counts.Space, 3);
    assert.equal(result.total, 9);
    assert.equal(result.max, 3);
});

test('heatmap ignores missing-character question marks and unmapped characters', () => {
    const result = buildWordHintHeatmap([{ code: '??中文😀' }, { code: 'q' }]);

    assert.equal(result.counts.q, 1);
    assert.equal(result.total, 1);
    assert.equal(result.max, 1);
});

test('heatmap returns a zeroed keyboard for empty results', () => {
    const result = buildWordHintHeatmap();

    assert.equal(result.total, 0);
    assert.equal(result.max, 0);
    assert.ok(result.rows.length > 0);
    assert.ok(Object.values(result.counts).every(count => count === 0));
});

test('heatmap displays one left Shift key', () => {
    const shiftKeys = buildWordHintHeatmap().rows.flat().filter(key => key.key === 'ShiftLeft');

    assert.equal(shiftKeys.length, 1);
    assert.equal(shiftKeys[0].label, 'Shift');
});

test('heatmap counts only C++ up-arrow output as left Shift', () => {
    const result = buildWordHintHeatmap([{ code: 'A+_ ↑ ' }]);

    assert.equal(result.counts.a, 1);
    assert.equal(result.counts['+'], undefined);
    assert.equal(result.counts.Space, 3);
    assert.equal(result.counts.ShiftLeft, 1);
    assert.equal(result.counts.ShiftRight, undefined);
});

test('heatmap colors use a linear blue gradient with contrast-aware text', () => {
    assert.deepEqual(getWordHintHeatmapStyle(0, 10), {
        backgroundColor: '#f2f3f5', borderColor: '#d9dce1', color: '#202124'
    });
    assert.deepEqual(getWordHintHeatmapStyle(1, 1), {
        backgroundColor: '#08519c', borderColor: '#063a70', color: '#ffffff'
    });
    assert.notEqual(getWordHintHeatmapStyle(2, 10).backgroundColor, getWordHintHeatmapStyle(8, 10).backgroundColor);
});
