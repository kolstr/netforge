import { describe, expect, it } from 'vitest'
import { tokenizeHtml } from './syntax'

const tokens = (source: string) => tokenizeHtml(source).map((t) => [t.kind, t.text])

describe('tokenizeHtml', () => {
  it('splits tags, attribute names and quoted values', () => {
    expect(tokens('<a href="/x" class=\'y\'>go</a>')).toEqual([
      ['punct', '<'],
      ['tag', 'a'],
      ['text', ' '],
      ['attr', 'href'],
      ['punct', '='],
      ['string', '"/x"'],
      ['text', ' '],
      ['attr', 'class'],
      ['punct', '='],
      ['string', "'y'"],
      ['punct', '>'],
      ['text', 'go'],
      ['punct', '</'],
      ['tag', 'a'],
      ['punct', '>'],
    ])
  })

  it('colours comments and doctypes', () => {
    expect(tokens('<!doctype html><!-- note -->')).toEqual([
      ['doctype', '<!doctype html>'],
      ['comment', '<!-- note -->'],
    ])
  })

  it('keeps style blocks highlighted as CSS', () => {
    expect(tokens('<style>.card {\n  color: red;\n}</style>')).toEqual([
      ['punct', '<'],
      ['tag', 'style'],
      ['punct', '>'],
      ['selector', '.card '],
      ['punct', '{'],
      ['text', '\n  '],
      ['prop', 'color'],
      ['punct', ':'],
      ['text', ' '],
      ['value', 'red'],
      ['punct', ';'],
      ['text', '\n'],
      ['punct', '}'],
      ['punct', '</'],
      ['tag', 'style'],
      ['punct', '>'],
    ])
  })

  it('does not treat script bodies as markup', () => {
    expect(tokens('<script>if (a < b) {}</script>')).toEqual([
      ['punct', '<'],
      ['tag', 'script'],
      ['punct', '>'],
      ['text', 'if (a < b) {}'],
      ['punct', '</'],
      ['tag', 'script'],
      ['punct', '>'],
    ])
  })

  it('round-trips every character of the source', () => {
    const source = '<!doctype html>\n<html>\n  <body class="x">hi & bye<div/></body>\n</html>'
    expect(tokenizeHtml(source).map((t) => t.text).join('')).toBe(source)
  })
})
