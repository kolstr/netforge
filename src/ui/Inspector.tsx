import { useMemo, useState } from 'react'
import { Activity, CheckCircle2, ChevronRight, Eye, Info, Layers, Play, Power, Settings2, Trash2, X, Zap } from 'lucide-react'
import { useApp } from '../store'
import { DeviceIcon, deviceTint } from './common/DeviceIcon'
import { StatusPill } from './common/Modal'

export function Inspector() {
  const store = useApp()
  const sim = store.sim
  const [tableId, setTableId] = useState<string | null>(null)
  const events = useMemo(() => sim.log.slice(-6).reverse(), [sim.log.length, store.rev])
  if (!store.rightOpen) return null

  const device = store.selectedIds.length === 1 ? sim.device(store.selectedIds[0]) : undefined
  const link = store.selectedLinkId ? sim.links.find((l) => l.id === store.selectedLinkId) : undefined
  const tables = device && store.tool === 'inspect' ? sim.inspectData(device.id) : []
  const activeTable = tables.find((t) => t.id === tableId) ?? tables[0]


  return (
    <aside className="flex w-[286px] shrink-0 flex-col border-l border-white/8 bg-ink-900/70">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{device ? 'Device' : link ? 'Link' : 'Overview'}</div>
        <button className="btn-icon" title="Hide inspector" onClick={() => store.setRightOpen(false)}>
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {device && (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/8 bg-ink-950/50 p-3">
              <div className="flex items-start gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10" style={{ backgroundColor: `${deviceTint(device.kind)}18`, color: deviceTint(device.kind) }}>
                  <DeviceIcon kind={device.kind} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-100">{device.name}</div>
                  <div className="text-[10px] text-slate-500">{device.model} · {device.kind}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <StatusPill up={device.power} label={device.power ? 'powered on' : 'powered off'} />
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-slate-400">{device.interfaces.length} ports</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <button className="btn" onClick={() => store.setDialog({ type: 'device', deviceId: device.id, tab: 'config' })}>
                  <Settings2 size={12} /> Configure
                </button>
                <button className={`btn ${store.tool === 'inspect' ? 'btn-primary' : ''}`} onClick={() => store.setTool(store.tool === 'inspect' ? 'select' : 'inspect')}>
                  <Eye size={12} /> Inspect
                </button>
                <button className="btn" onClick={() => { device.power = !device.power; sim.topologyChanged() }}>
                  <Power size={12} /> {device.power ? 'Power off' : 'Power on'}
                </button>
                <button className="btn btn-danger" onClick={() => { store.select([device.id]); store.deleteSelection() }}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label">Interfaces</span>
                <span className="text-[9px] text-slate-600">{sim.portViews(device.id).filter((p) => p.protocolUp).length} up</span>
              </div>
              <div className="overflow-hidden rounded-lg border border-white/8">
                <table className="w-full text-[9px]">
                  <thead className="bg-white/[0.03]">
                    <tr>
                      <th className="table-head px-2 py-1.5">Port</th>
                      <th className="table-head px-1 py-1.5">IP</th>
                      <th className="table-head px-1 py-1.5">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sim.portViews(device.id).map((p) => (
                      <tr key={p.iface.id} className="border-t border-white/5">
                        <td className="px-2 py-1 font-mono text-slate-300">
                          <span className="inline-flex items-center gap-1">
                            <span className={`h-1.5 w-1.5 rounded-full ${!p.adminUp ? 'bg-rose-500' : p.physicalUp ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                            {p.iface.name.replace('GigabitEthernet', 'Gi').replace('FastEthernet', 'Fa').replace('Ethernet', 'Eth')}
                          </span>
                        </td>
                        <td className="px-1 py-1 font-mono text-[8px] text-slate-500">{p.iface.ip ?? (p.iface.dhcp ? 'DHCP' : '—')}</td>
                        <td className="px-1 py-1 text-slate-500">
                          {p.peer ? sim.device(p.peer.deviceId)?.name : p.iface.kind === 'wireless' && sim.wireless.some((w) => w.clientId === device.id) ? 'Wi-Fi' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {device.kind === 'accesspoint' || device.kind === 'homerouter' ? (
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-cyan-200">
                  <Activity size={11} /> Wireless
                </div>
                <div className="mt-1 text-[10px] text-slate-400">
                  SSID <span className="font-mono text-slate-200">{device.kind === 'homerouter' ? device.config.homeRouter?.wireless.ssid : device.interfaces.find((i) => i.kind === 'wireless')?.wireless?.ssid}</span>
                </div>
                <div className="text-[10px] text-slate-500">{sim.rt(device.id).assoc.length} associated client(s)</div>
              </div>
            ) : null}

            {store.tool === 'inspect' && tables.length > 0 && (
              <div className="space-y-2">
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {tables.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTableId(t.id)}
                      className={`shrink-0 rounded-md border px-2 py-1 text-[9px] transition ${activeTable?.id === t.id ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border-white/8 text-slate-500 hover:text-slate-300'}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {activeTable && (
                  <div className="overflow-hidden rounded-lg border border-white/8">
                    <div className="border-b border-white/5 bg-white/[0.03] px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">{activeTable.label}</div>
                    {activeTable.rows.length ? (
                      <div className="max-h-56 overflow-auto">
                        <table className="w-full text-[8.5px]">
                          <thead className="bg-white/[0.02]">
                            <tr>{activeTable.columns.map((c) => <th key={c} className="table-head px-1.5 py-1">{c}</th>)}</tr>
                          </thead>
                          <tbody>
                            {activeTable.rows.slice(0, 80).map((r, i) => (
                              <tr key={i} className="border-t border-white/5">
                                {r.map((cell, j) => <td key={j} className="px-1.5 py-1 font-mono text-slate-400">{cell}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-3 text-[10px] text-slate-600">{activeTable.empty ?? 'No entries yet.'}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {link && !device && (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/8 bg-ink-950/50 p-3">
              <div className="text-sm font-semibold text-slate-100">{link.type} link</div>
              <div className="mt-1 text-[10px] text-slate-500">ID {link.id.slice(-6)}</div>
              <div className="mt-2 flex gap-1.5">
                <StatusPill up={sim.linkUp(link)} label={sim.linkUp(link) ? 'link up' : 'link down'} />
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-slate-400">{link.lengthM ?? 3} m</span>
              </div>
              <div className="mt-3 space-y-2 text-[10px]">
                {[link.a, link.b].map((end, i) => {
                  const d = sim.device(end.deviceId)
                  const iface = d?.interfaces.find((x) => x.id === end.ifaceId)
                  return (
                    <div key={i} className="flex items-center justify-between rounded-md border border-white/8 bg-ink-900/60 px-2 py-1.5">
                      <span className="text-slate-300">{d?.name}</span>
                      <span className="font-mono text-[9px] text-slate-500">{iface?.name}</span>
                    </div>
                  )
                })}
              </div>
              <button className="btn btn-danger mt-3 w-full" onClick={() => store.deleteSelection()}>
                <Trash2 size={12} /> Delete link
              </button>
            </div>
          </div>
        )}

        {!device && !link && (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/8 bg-gradient-to-br from-cyan-400/10 to-indigo-500/5 p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-100">
                <Layers size={13} className="text-cyan-300" /> Workspace
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="Devices" value={sim.listDevices().length} />
                <Stat label="Links" value={sim.links.length} />
                <Stat label="PDUs" value={sim.activeScenario().pdus.length} />
                <Stat label="Events" value={sim.log.length} />
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-white/8 bg-ink-950/50 px-2 py-1.5">
                <span className="text-[10px] text-slate-500">Mode</span>
                <span className={`text-[10px] font-semibold ${sim.mode === 'realtime' ? 'text-emerald-300' : 'text-amber-300'}`}>{sim.mode}</span>
              </div>
            </div>

            {sim.assessment?.enabled && (
              <div className="rounded-xl border border-violet-400/25 bg-violet-400/5 p-3">
                <div className="text-[11px] font-semibold text-violet-200">{sim.assessment.title}</div>
                <div className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-slate-400">{sim.assessment.instructions}</div>
                <button className="btn btn-primary mt-2 w-full" onClick={() => store.runAssessment()}>
                  <CheckCircle2 size={12} /> Check results
                </button>
              </div>
            )}

            <div className="rounded-xl border border-white/8 bg-ink-950/50 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <Activity size={11} className="text-cyan-300" /> Recent events
              </div>
              <div className="mt-2 space-y-1">
                {events.length === 0 && <div className="text-[10px] text-slate-600">No events yet. Send a ping or switch to Simulation Mode.</div>}
                {events.map((e) => (
                  <button key={e.id} onClick={() => store.setDialog({ type: 'pdu-info', eventId: e.id })} className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[8.5px] text-slate-500 hover:bg-white/5 hover:text-slate-300">
                    {e.time.toFixed(3)} {e.type} · {sim.device(e.atDeviceId)?.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/8 bg-ink-950/50 p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <Info size={11} className="text-cyan-300" /> Quick actions
              </div>
              <div className="mt-2 space-y-1.5">
                <button className="btn w-full justify-start" onClick={() => store.setDialog({ type: 'welcome' })}>
                  <Info size={12} /> Quick start guide <ChevronRight size={11} className="ml-auto" />
                </button>
                <button className="btn w-full justify-start" onClick={() => store.loadExample()}>
                  <Zap size={12} /> Load starter lab <ChevronRight size={11} className="ml-auto" />
                </button>
                <button className="btn w-full justify-start" onClick={() => store.setDialog({ type: 'activity' })}>
                  <Play size={12} /> Activity Wizard <ChevronRight size={11} className="ml-auto" />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3 text-[10px] leading-relaxed text-slate-600">
              Tip: press <span className="kbd">Esc</span> to return to the select tool, <span className="kbd">Del</span> to delete a selection, and double-click any device to open its configuration.
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/8 bg-ink-950/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="text-sm font-semibold text-slate-200">{value}</div>
    </div>
  )
}
