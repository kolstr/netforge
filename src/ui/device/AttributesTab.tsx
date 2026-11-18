import { useState } from 'react'
import { MapPin, Save, Trash2, Power, RefreshCw } from 'lucide-react'
import type { Device } from '../../types'
import { useApp } from '../../store'
import { Field } from '../common/Modal'

export function AttributesTab({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const [notes, setNotes] = useState(device.config.notes ?? '')
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2 rounded-xl border border-white/8 bg-ink-950/40 p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><MapPin size={11} className="text-cyan-300" /> Identity</div>
        <Field label="Device name"><input className="input" defaultValue={device.name} onBlur={(e) => store.updateDevice(device.id, (d) => { d.name = e.target.value; d.config.hostname = e.target.value })} /></Field>
        <Field label="Model"><input className="input" defaultValue={device.model} disabled /></Field>
        <Field label="Kind"><input className="input" defaultValue={device.kind} disabled /></Field>
        <Field label="Internal ID"><input className="input font-mono text-[9px]" defaultValue={device.id} disabled /></Field>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500">
          <div>Workspace X: <span className="text-slate-300">{Math.round(device.x)}</span></div>
          <div>Workspace Y: <span className="text-slate-300">{Math.round(device.y)}</span></div>
        </div>
      </div>
      <div className="space-y-2 rounded-xl border border-white/8 bg-ink-950/40 p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><Save size={11} className="text-cyan-300" /> State & notes</div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" onClick={() => { device.power = !device.power; sim.topologyChanged() }}><Power size={11} /> {device.power ? 'Power off' : 'Power on'}</button>
          <button className="btn" onClick={() => { sim.reloadDevice(device.id); store.bump() }}><RefreshCw size={11} /> Reload</button>
          <button className="btn" onClick={() => { sim.resetStartup(device); store.setStatus('Startup configuration saved') }}><Save size={11} /> Save startup</button>
          <button className="btn btn-danger" onClick={() => { delete device.startup; store.setStatus('Startup configuration erased') }}><Trash2 size={11} /> Erase startup</button>
        </div>
        <Field label="Notes">
          <textarea className="input h-28 resize-none text-[10px]" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => store.updateDevice(device.id, (d) => (d.config.notes = notes))} placeholder="Lab notes, credentials, purpose…" />
        </Field>
        <button className="btn btn-danger w-full" onClick={() => { store.setDialog(null); store.select([device.id]); store.deleteSelection() }}><Trash2 size={11} /> Delete device</button>
      </div>
    </div>
  )
}
