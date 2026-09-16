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

test('heatmap colors follow the complete continuous Viridis curve', () => {
    assert.deepEqual(getWordHintHeatmapStyle(0, 10), {
        backgroundColor: '#f2f3f5', borderColor: '#d9dce1', color: '#202124'
    });
    const colors = [1, 9, 25, 49, 81, 100]
        .map(count => getWordHintHeatmapStyle(count, 100).backgroundColor);
    assert.equal(new Set(colors).size, colors.length);
});

test('heatmap maps frequency with log(1+x) normalized to [0, 1]', () => {
    const low = getWordHintHeatmapStyle(1, 144);
    const zero = getWordHintHeatmapStyle(0, 144);
    const high = getWordHintHeatmapStyle(144, 144);

    const lowRgb = low.backgroundColor.match(/[\da-f]{2}/gi).map(value => Number.parseInt(value, 16));
    assert.ok(lowRgb[2] > lowRgb[0]);
    assert.notEqual(low.backgroundColor, zero.backgroundColor);
    assert.equal(getWordHintHeatmapStyle(3, 15).backgroundColor, getWordHintHeatmapStyle(1, 3).backgroundColor);
    assert.notEqual(low.backgroundColor, high.backgroundColor);
});

test('heatmap chooses text color from the actual background brightness', () => {
    assert.equal(getWordHintHeatmapStyle(2, 10).color, '#ffffff');
    assert.equal(getWordHintHeatmapStyle(1, 4).color, '#ffffff');
    assert.equal(getWordHintHeatmapStyle(1, 3).color, '#ffffff');
    assert.equal(getWordHintHeatmapStyle(3, 6).color, '#ffffff');
    assert.equal(getWordHintHeatmapStyle(8, 10).color, '#202124');
});
