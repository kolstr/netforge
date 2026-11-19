const INDENT = '  '
const LEADING = /^(?: {1,2}|\t)/

export interface IndentResult {
  text: string
  selection: [number, number]
}

function lineIndexAt(text: string, offset: number): number {
  let index = 0
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') index += 1
  }
  return index
}

/**
 * Applies one level of indentation (or outdent) to the lines touched by the selection.
 * The selection is shifted along with the text instead of being expanded to whole lines.
 * Returns null when the edit would not change anything.
 */
export function indentSelection(source: string, start: number, end: number, outdent = false): IndentResult | null {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1
  let lineEnd = source.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = source.length
  else if (end > lineStart && source[end - 1] === '\n') lineEnd -= 1

  const block = source.slice(lineStart, lineEnd)
  const deltas: number[] = []
  const nextBlock = block
    .split('\n')
    .map((line) => {
      const next = outdent ? line.replace(LEADING, '') : INDENT + line
      deltas.push(next.length - line.length)
      return next
    })
    .join('\n')
  if (nextBlock === block) return null

  const shift = (pos: number) => {
    let delta = 0
    const index = lineIndexAt(block, pos - lineStart)
    for (let i = 0; i <= index; i += 1) delta += deltas[i] ?? 0
    return Math.min(Math.max(pos + delta, lineStart), lineStart + nextBlock.length)
  }

  return {
    text: source.slice(0, lineStart) + nextBlock + source.slice(lineEnd),
    selection: [shift(start), shift(end)],
  }
}
