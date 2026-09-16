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
const HEATMAP_STOPS = [
    [222, 235, 247],  // light blue
    [158, 202, 225],  // blue gray
    [66, 146, 198],   // medium blue
    [8, 81, 156]      // dark blue
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

export function getWordHintHeatmapStyle(count, max) {
    if (count <= 0 || max <= 0) {
        return { backgroundColor: '#f2f3f5', borderColor: '#d9dce1', color: '#202124' };
    }

    const position = Math.min(1, count / max) * (HEATMAP_STOPS.length - 1);
    const index = Math.min(HEATMAP_STOPS.length - 2, Math.floor(position));
    const fraction = position - index;
    const rgb = HEATMAP_STOPS[index].map((value, channel) =>
        Math.round(value + (HEATMAP_STOPS[index + 1][channel] - value) * fraction)
    );
    const [r, g, b] = rgb.map(value => value / 255).map(value =>
        value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    );
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return {
        backgroundColor: rgbToHex(rgb),
        borderColor: rgbToHex(rgb.map(value => Math.max(0, Math.round(value * 0.72)))),
        color: luminance < 0.55 ? '#ffffff' : '#202124'
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
