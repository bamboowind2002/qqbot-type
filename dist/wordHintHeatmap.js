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
        { key: 'ShiftLeft', label: '↑', title: 'Shift', width: 2.25 },
        ...'zxcvbnm'.split('').map(key => ({ key, label: key })),
        { key: ',', label: ',' }, { key: '.', label: '.' }, { key: '/', label: '/' },
        { key: 'ShiftRight', label: '↑', title: 'Shift', width: 2.75 }
    ],
    [
        { key: 'Space', label: 'Space', width: 6 }
    ]
];

const KEY_SET = new Set(KEYBOARD_ROWS.flat().map(key => key.key));
const SHIFTED_KEY_MAP = {
    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6',
    '&': '7', '*': '8', '(': '9', ')': '0', '+': '=',
    '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'",
    '<': ',', '>': '.', '~': '`'
};

function normalizeKey(character) {
    if (character === ' ' || character === '_') return 'Space';
    if (character === '?') return null;
    if (/^[A-Z]$/.test(character)) return character.toLowerCase();
    if (/^[a-z]$/.test(character)) return character;
    if (SHIFTED_KEY_MAP[character]) return SHIFTED_KEY_MAP[character];
    return KEY_SET.has(character) ? character : null;
}

export function buildWordHintHeatmap(showList = []) {
    const counts = Object.fromEntries(KEYBOARD_ROWS.flat().map(key => [key.key, 0]));
    let total = 0;

    for (const item of showList) {
        for (const character of String(item?.code ?? '')) {
            const key = normalizeKey(character);
            if (key === null) continue;
            counts[key]++;
            total++;
        }
    }

    const max = Math.max(0, ...Object.values(counts));
    return {
        rows: KEYBOARD_ROWS,
        counts,
        max,
        total
    };
}
