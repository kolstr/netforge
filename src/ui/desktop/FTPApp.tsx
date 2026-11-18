import { useState } from 'react'
import { Download, FolderOpen, RefreshCw, Trash2, Upload } from 'lucide-react'
import type { Device } from '../../types'
import { useApp } from '../../store'
import { Field } from '../common/Modal'

export function FTPApp({ device }: { device: Device }) {
  const sim = useApp((s) => s.sim)
  const [host, setHost] = useState('')
  const [user, setUser] = useState('admin')
  const [password, setPassword] = useState('admin')
  const [files, setFiles] = useState<string[]>([])
  const [content, setContent] = useState('')
  const [selected, setSelected] = useState('')
  const [uploadName, setUploadName] = useState('notes.txt')
  const [uploadBody, setUploadBody] = useState('Hello from NetForge FTP.')
  const [status, setStatus] = useState('')

  const call = async (payload: Record<string, unknown>) => {
    setStatus('Contacting FTP server…')
    const res = await sim.ftpRequest(device.id, host, { ...payload, user, password })
    if (!res.ok) {
      setStatus(`Failed: ${res.error ?? 'unknown error'}`)
      return null
    }
    return res
  }

  const list = async () => {
    const res = await call({ action: 'list' })
    if (res) {
      const data = res.data as { files?: string[] } | undefined
      setFiles(data?.files ?? [])
      setStatus(`Connected to ${host} — ${data?.files?.length ?? 0} file(s)`)
    }
  }

  const download = async (file: string) => {
    const res = await call({ action: 'download', file })
    if (res) {
      const data = res.data as { content?: string } | undefined
      setContent(data?.content ?? '')
      setSelected(file)
      setStatus(`Downloaded ${file}`)
    }
  }

  const upload = async () => {
    const res = await call({ action: 'upload', file: uploadName, content: uploadBody })
    if (res) {
      setStatus(`Uploaded ${uploadName}`)
      void list()
    }
  }

  const remove = async (file: string) => {
    const res = await call({ action: 'delete', file })
    if (res) {
      setStatus(`Deleted ${file}`)
      void list()
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="rounded-xl border border-white/10 bg-ink-900 p-4">
        <div className="flex items-center gap-2">
          <FolderOpen size={17} className="text-cyan-300" />
          <div className="text-sm font-semibold text-slate-100">FTP Client</div>
          <span className="ml-auto text-[9px] text-slate-600">{device.name}</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Field label="Server"><input className="input font-mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.10.10.10" /></Field>
          <Field label="User"><input className="input" value={user} onChange={(e) => setUser(e.target.value)} /></Field>
          <Field label="Password"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <div className="flex items-end"><button className="btn btn-primary w-full" onClick={list}>Connect</button></div>
        </div>
        {status && <div className="mt-2 text-[10px] text-cyan-300">{status}</div>}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-ink-900 p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Remote files</div>
            <button className="btn-icon" onClick={list}><RefreshCw size={12} /></button>
          </div>
          <div className="mt-2 space-y-1">
            {!files.length && <div className="py-4 text-center text-[10px] text-slate-600">Connect to list files.</div>}
            {files.map((f) => (
              <div key={f} className={`flex items-center gap-2 rounded border px-2 py-1.5 ${selected === f ? 'border-cyan-400/30 bg-cyan-400/5' : 'border-white/8 bg-ink-950/40'}`}>
                <button className="min-w-0 flex-1 truncate text-left text-[10px] text-slate-300" onClick={() => void download(f)}>{f}</button>
                <button className="text-slate-600 hover:text-cyan-300" title="Download" onClick={() => void download(f)}><Download size={11} /></button>
                <button className="text-slate-600 hover:text-rose-300" title="Delete" onClick={() => void remove(f)}><Trash2 size={11} /></button>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-900 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">File contents</div>
          <pre className="mt-2 min-h-[120px] max-h-56 overflow-auto whitespace-pre-wrap rounded border border-white/8 bg-ink-950/60 p-2 font-mono text-[9px] text-slate-400">{content || 'Select a file to preview.'}</pre>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <input className="input text-[9px]" value={uploadName} onChange={(e) => setUploadName(e.target.value)} />
            <button className="btn" onClick={upload}><Upload size={10} /> Upload</button>
          </div>
          <textarea className="input mt-1 h-16 resize-none text-[9px]" value={uploadBody} onChange={(e) => setUploadBody(e.target.value)} />
        </div>
      </div>
    </div>
  )
}
