import { useState } from 'react'
import { Inbox, Mail, RefreshCw, Send, Settings2, Trash2 } from 'lucide-react'
import type { Device, EmailMessage } from '../../types'
import { useApp } from '../../store'
import { Field } from '../common/Modal'

export function EmailApp({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const [cfg, setCfg] = useState(device.config.emailClient ?? { name: device.name, address: '', incoming: '', outgoing: '', user: '', password: '' })
  const [setup, setSetup] = useState(!device.config.emailClient)
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [tab, setTab] = useState<'inbox' | 'compose'>('inbox')
  const [selected, setSelected] = useState<EmailMessage | null>(null)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const saveCfg = () => {
    store.updateDevice(device.id, (d) => (d.config.emailClient = cfg))
    setSetup(false)
    setStatus('Account settings saved')
  }

  const receive = async () => {
    setBusy(true)
    setStatus('Connecting to POP3 server…')
    const res = await sim.fetchEmail(device.id, cfg)
    setBusy(false)
    if (res.ok) {
      const list = (res.data as EmailMessage[] | undefined) ?? []
      setMessages(list)
      setStatus(list.length ? `Received ${list.length} message(s)` : 'Inbox is empty')
    } else {
      setStatus(`Receive failed: ${res.error ?? 'unknown error'}`)
    }
  }

  const send = async () => {
    if (!to || !subject) {
      setStatus('Recipient and subject are required')
      return
    }
    setBusy(true)
    setStatus('Sending via SMTP…')
    const res = await sim.sendEmail(device.id, cfg, { to, subject, body })
    setBusy(false)
    if (res.ok) {
      setStatus(`Message sent to ${to}`)
      setTo('')
      setSubject('')
      setBody('')
    } else setStatus(`Send failed: ${res.error ?? 'unknown error'}`)
  }

  if (setup) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-white/10 bg-ink-900 p-5">
        <div className="flex items-center gap-2">
          <Mail size={18} className="text-cyan-300" />
          <div>
            <div className="text-sm font-semibold text-slate-100">Email Setup</div>
            <div className="text-[11px] text-slate-500">Configure your mail account</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Field label="Your name"><input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></Field>
          <Field label="Email address"><input className="input" value={cfg.address} onChange={(e) => setCfg({ ...cfg, address: e.target.value })} placeholder="user@mail.local" /></Field>
          <Field label="Incoming server"><input className="input" value={cfg.incoming} onChange={(e) => setCfg({ ...cfg, incoming: e.target.value })} placeholder="10.10.10.10" /></Field>
          <Field label="Outgoing server"><input className="input" value={cfg.outgoing} onChange={(e) => setCfg({ ...cfg, outgoing: e.target.value })} placeholder="10.10.10.10" /></Field>
          <Field label="User name"><input className="input" value={cfg.user} onChange={(e) => setCfg({ ...cfg, user: e.target.value })} /></Field>
          <Field label="Password"><input type="password" className="input" value={cfg.password} onChange={(e) => setCfg({ ...cfg, password: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className="btn btn-primary" onClick={saveCfg}><Settings2 size={12} /> Save account</button>
          <button className="btn" onClick={() => setSetup(false)}>Cancel</button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">The server's Email service must have an account for this user. SMTP is used for outgoing mail and POP3 for incoming mail.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-ink-900">
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        <Mail size={15} className="text-cyan-300" />
        <span className="text-[12px] font-semibold text-slate-200">{cfg.address || 'Email'}</span>
        <div className="ml-3 flex gap-1">
          <button className={`tab ${tab === 'inbox' ? 'tab-active' : 'text-slate-500'}`} onClick={() => setTab('inbox')}><Inbox size={11} className="mr-1 inline" />Inbox</button>
          <button className={`tab ${tab === 'compose' ? 'tab-active' : 'text-slate-500'}`} onClick={() => setTab('compose')}><Send size={11} className="mr-1 inline" />Compose</button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn" onClick={receive} disabled={busy}><RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> Receive</button>
          <button className="btn-icon" title="Account settings" onClick={() => setSetup(true)}><Settings2 size={13} /></button>
        </div>
      </div>
      {status && <div className="border-b border-white/8 bg-cyan-400/5 px-3 py-1 text-[11px] text-cyan-300">{status}</div>}
      <div className="min-h-0 flex-1">
        {tab === 'inbox' ? (
          <div className="flex h-full">
            <div className="w-2/5 overflow-auto border-r border-white/8">
              {!messages.length && <div className="p-4 text-center text-[11px] text-slate-600">Inbox empty. Click Receive to fetch mail.</div>}
              {messages.map((m) => (
                <button key={m.id} className={`block w-full border-b border-white/5 px-3 py-2 text-left hover:bg-white/5 ${selected?.id === m.id ? 'bg-cyan-400/10' : ''}`} onClick={() => setSelected(m)}>
                  <div className="truncate text-[11px] font-medium text-slate-200">{m.subject}</div>
                  <div className="truncate text-[11px] text-slate-500">from {m.from}</div>
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1 overflow-auto p-4">
              {selected ? (
                <>
                  <div className="text-sm font-semibold text-slate-100">{selected.subject}</div>
                  <div className="mt-1 text-[11px] text-slate-500">From: {selected.from} · To: {selected.to}</div>
                  <div className="mt-3 whitespace-pre-wrap border-t border-white/8 pt-3 text-[12px] leading-relaxed text-slate-300">{selected.body}</div>
                  <button className="btn btn-danger mt-4" onClick={() => { setMessages((m) => m.filter((x) => x.id !== selected.id)); setSelected(null) }}><Trash2 size={11} /> Delete</button>
                </>
              ) : <div className="text-[11px] text-slate-600">Select a message to read it.</div>}
            </div>
          </div>
        ) : (
          <div className="space-y-2 p-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="To"><input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="user@mail.local" /></Field>
              <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            </div>
            <Field label="Message"><textarea className="input h-32 resize-none" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <button className="btn btn-primary" onClick={send} disabled={busy}><Send size={12} /> Send</button>
          </div>
        )}
      </div>
    </div>
  )
}
