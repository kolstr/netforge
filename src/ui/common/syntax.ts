export type TokenKind =
  | 'comment'
  | 'doctype'
  | 'tag'
  | 'attr'
  | 'string'
  | 'punct'
  | 'selector'
  | 'prop'
  | 'value'
  | 'text'

export interface CodeToken {
  text: string
  kind: TokenKind
}

const TAG_OPEN = /^<\/?([a-zA-Z][\w:-]*)/
const ATTR_NAME = /^[^\s=/>]+/
const QUOTED = /^("[^"]*"|'[^']*')/
const WHITESPACE = /^[ \t\r\n]+/
const DOCTYPE = /^<!doctype/i

function tokenizeAttributes(source: string, start: number, tokens: CodeToken[]): number {
  let i = start
  while (i < source.length && source[i] !== '>') {
    const rest = source.slice(i)
    const quoted = QUOTED.exec(rest)
    if (quoted) {
      tokens.push({ text: quoted[0], kind: 'string' })
      i += quoted[0].length
      continue
    }
    const whitespace = WHITESPACE.exec(rest)
    if (whitespace) {
      tokens.push({ text: whitespace[0], kind: 'text' })
      i += whitespace[0].length
      continue
    }
    if (source[i] === '/' || source[i] === '=') {
      tokens.push({ text: source[i], kind: 'punct' })
      i += 1
      continue
    }
    const name = ATTR_NAME.exec(rest)
    if (name) {
      tokens.push({ text: name[0], kind: 'attr' })
      i += name[0].length
      continue
    }
    tokens.push({ text: source[i], kind: 'punct' })
    i += 1
  }
  if (source[i] === '>') {
    tokens.push({ text: '>', kind: 'punct' })
    i += 1
  }
  return i
}

const CSS_DELIMITERS = /[{};:,"'()]/

function tokenizeCss(source: string, start: number, end: number, tokens: CodeToken[]): void {
  let i = start
  let depth = 0
  let expectValue = false

  while (i < end) {
    const ch = source[i]

    if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2)
      const stop = close === -1 || close + 2 > end ? end : close + 2
      tokens.push({ text: source.slice(i, stop), kind: 'comment' })
      i = stop
      continue
    }

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      let j = i
      while (j < end && /\s/.test(source[j])) j += 1
      tokens.push({ text: source.slice(i, j), kind: 'text' })
      i = j
      continue
    }

    if (ch === '"' || ch === "'") {
      const close = source.indexOf(ch, i + 1)
      const stop = close === -1 || close >= end ? end : close + 1
      tokens.push({ text: source.slice(i, stop), kind: 'value' })
      i = stop
      continue
    }

    if (ch === '{') {
      depth += 1
      expectValue = false
      tokens.push({ text: ch, kind: 'punct' })
      i += 1
      continue
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1)
      expectValue = false
      tokens.push({ text: ch, kind: 'punct' })
      i += 1
      continue
    }
    if (ch === ';') {
      expectValue = false
      tokens.push({ text: ch, kind: 'punct' })
      i += 1
      continue
    }
    if (ch === ':' && depth > 0) {
      expectValue = true
      tokens.push({ text: ch, kind: 'punct' })
      i += 1
      continue
    }

    let j = i
    while (j < end && !CSS_DELIMITERS.test(source[j])) j += 1
    if (j === i) {
      tokens.push({ text: ch, kind: 'punct' })
      i += 1
      continue
    }
    tokens.push({ text: source.slice(i, j), kind: depth === 0 ? 'selector' : expectValue ? 'value' : 'prop' })
    i = j
  }
}

export function tokenizeHtml(source: string): CodeToken[] {
  const tokens: CodeToken[] = []
  const lower = source.toLowerCase()
  let i = 0

  while (i < source.length) {
    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4)
      const stop = close === -1 ? source.length : close + 3
      tokens.push({ text: source.slice(i, stop), kind: 'comment' })
      i = stop
      continue
    }

    if (DOCTYPE.test(source.slice(i, i + 9))) {
      const close = source.indexOf('>', i)
      const stop = close === -1 ? source.length : close + 1
      tokens.push({ text: source.slice(i, stop), kind: 'doctype' })
      i = stop
      continue
    }

    const open = TAG_OPEN.exec(source.slice(i))
    if (open) {
      const prefix = open[0].slice(0, open[0].length - open[1].length)
      const name = open[1]
      tokens.push({ text: prefix, kind: 'punct' })
      tokens.push({ text: name, kind: 'tag' })
      i = tokenizeAttributes(source, i + open[0].length, tokens)

      const isOpening = prefix === '<'
      const raw = name.toLowerCase()
      if (isOpening && (raw === 'style' || raw === 'script')) {
        const close = lower.indexOf(`</${raw}`, i)
        const stop = close === -1 ? source.length : close
        if (stop > i) {
          if (raw === 'style') tokenizeCss(source, i, stop, tokens)
          else tokens.push({ text: source.slice(i, stop), kind: 'text' })
          i = stop
        }
      }
      continue
    }

    const next = source.indexOf('<', i)
    if (next === i) {
      tokens.push({ text: '<', kind: 'text' })
      i += 1
      continue
    }
    const stop = next === -1 ? source.length : next
    tokens.push({ text: source.slice(i, stop), kind: 'text' })
    i = stop
  }

  return tokens
}
