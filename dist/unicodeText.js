export const CODE_POINT_INDEX_STRIDE = 1024;

export function countCodePoints(text) {
  let length = 0;
  for (const _ of String(text ?? '')) length++;
  return length;
}

export function createCodePointIndex(text, stride = CODE_POINT_INDEX_STRIDE) {
  text = String(text ?? '');
  if (!Number.isInteger(stride) || stride < 1) throw new Error('字符索引步长必须是正整数。');
  const offsets = [0];
  let length = 0, codeUnitOffset = 0;
  for (const char of text) {
    length++;
    codeUnitOffset += char.length;
    if (length % stride === 0) offsets.push(codeUnitOffset);
  }
  return { stride, offsets, length };
}

function locateCodeUnit(text, position, index) {
  position = Math.max(0, Math.min(index.length, position));
  const checkpoint = Math.floor(position / index.stride);
  let codePoint = checkpoint * index.stride;
  let codeUnit = index.offsets[checkpoint] ?? text.length;
  while (codePoint < position && codeUnit < text.length) {
    codeUnit += text.codePointAt(codeUnit) > 0xffff ? 2 : 1;
    codePoint++;
  }
  return codeUnit;
}

export function sliceCodePoints(text, start, length, index = createCodePointIndex(text)) {
  text = String(text ?? '');
  start = Math.trunc(Math.max(0, Math.min(index.length, Number(start) || 0)));
  length = Math.trunc(Math.max(0, Number(length) || 0));
  const end = Math.min(index.length, start + length);
  const codeUnitStart = locateCodeUnit(text, start, index);
  const codeUnitEnd = locateCodeUnit(text, end, index);
  return text.slice(codeUnitStart, codeUnitEnd);
}
