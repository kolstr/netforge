import { useState } from 'react'
import { Grid3x3, Layout, MousePointer2, Save, SlidersHorizontal } from 'lucide-react'
import { useApp } from '../../store'
import { Modal, Toggle } from '../common/Modal'

export function PreferencesDialog() {
  const store = useApp()
  const [tab, setTab] = useState<'interface' | 'simulation' | 'about'>('interface')
  const s = store.settings
  return (
    <Modal onClose={() => store.setDialog(null)} title="Preferences" subtitle="Workspace and simulation behavior" width="max-w-2xl">
      <div className="flex gap-4">
        <div className="w-40 shrink-0 space-y-1">
          {[
            { id: 'interface' as const, label: 'Interface', icon: <Layout size={12} /> },
            { id: 'simulation' as const, label: 'Simulation', icon: <SlidersHorizontal size={12} /> },
            { id: 'about' as const, label: 'Storage', icon: <Save size={12} /> },
          ].map((t) => (
            <button key={t.id} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] ${tab === t.id ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-400 hover:bg-white/5'}`} onClick={() => setTab(t.id)}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 space-y-3">
          {tab === 'interface' && (
            <>
              <PrefRow icon={<Grid3x3 size={13} />} title="Show workspace grid" desc="Dotted alignment grid on the logical canvas." checked={s.showGrid} onChange={(v) => store.setSettings({ showGrid: v })} />
              <PrefRow icon={<MousePointer2 size={13} />} title="Snap devices to grid" desc="Round device positions to 20 px increments while dragging." checked={s.snapToGrid} onChange={(v) => store.setSettings({ snapToGrid: v })} />
              <PrefRow icon={<Layout size={13} />} title="Show device labels" desc="Display names, models and IP addresses under each device icon." checked={s.showLabels} onChange={(v) => store.setSettings({ showLabels: v })} />
              <PrefRow icon={<SlidersHorizontal size={13} />} title="Link lights" desc="Draw up/down/activity indicators on both ends of every link." checked={s.showLinkLights} onChange={(v) => store.setSettings({ showLinkLights: v })} />
              <PrefRow icon={<MousePointer2 size={13} />} title="Alignment guides" desc="Highlight alignment while dragging objects near each other." checked={s.alignmentGuides} onChange={(v) => store.setSettings({ alignmentGuides: v })} />
            </>
          )}
          {tab === 'simulation' && (
            <>
              <div className="rounded-lg border border-white/8 bg-ink-950/40 p-3">
                <div className="text-[11px] font-medium text-slate-200">Play speed</div>
                <div className="mt-2 flex items-center gap-2">
                  <input type="range" min={0.25} max={4} step={0.25} value={store.speed} onChange={(e) => store.setSpeed(Number(e.target.value))} className="flex-1" />
                  <span className="w-10 text-right font-mono text-[10px] text-cyan-300">{store.speed}×</span>
                </div>
              </div>
              <div className="rounded-lg border border-white/8 bg-ink-950/40 p-3 text-[10px] leading-relaxed text-slate-500">
                Event List filters, scenario PDUs and capture history are stored per workspace. Simulation mode is deterministic: time only advances when events are processed.
              </div>
            </>
          )}
          {tab === 'about' && (
            <>
              <PrefRow icon={<Save size={13} />} title="Autosave to browser" desc="Persist the workspace in localStorage after every change." checked={s.autoSave} onChange={(v) => store.setSettings({ autoSave: v })} />
              <div className="rounded-lg border border-white/8 bg-ink-950/40 p-3 text-[10px] leading-relaxed text-slate-500">
                Workspaces are stored locally in this browser. Use <span className="text-slate-300">File → Export JSON</span> for a portable file. Clearing browser data removes the local workspace.
              </div>
              <button className="btn btn-danger" onClick={() => { localStorage.removeItem('netforge.topology.v1'); store.setStatus('Local workspace cleared') }}>Clear saved workspace</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function PrefRow({ icon, title, desc, checked, onChange }: { icon: React.ReactNode; title: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/8 bg-ink-950/40 p-3">
      <span className="mt-0.5 text-cyan-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-slate-200">{title}</div>
        <div className="mt-0.5 text-[10px] leading-snug text-slate-500">{desc}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  )
}
