const KEYBOARD_ROWS = [
    [
        { key: 'Escape', label: 'Esc', width: 1.5 },
        { key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' },
        { key: '4', label: '4' }, { key: '5', label: '5' }, { key: '6', label: '6' },
        { key: '7', label: '7' }, { key: '8', label: '8' }, { key: '9', label: '9' },
        { key: '0', label: '0' }, { key: '-', label: '-' }, { key: '=', label: '=' },
        { key: 'Backspace', label: '⌫', width: 2 }
    ],
    [
        { key: 'Tab', label: 'Tab', width: 1.5 },
        ...'qwertyuiop'.split('').map(key => ({ key, label: key })),
        { key: '[', label: '[' }, { key: ']', label: ']' }, { key: '\\', label: '\\' }
    ],
    [
        { key: 'CapsLock', label: 'Caps', width: 1.75 },
        ...'asdfghjkl'.split('').map(key => ({ key, label: key })),
        { key: ';', label: ';' }, { key: "'", label: "'" },
        { key: 'Enter', label: 'Enter', width: 2.25 }
    ],
    [
        { key: 'ShiftLeft', label: 'Shift', title: '左 Shift', width: 2.25 },
        ...'zxcvbnm'.split('').map(key => ({ key, label: key })),
        { key: ',', label: ',' }, { key: '.', label: '.' }, { key: '/', label: '/' }
    ],
    [
        { key: 'Space', label: 'Space', width: 6 }
    ]
];

const KEY_SET = new Set(KEYBOARD_ROWS.flat().map(key => key.key));
// Google's complete Turbo colormap polynomial approximation. Keep the full
// [0, 1] range so the low end starts at purple and the high end finishes red.
const TURBO_COEFFICIENTS = [
    [0.13572138, 4.61539260, -42.66032258, 132.13108234, -152.94239396, 59.28637943],
    [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604],
    [0.10667330, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973]
];
function normalizeKey(character) {
    if (character === '↑') return { key: 'ShiftLeft', shifted: false };
    if (character === ' ' || character === '_') return { key: 'Space', shifted: false };
    if (character === '?') return null;
    if (/^[A-Z]$/.test(character)) return { key: character.toLowerCase(), shifted: false };
    if (/^[a-z]$/.test(character)) return { key: character, shifted: false };
    return KEY_SET.has(character) ? { key: character, shifted: false } : null;
}

function rgbToHex(rgb) {
    return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function heatmapColor(intensity) {
    const t = Math.max(0, Math.min(1, intensity));
    const powers = [1, t, t ** 2, t ** 3, t ** 4, t ** 5];
    return TURBO_COEFFICIENTS.map(coefficients => Math.max(0, Math.min(255, Math.round(
        coefficients.reduce((sum, coefficient, index) =>
            sum + coefficient * powers[index], 0) * 255
    ))));
}

function foregroundFor(rgb) {
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    return brightness < 150 ? '#ffffff' : '#202124';
}

export function getWordHintHeatmapStyle(count, max) {
    if (count <= 0 || max <= 0) {
        return { backgroundColor: '#f2f3f5', borderColor: '#d9dce1', color: '#202124' };
    }

    const intensity = Math.min(1, count / max);
    const rgb = heatmapColor(intensity);
    return {
        backgroundColor: rgbToHex(rgb),
        borderColor: rgbToHex(rgb.map(value => Math.max(0, Math.round(value * 0.72)))),
        color: foregroundFor(rgb)
    };
}

export function buildWordHintHeatmap(showList = []) {
    const counts = Object.fromEntries(KEYBOARD_ROWS.flat().map(key => [key.key, 0]));
    let total = 0;

    for (const item of showList) {
        for (const character of String(item?.code ?? '')) {
            const result = normalizeKey(character);
            if (result === null) continue;
            counts[result.key]++;
            total++;
        }
    }

    const max = Math.max(0, ...Object.values(counts));
    return {
        rows: KEYBOARD_ROWS,
        counts,
        max,
        total,
        styles: Object.fromEntries(Object.keys(counts).map(key => [key, getWordHintHeatmapStyle(counts[key], max)]))
    };
}
