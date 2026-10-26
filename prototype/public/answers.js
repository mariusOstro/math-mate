function normalized(value, unit = '') {
    let text = String(value)
        .trim()
        .toLowerCase()
        .replaceAll('−', '-')
        .replaceAll(',', '.');
    if (unit) {
        const suffix = unit.trim().toLowerCase();
        if (text.endsWith(suffix)) text = text.slice(0, -suffix.length).trim();
    }
    return text.replace(/\s+/g, '').replace(/\.$/, '');
}

function scalar(value) {
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return Number(value);
    const fraction = value.match(/^([+-]?\d+)\/([+-]?\d+)$/);
    if (fraction && Number(fraction[2]) !== 0)
        return Number(fraction[1]) / Number(fraction[2]);
    return NaN;
}

export function checkAnswer(input, expected, unit = '') {
    const actual = normalized(input, unit);
    const answer = normalized(expected, unit);
    if (!actual) return false;
    if (actual === answer) return true;
    const a = scalar(actual);
    const b = scalar(answer);
    return (
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
    );
}
