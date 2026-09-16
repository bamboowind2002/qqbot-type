import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWordHintHeatmap } from '../dist/wordHintHeatmap.js';

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

test('heatmap uses an up arrow for both Shift keys', () => {
    const shiftKeys = buildWordHintHeatmap().rows.flat().filter(key => key.title === 'Shift');

    assert.equal(shiftKeys.length, 2);
    assert.ok(shiftKeys.every(key => key.label === '↑'));
});
