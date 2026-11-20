import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Terminal as TerminalIcon } from 'lucide-react'
import { CliSession } from '../../cli/session'
import { useApp } from '../../store'
import type { Device } from '../../types'

interface Line {
  kind: 'input' | 'output' | 'error' | 'system' | 'notice'
  text: string
}

export function CliTab({ device }: { device: Device }) {
  return <CliTerminal deviceId={device.id} access="console" />
}

export function CliTerminal({ deviceId, access = 'console', compact = false }: { deviceId: string; access?: 'console' | 'vty'; compact?: boolean }) {
  const sim = useApp((s) => s.sim)
  const device = sim.device(deviceId)
  const [session, setSession] = useState<CliSession>(() => new CliSession(sim, deviceId, access))
  const [stack, setStack] = useState<CliSession[]>([])
  const [lines, setLines] = useState<Line[]>(() => [
    { kind: 'system', text: `NetForge IOS Software, ${device?.model ?? 'Device'} Software (${device?.model ?? 'NF'}-UNIVERSALK9), Version 15.7(3)M` },
    { kind: 'system', text: 'Copyright (c) NetForge Studio — simulated environment' },
    { kind: 'system', text: '' },
    { kind: 'system', text: 'Press RETURN to get started.' },
    { kind: 'system', text: '' },
  ])
  const [input, setInput] = useState('')
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSession(new CliSession(sim, deviceId, access))
    setStack([])
    setLines([
      { kind: 'system', text: `NetForge IOS Software, ${device?.model ?? 'Device'} Software, Version 15.7(3)M` },
      { kind: 'system', text: 'Copyright (c) NetForge Studio — simulated environment' },
      { kind: 'system', text: '' },
      { kind: 'system', text: 'Press RETURN to get started.' },
      { kind: 'system', text: '' },
    ])
    setInput('')
    setHistoryIdx(-1)
  }, [deviceId, access, sim])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines, busy, session])

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [session])

  const runLine = async (raw: string) => {
    if (busy) return
    const password = session.isPasswordPrompt()
    setLines((l) => [...l, { kind: 'input', text: password ? `${session.prompt()}${'•'.repeat(Math.max(1, raw.length))}` : `${session.prompt()}${raw}` }])
    setInput('')
    setSuggestions([])
    setHistoryIdx(-1)
    setBusy(true)
    try {
      const out = await session.execute(raw)
      if (out) setLines((l) => [...l, { kind: out.startsWith('%') ? 'error' : 'output', text: out }])
      if (session.pendingRemote) {
        const target = session.pendingRemote
        session.pendingRemote = null
        setStack((s) => [...s, session])
        const next = new CliSession(sim, target.deviceId, 'vty')
        const targetDevice = sim.device(target.deviceId)
        setLines((l) => [
          ...l,
          { kind: 'notice', text: `Trying ${targetDevice?.name ?? target.deviceId} ... Open` },
          ...(next.isPasswordPrompt() ? [] : ([
            { kind: 'system', text: '' },
            { kind: 'system', text: `NetForge IOS Software, ${targetDevice?.model ?? 'Device'} Software, Version 15.7(3)M` },
            { kind: 'system', text: `Connected to ${targetDevice?.name ?? target.deviceId} via ${target.protocol.toUpperCase()}.` },
            { kind: 'system', text: '' },
          ] as Line[])),
        ])
        setSession(next)
      } else if (session.closed) {
        setLines((l) => [...l, { kind: 'system', text: 'Session closed.' }])
        if (stack.length) {
          const prev = stack[stack.length - 1]
          setStack((s) => s.slice(0, -1))
          setSession(prev)
        }
      }
    } catch (e) {
      setLines((l) => [...l, { kind: 'error', text: `% ${e instanceof Error ? e.message : 'command failed'}` }])
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!input && session.isPasswordPrompt()) {
        void runLine('')
        return
      }
      void runLine(input)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const candidates = session.completion(input)
      if (candidates.length === 1) {
        setInput(candidates[0])
        setSuggestions([])
      } else if (candidates.length > 1) {
        setSuggestions(candidates)
        setLines((l) => [...l, { kind: 'output', text: candidates.join('    ') }])
      }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!session.history.length) return
      const idx = historyIdx === -1 ? session.history.length - 1 : Math.max(0, historyIdx - 1)
      setHistoryIdx(idx)
      setInput(session.history[idx] ?? '')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx === -1) return
      const idx = historyIdx + 1
      if (idx >= session.history.length) {
        setHistoryIdx(-1)
        setInput('')
      } else {
        setHistoryIdx(idx)
        setInput(session.history[idx] ?? '')
      }
      return
    }
    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault()
      setLines((l) => [...l, { kind: 'input', text: `${session.prompt()}${input}^C` }])
      setInput('')
      return
    }
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setLines([])
    }
  }

  const restart = () => {
    const fresh = new CliSession(sim, deviceId, access)
    setSession(fresh)
    setStack([])
    setLines([
      { kind: 'system', text: `NetForge IOS Software, ${device?.model ?? 'Device'} Software, Version 15.7(3)M` },
      { kind: 'system', text: '' },
      { kind: 'system', text: 'Press RETURN to get started.' },
      { kind: 'system', text: '' },
    ])
    setInput('')
  }

  return (
    <div className={`nf-palette-default flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#03080d] ${compact ? 'flex-1' : 'h-[calc(92vh-160px)] min-h-[420px]'}`}>
      <div className="flex shrink-0 items-center gap-2 border-b border-white/8 bg-ink-900/80 px-3 py-1.5">
        <TerminalIcon size={12} className="text-cyan-300" />
        <span className="font-mono text-[10px] text-slate-300">{device?.name ?? 'Device'} — {access === 'console' ? 'console' : 'vty'} session</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{session.mode}</span>
        <div className="ml-auto flex items-center gap-1">
          {stack.length > 0 && <span className="text-[10px] text-slate-600">{stack.length} nested session(s)</span>}
          <button className="btn-icon" title="Restart session" onClick={restart}><RotateCcw size={12} /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-[1.5]" onClick={() => inputRef.current?.focus()}>
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-words ${line.kind === 'error' ? 'text-rose-300' : line.kind === 'input' ? 'text-slate-200' : line.kind === 'system' ? 'text-slate-500' : line.kind === 'notice' ? 'text-cyan-300' : 'text-slate-400'}`}>
            {line.text || '\u00a0'}
          </div>
        ))}
        {!session.closed && (
          <div className="flex items-center gap-1 text-slate-200">
            <span className="shrink-0 text-cyan-300">{session.prompt()}</span>
            {session.isPasswordPrompt() ? null : (
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); setSuggestions([]) }}
                onKeyDown={onKeyDown}
                className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[11px] text-slate-100 caret-cyan-300 outline-none"
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
              />
            )}
            {session.isPasswordPrompt() && (
              <input
                ref={inputRef}
                value={input}
                type="password"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[11px] text-slate-100 caret-cyan-300 outline-none"
                autoComplete="off"
                disabled={busy}
              />
            )}
            {busy && <span className="animate-pulse text-cyan-400">▊</span>}
          </div>
        )}
        {session.closed && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
            Session closed.
            <button className="btn" onClick={restart}><RotateCcw size={10} /> Reconnect</button>
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="mt-1 rounded border border-white/8 bg-ink-900/60 p-1 text-[10px] text-slate-500">{suggestions.join('   ')}</div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
