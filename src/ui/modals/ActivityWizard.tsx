import { useState } from 'react'
import { CheckCircle2, FlaskConical, Plus, Play, Trash2, XCircle } from 'lucide-react'
import type { Assessment, AssessmentCheck } from '../../types'
import { useApp } from '../../store'
import { Field, Modal, Toggle } from '../common/Modal'

const KINDS: { id: AssessmentCheck['kind']; label: string }[] = [
  { id: 'connectivity', label: 'Connectivity test' },
  { id: 'interface-ip', label: 'Interface IP' },
  { id: 'hostname', label: 'Hostname' },
  { id: 'vlan', label: 'VLAN exists' },
  { id: 'route', label: 'Route present' },
]

export function ActivityWizard() {
  const store = useApp()
  const sim = store.sim
  const existing = sim.assessment
  const [title, setTitle] = useState(existing?.title ?? 'My Network Activity')
  const [instructions, setInstructions] = useState(
    existing?.instructions ?? 'Complete the network so that every host can reach the server.\n\n1. Configure interface addresses.\n2. Enable routing where needed.\n3. Verify connectivity from each PC.',
  )
  const [checks, setChecks] = useState<AssessmentCheck[]>(existing?.checks ?? [])
  const [tab, setTab] = useState<'instructions' | 'checks'>('instructions')
  const devices = sim.listDevices()

  const addCheck = (kind: AssessmentCheck['kind']) => {
    const d = devices[0]
    const iface = d?.interfaces.find((i) => i.ip || i.kind === 'ethernet')
    setChecks([...checks, {
      id: `check-${Date.now()}-${checks.length}`,
      label: KINDS.find((k) => k.id === kind)?.label ?? 'Check',
      kind,
      sourceId: d?.id,
      destIp: '',
      deviceId: d?.id,
      ifaceId: iface?.id,
      expected: '',
      weight: 10,
    }])
    setTab('checks')
  }

  const updateCheck = (id: string, patch: Partial<AssessmentCheck>) => setChecks((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const save = () => {
    const a: Assessment = { enabled: true, title, instructions, checks }
    store.setAssessment(a)
    store.setDialog(null)
    store.setStatus('Activity saved — use Tools → Check activity')
  }

  return (
    <Modal onClose={() => store.setDialog(null)} width="max-w-4xl" title="Activity Wizard" subtitle="Define instructions and automatically graded checks" icon={<FlaskConical size={17} className="text-violet-300" />}>
      <div className="flex gap-4">
        <div className="w-36 shrink-0 space-y-1">
          <button className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-[11px] ${tab === 'instructions' ? 'bg-violet-400/10 text-violet-200' : 'text-slate-400 hover:bg-white/5'}`} onClick={() => setTab('instructions')}><FlaskConical size={12} /> Instructions</button>
          <button className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-[11px] ${tab === 'checks' ? 'bg-violet-400/10 text-violet-200' : 'text-slate-400 hover:bg-white/5'}`} onClick={() => setTab('checks')}><CheckCircle2 size={12} /> Checks <span className="ml-auto text-[10px] text-slate-600">{checks.length}</span></button>
          <div className="mt-3 border-t border-white/8 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-600">Add check</div>
            {KINDS.map((k) => (
              <button key={k.id} className="mt-1 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[10px] text-slate-500 hover:bg-white/5 hover:text-slate-300" onClick={() => addCheck(k.id)}><Plus size={9} /> {k.label}</button>
            ))}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          {tab === 'instructions' && (
            <div className="space-y-2">
              <Field label="Activity title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label="Instructions">
                <textarea className="input h-52 resize-none font-mono text-[10px] leading-relaxed" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
              </Field>
              <div className="rounded-lg border border-white/8 bg-ink-950/40 p-2 text-[10px] leading-relaxed text-slate-500">
                Students see these instructions in the inspector. Checks are evaluated against the live topology; each check contributes its weight to the score.
              </div>
            </div>
          )}
          {tab === 'checks' && (
            <div className="space-y-2">
              {!checks.length && <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-[10px] text-slate-600">No checks yet. Add one from the left.</div>}
              {checks.map((c) => (
                <div key={c.id} className="rounded-lg border border-white/8 bg-ink-950/40 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <input className="input flex-1" value={c.label} onChange={(e) => updateCheck(c.id, { label: e.target.value })} />
                    <select className="input w-36" value={c.kind} onChange={(e) => updateCheck(c.id, { kind: e.target.value as AssessmentCheck['kind'] })}>
                      {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                    <input type="number" className="input w-16" value={c.weight} onChange={(e) => updateCheck(c.id, { weight: Number(e.target.value) || 1 })} title="Weight" />
                    <button className="text-slate-600 hover:text-rose-300" onClick={() => setChecks(checks.filter((x) => x.id !== c.id))}><Trash2 size={11} /></button>
                  </div>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {(c.kind === 'connectivity' || c.kind === 'custom') && (
                      <>
                        <Field label="Source device">
                          <select className="input text-[10px]" value={c.sourceId ?? ''} onChange={(e) => updateCheck(c.id, { sourceId: e.target.value })}>
                            <option value="">—</option>
                            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Destination IP"><input className="input font-mono text-[10px]" value={c.destIp ?? ''} onChange={(e) => updateCheck(c.id, { destIp: e.target.value })} placeholder="10.10.10.10" /></Field>
                      </>
                    )}
                    {(c.kind === 'interface-ip' || c.kind === 'hostname' || c.kind === 'vlan' || c.kind === 'route') && (
                      <Field label="Device">
                        <select className="input text-[10px]" value={c.deviceId ?? ''} onChange={(e) => updateCheck(c.id, { deviceId: e.target.value })}>
                          <option value="">—</option>
                          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </Field>
                    )}
                    {c.kind === 'interface-ip' && (
                      <>
                        <Field label="Interface">
                          <select className="input text-[10px]" value={c.ifaceId ?? ''} onChange={(e) => updateCheck(c.id, { ifaceId: e.target.value })}>
                            <option value="">—</option>
                            {sim.device(c.deviceId ?? '')?.interfaces.filter((i) => i.kind !== 'console').map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Expected IP"><input className="input font-mono text-[10px]" value={c.expected ?? ''} onChange={(e) => updateCheck(c.id, { expected: e.target.value })} /></Field>
                      </>
                    )}
                    {(c.kind === 'hostname' || c.kind === 'vlan' || c.kind === 'route') && (
                      <Field label="Expected value"><input className="input font-mono text-[10px]" value={c.expected ?? ''} onChange={(e) => updateCheck(c.id, { expected: e.target.value })} placeholder={c.kind === 'vlan' ? '10' : c.kind === 'route' ? '0.0.0.0' : 'hostname'} /></Field>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 border-t border-white/8 pt-3">
            <button className="btn btn-primary" onClick={save} disabled={!checks.length}>Save activity</button>
            <button className="btn" onClick={() => store.runAssessment()} disabled={!checks.length}><Play size={11} /> Check now</button>
            <button className="btn" onClick={() => { store.setAssessment(undefined); store.setDialog(null) }}>Disable</button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] text-slate-500">Enabled</span>
              <Toggle checked={existing?.enabled ?? false} onChange={(v) => { if (existing) store.setAssessment({ ...existing, enabled: v }) }} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function AssessmentDialog({ result }: { result: import('../../sim/engine').AssessmentResult }) {
  const store = useApp()
  const pct = result.total ? Math.round((result.score / result.total) * 100) : 0
  return (
    <Modal onClose={() => store.setDialog(null)} width="max-w-lg" title="Activity Results" subtitle={`${result.items.filter((i) => i.passed).length} of ${result.items.length} checks passed`}>
      <div className="space-y-3">
        <div className="rounded-xl border border-white/8 bg-ink-950/40 p-4 text-center">
          <div className="text-4xl font-bold text-slate-100">{pct}%</div>
          <div className="mt-1 text-[10px] text-slate-500">{result.score} / {result.total} points</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full transition ${pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="space-y-1">
          {result.items.map((i) => (
            <div key={i.id} className="flex items-start gap-2 rounded-lg border border-white/8 bg-ink-950/40 p-2.5">
              {i.passed ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" /> : <XCircle size={14} className="mt-0.5 shrink-0 text-rose-400" />}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-slate-200">{i.label}</div>
                <div className="text-[10px] text-slate-500">{i.detail}</div>
              </div>
              <span className="text-[10px] text-slate-600">{i.weight} pts</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={() => store.runAssessment()}><Play size={11} /> Re-check</button>
          <button className="btn" onClick={() => store.setDialog({ type: 'activity' })}>Edit activity</button>
          <button className="btn ml-auto" onClick={() => store.setDialog(null)}>Close</button>
        </div>
      </div>
    </Modal>
  )
}
