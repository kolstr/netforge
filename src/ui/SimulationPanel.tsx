import { useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Filter,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  SkipBack,
  SkipForward,
  Trash2,
  Zap,
} from 'lucide-react'
import { useApp } from '../store'
import type { UserPdu } from '../types'

const PROTOCOLS = ['ICMP', 'ARP', 'DHCP', 'DNS', 'TCP', 'UDP', 'HTTP', 'HTTPS', 'SMTP', 'POP3', 'FTP', 'STP', 'RIP', 'OSPF', 'EIGRP', 'SYSLOG', 'NTP', 'SSH', 'TELNET']

export function SimulationPanel() {
  const store = useApp()
  const sim = store.sim
  const [filterOpen, setFilterOpen] = useState(false)
  const [sceneOpen, setSceneOpen] = useState(false)
  const [descOpen, setDescOpen] = useState(false)
  const scenario = sim.activeScenario()
  const events = sim.log.slice(-500).reverse()

  if (!store.simPanelOpen) {
    return (
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-white/8 bg-ink-900/80 px-3 text-[11px] text-slate-500">
        <button className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200" onClick={() => store.setSimPanelOpen(true)}>
          <ChevronUp size={12} /> Simulation panel
        </button>
        <span className="font-mono text-cyan-200/70">{sim.time.toFixed(3)}s</span>
        <span className="text-slate-600">{sim.log.length} events</span>
        <span className="text-slate-600">{scenario.pdus.length} PDUs</span>
        <div className="ml-auto flex items-center gap-2">
          {sim.mode === 'simulation' && (
            <>
              <button className="btn-icon" onClick={store.backSim} title="Back"><SkipBack size={12} /></button>
              <button className="btn-icon" onClick={store.stepSim} title="Forward"><SkipForward size={12} /></button>
              <button className="btn-icon" onClick={store.togglePlay} title="Play"><Play size={12} /></button>
            </>
          )}
        </div>
      </div>
    )
  }

  const fire = (pdu: UserPdu) => {
    sim.firePdu(pdu.id)
    store.bump()
  }

  return (
    <div className="flex h-[210px] shrink-0 flex-col border-t border-white/8 bg-ink-900/85">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/8 px-2.5">
        <button className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200" onClick={() => store.setSimPanelOpen(false)}>
          <ChevronDown size={12} /> Simulation
        </button>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sim.mode === 'simulation' ? 'bg-amber-400/15 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'}`}>
          {sim.mode}
        </span>
        <div className="ml-1 flex items-center gap-0.5 rounded-md border border-white/8 bg-ink-950/50 p-0.5">
          <button className="btn-icon" title="Power cycle all devices" onClick={() => sim.powerCycle()}><Zap size={13} /></button>
          <button className="btn-icon" title="Reset simulation" onClick={store.resetSim}><RotateCcw size={13} /></button>
          {sim.mode === 'simulation' && (
            <>
              <button className="btn-icon" title="Back" onClick={store.backSim} disabled={!sim.history.length}><SkipBack size={13} /></button>
              <button className="btn-icon" title="Capture / Forward" onClick={store.stepSim}><SkipForward size={13} /></button>
              <button className={`btn-icon ${store.playing ? 'text-amber-300' : ''}`} title="Auto capture / Play" onClick={store.togglePlay}>
                {store.playing ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <div className="flex items-center gap-1 px-1">
                <Activity size={11} className="text-slate-600" />
                <input type="range" min={0.25} max={4} step={0.25} value={store.speed} onChange={(e) => store.setSpeed(Number(e.target.value))} className="h-1 w-16" />
              </div>
            </>
          )}
        </div>
        <button className="btn ml-1" onClick={() => { store.setTool('pdu-simple'); store.setStatus('Click a source device, then a destination') }}>
          <Send size={12} /> Simple PDU
        </button>
        <button className="btn" onClick={() => store.setDialog({ type: 'complex-pdu' })}>
          <ArrowUpRight size={12} /> Custom PDU
        </button>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button className="btn" onClick={() => setFilterOpen(!filterOpen)}>
              <Filter size={12} /> Filters {sim.filters.size ? `(${sim.filters.size})` : ''}
            </button>
            {filterOpen && (
              <div className="absolute bottom-9 right-0 z-40 w-64 rounded-lg border border-white/10 bg-ink-850/98 p-2 shadow-2xl">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Event filters</span>
                  <button className="text-[11px] text-cyan-300 hover:underline" onClick={() => { sim.filters.clear(); sim.bump() }}>Show all</button>
                </div>
                <div className="grid max-h-52 grid-cols-2 gap-0.5 overflow-y-auto">
                  {PROTOCOLS.map((p) => {
                    const checked = sim.filters.size === 0 || sim.filters.has(p)
                    return (
                      <label key={p} className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (sim.filters.size === 0) {
                              // switching off one protocol means "only everything except this"
                              PROTOCOLS.forEach((x) => sim.filters.add(x))
                            }
                            if (checked) sim.filters.delete(p)
                            else sim.filters.add(p)
                            sim.bump()
                          }}
                          className="accent-cyan-400"
                        />
                        {p}
                      </label>
                    )
                  })}
                </div>
                <button className="btn mt-1 w-full" onClick={() => { PROTOCOLS.forEach((p) => sim.filters.add(p)); sim.bump() }}>Select all</button>
              </div>
            )}
          </div>
          <span className="font-mono text-[11px] text-slate-500">{events.length} events</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-white/8">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full table-fixed border-collapse text-[9.5px]">
              <thead className="sticky top-0 z-10 bg-ink-850">
                <tr>
                  <th className="table-head w-[48px] px-2 py-1.5">Time</th>
                  <th className="table-head w-[70px] px-2 py-1.5">Last</th>
                  <th className="table-head w-[76px] px-2 py-1.5">At</th>
                  <th className="table-head w-[58px] px-2 py-1.5">Type</th>
                  <th className="table-head px-2 py-1.5">Info</th>
                </tr>
              </thead>
              <tbody>
                {!events.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-[11px] text-slate-600">
                      No events captured. Add a PDU and press <span className="kbd">Capture / Forward</span> or switch to Realtime.
                    </td>
                  </tr>
                )}
                {events.map((e) => {
                  const last = e.lastDeviceId ? sim.device(e.lastDeviceId) : undefined
                  const at = sim.device(e.atDeviceId)
                  return (
                    <tr
                      key={e.id}
                      className={`cursor-pointer border-t border-white/5 transition hover:bg-white/5 ${e.visible && sim.mode === 'simulation' ? 'bg-cyan-400/[0.06]' : ''}`}
                      onClick={() => store.setDialog({ type: 'pdu-info', eventId: e.id })}
                    >
                      <td className="px-2 py-1 font-mono text-slate-500">{e.time.toFixed(3)}</td>
                      <td className="px-2 py-1 text-slate-500">{last?.name ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-300">{at?.name ?? '—'}</td>
                      <td className="px-2 py-1">
                        <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-cyan-200/80">{e.type}</span>
                      </td>
                      <td className="max-w-[420px] truncate px-2 py-1 font-mono text-[11px] text-slate-500">{e.info}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex h-7 shrink-0 items-center gap-3 border-t border-white/8 px-2.5 text-[11px] text-slate-600">
            <span>{sim.mode === 'simulation' ? `batch ${sim.batch}` : 'realtime capture'}</span>
            <span>{sim.queue.length} queued</span>
            <span>{sim.filters.size ? `${sim.filters.size} filters active` : 'all protocols'}</span>
            <button className="ml-auto text-slate-500 hover:text-slate-300" onClick={() => { sim.log = []; sim.bump() }}>Clear events</button>
          </div>
        </div>

        <div className="flex w-[42%] min-w-[230px] max-w-[400px] shrink-0 flex-col">
          <div className="relative flex items-center gap-1.5 border-b border-white/8 px-2.5 py-1.5">
            <button className="flex min-w-0 flex-1 items-center gap-1 rounded border border-white/8 bg-ink-950/50 px-2 py-1 text-[11px] text-slate-300" onClick={() => setSceneOpen(!sceneOpen)}>
              <span className="truncate">{scenario.name}</span>
              <ChevronDown size={10} className="ml-auto text-slate-500" />
            </button>
            {sceneOpen && (
              <div className="absolute left-1 top-9 z-40 w-52 rounded-lg border border-white/10 bg-ink-850/98 p-1 shadow-2xl">
                {sim.scenarios.map((s) => (
                  <button key={s.id} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${s.id === sim.activeScenarioId ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-400 hover:bg-white/5'}`} onClick={() => { sim.activeScenarioId = s.id; sim.bump(); setSceneOpen(false) }}>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-[11px] text-slate-600">{s.pdus.length} PDUs</span>
                  </button>
                ))}
                <div className="mt-1 flex gap-1 border-t border-white/8 pt-1">
                  <button className="btn flex-1" onClick={() => { sim.addScenario(); store.bump() }}><Plus size={10} /> New</button>
                  <button className="btn flex-1" onClick={() => { sim.removeScenario(sim.activeScenarioId); store.bump() }} disabled={sim.scenarios.length <= 1}><Trash2 size={10} /> Delete</button>
                </div>
              </div>
            )}
            <button className="btn-icon" title="Scenario description" onClick={() => setDescOpen(!descOpen)}><Settings2 size={12} /></button>
          </div>
          {descOpen && (
            <div className="border-b border-white/8 p-2">
              <textarea
                defaultValue={scenario.description}
                placeholder="Describe this scenario…"
                className="input h-14 resize-none text-[11px]"
                onBlur={(e) => { scenario.description = e.target.value; sim.bump(); store.saveLocal() }}
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 z-10 bg-ink-850">
                <tr>
                  <th className="table-head px-1.5 py-1.5">Fire</th>
                  <th className="table-head px-1.5 py-1.5">Status</th>
                  <th className="table-head px-1.5 py-1.5">Source</th>
                  <th className="table-head px-1.5 py-1.5">Destination</th>
                  <th className="table-head px-1.5 py-1.5">Type</th>
                  <th className="table-head px-1.5 py-1.5">Time</th>
                  <th className="table-head px-1 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {!scenario.pdus.length && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-[11px] text-slate-600">No PDUs in this scenario.<br />Use the Simple PDU or Custom PDU tools.</td></tr>
                )}
                {scenario.pdus.map((pdu) => (
                  <tr key={pdu.id} className="border-t border-white/5">
                    <td className="px-1.5 py-1">
                      <button className="flex h-5 w-5 items-center justify-center rounded border border-white/10 text-slate-400 hover:bg-white/10 hover:text-cyan-200" title="Fire PDU" onClick={() => fire(pdu)}>
                        <Play size={9} />
                      </button>
                    </td>
                    <td className="px-1.5 py-1">
                      <span className={`inline-flex items-center gap-1 text-[11px] ${pdu.status === 'success' ? 'text-emerald-300' : pdu.status === 'fail' ? 'text-rose-300' : pdu.status === 'in-progress' ? 'text-amber-300' : 'text-slate-500'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${pdu.status === 'success' ? 'bg-emerald-400' : pdu.status === 'fail' ? 'bg-rose-400' : pdu.status === 'in-progress' ? 'bg-amber-400' : 'bg-slate-600'}`} />
                        {pdu.status === 'in-progress' ? 'running' : pdu.status}
                      </span>
                    </td>
                    <td className="px-1.5 py-1 text-slate-300">{sim.device(pdu.sourceId)?.name ?? '—'}</td>
                    <td className="px-1.5 py-1 text-slate-400">{pdu.destId ? sim.device(pdu.destId)?.name : pdu.destIp ?? '—'}</td>
                    <td className="px-1.5 py-1 font-mono text-[11px] text-cyan-200/70">{pdu.type}</td>
                    <td className="px-1.5 py-1 font-mono text-slate-500">{pdu.time.toFixed(1)}s{pdu.periodic ? ' ↻' : ''}</td>
                    <td className="px-1 py-1">
                      <button className="text-slate-600 hover:text-rose-300" title="Remove PDU" onClick={() => store.removePdu(pdu.id)}><Trash2 size={10} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex h-7 shrink-0 items-center justify-between border-t border-white/8 px-2.5 text-[11px] text-slate-600">
            <span>{scenario.pdus.length} user PDU(s)</span>
            <span>idle PDUs fire on Play</span>
          </div>
        </div>
      </div>
    </div>
  )
}
