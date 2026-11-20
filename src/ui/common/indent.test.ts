import { describe, expect, it } from 'vitest'
import { indentSelection } from './indent'

describe('indentSelection', () => {
  it('indents the current line and keeps the caret collapsed', () => {
    expect(indentSelection('<p>x</p>', 3, 3)).toEqual({
      text: '  <p>x</p>',
      selection: [5, 5],
    })
  })

  it('shifts a selection inside one line instead of expanding it', () => {
    expect(indentSelection('<p>abc</p>', 3, 6)).toEqual({
      text: '  <p>abc</p>',
      selection: [5, 8],
    })
  })

  it('indents every line of a multi-line selection', () => {
    const source = '<div>\n<p>a</p>\n<p>b</p>\n</div>'
    expect(indentSelection(source, 6, 21)).toEqual({
      text: '<div>\n  <p>a</p>\n  <p>b</p>\n</div>',
      selection: [8, 25],
    })
  })

  it('does not indent the line after a trailing newline', () => {
    expect(indentSelection('a\nb\nc', 0, 2)).toEqual({
      text: '  a\n  b\nc',
      selection: [2, 6],
    })
  })

  it('outdents up to two leading spaces per line', () => {
    expect(indentSelection('  a\n   b\n', 0, 9, true)).toEqual({
      text: 'a\n b\n',
      selection: [0, 5],
    })
  })

  it('outdents the current line without selecting it', () => {
    expect(indentSelection('  <p>x</p>', 4, 4, true)).toEqual({
      text: '<p>x</p>',
      selection: [2, 2],
    })
  })

  it('clamps the caret when it sits inside the removed indentation', () => {
    expect(indentSelection('  a', 1, 1, true)).toEqual({
      text: 'a',
      selection: [0, 0],
    })
  })

  it('reports no change when there is nothing to outdent', () => {
    expect(indentSelection('a\nb', 0, 3, true)).toBeNull()
  })
})
