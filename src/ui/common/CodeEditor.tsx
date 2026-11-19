import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { indentSelection } from './indent'
import { tokenizeHtml, type TokenKind } from './syntax'

const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: 'tok-comment',
  doctype: 'tok-doctype',
  tag: 'tok-tag',
  attr: 'tok-attr',
  string: 'tok-string',
  punct: 'tok-punct',
  selector: 'tok-selector',
  prop: 'tok-prop',
  value: 'tok-value',
  text: 'tok-text',
}

/**
 * Minimal HTML source editor: a transparent textarea layered over a highlighted copy of the same
 * text, so scrolling and the caret stay native while tags/attributes get coloured.
 */
export function CodeEditor({
  defaultValue,
  onBlur,
  className = '',
  label = 'HTML source',
}: {
  defaultValue: string
  onBlur?: (value: string) => void
  className?: string
  label?: string
}) {
  const [text, setText] = useState(defaultValue)
  const preRef = useRef<HTMLPreElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pendingSelection = useRef<[number, number] | null>(null)
  const tokens = useMemo(() => tokenizeHtml(text), [text])

  const syncScroll = () => {
    const input = inputRef.current
    const pre = preRef.current
    if (!input || !pre) return
    pre.scrollTop = input.scrollTop
    pre.scrollLeft = input.scrollLeft
  }

  useLayoutEffect(() => {
    const input = inputRef.current
    const selection = pendingSelection.current
    if (!input || !selection) return
    pendingSelection.current = null
    input.setSelectionRange(selection[0], selection[1])
    syncScroll()
  }, [text])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    const { selectionStart, selectionEnd } = e.currentTarget
    const result = indentSelection(text, selectionStart, selectionEnd, e.shiftKey)
    if (!result) return
    pendingSelection.current = result.selection
    setText(result.text)
  }

  return (
    <div className={`code-editor focus-within:border-cyan-400/50 focus-within:ring-2 focus-within:ring-cyan-400/15 ${className}`}>
      <pre ref={preRef} aria-hidden="true" className="code-editor-layer code-editor-pre">
        {tokens.map((token, index) => (
          <span key={index} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ))}
        {'\n'}
      </pre>
      <textarea
        ref={inputRef}
        aria-label={label}
        className="code-editor-layer code-editor-input"
        spellCheck={false}
        wrap="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => onBlur?.(text)}
        onScroll={syncScroll}
      />
    </div>
  )
}
