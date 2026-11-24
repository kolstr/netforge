import { useState } from 'react'
import { Boxes, Check, CircleDot, Power, Zap } from 'lucide-react'
import type { Device } from '../../types'
import { DEVICE_SPECS } from '../../data/catalog'
import { useApp } from '../../store'
import { formatIpWithMask } from '../../lib/ip'
import { DeviceIcon, deviceTint } from '../common/DeviceIcon'
import { StatusPill, Toggle } from '../common/Modal'
import { shortIfaceName } from '../../sim/runtime'

export function PhysicalTab({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const spec = DEVICE_SPECS[device.kind]
  const [selectedPort, setSelectedPort] = useState<string | null>(null)
  const detail = selectedPort ? sim.portDetail(device.id, selectedPort) : null

  const togglePower = () => {
    device.power = !device.power
    sim.topologyChanged()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-ink-800 to-ink-950 p-5">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20 blur-3xl" style={{ backgroundColor: deviceTint(device.kind) }} />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.03] shadow-inner" style={{ color: deviceTint(device.kind) }}>
                <DeviceIcon kind={device.kind} size={42} />
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-100">{device.name}</div>
                <div className="text-[12px] text-slate-500">{device.model} · {device.kind}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <StatusPill up={device.power} label={device.power ? 'powered on' : 'powered off'} />
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">{device.modules.length} modules</span>
                </div>
              </div>
            </div>
            <button
              onClick={togglePower}
              className={`flex h-12 w-12 items-center justify-center rounded-full border-2 transition ${device.power ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-300 shadow-[0_0_24px_-4px_rgba(52,211,153,0.6)]' : 'border-white/15 bg-white/5 text-slate-500'}`}
              title={device.power ? 'Power off' : 'Power on'}
            >
              <Power size={20} />
            </button>
          </div>

          <div className="mt-5 rounded-lg border border-white/8 bg-ink-950/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Front panel</span>
              <span className="text-[11px] text-slate-600">{device.power ? 'ports active' : 'device off'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {device.interfaces.filter((i) => i.kind !== 'console').map((iface) => {
                const d = sim.portDetail(device.id, iface.id)
                return (
                  <button
                    key={iface.id}
                    onClick={() => setSelectedPort(iface.id)}
                    title={`${iface.name} — ${d?.physicalUp ? 'up' : 'down'}`}
                    className={`group flex h-8 min-w-[42px] flex-col items-center justify-center rounded border px-1.5 transition ${
                      selectedPort === iface.id ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10 bg-ink-900 hover:border-white/25'
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${!device.power || !iface.adminUp ? 'bg-slate-600' : d?.physicalUp ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                      <span className="font-mono text-[11px] text-slate-400">{shortIfaceName(iface.name)}</span>
                    </span>
                    <span className="mt-0.5 text-[8px] text-slate-600">{iface.kind === 'wireless' ? 'wifi' : iface.kind}</span>
                  </button>
                )
              })}
            </div>
            {device.interfaces.some((i) => i.kind === 'console') && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> Console port available for out-of-band CLI
              </div>
            )}
          </div>

          {detail && (
            <div className="mt-3 rounded-lg border border-white/8 bg-ink-950/60 p-3">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[12px] text-slate-200">{detail.iface.name}</div>
                <StatusPill up={detail.protocolUp} label={detail.protocolUp ? 'protocol up' : 'protocol down'} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                <div>Admin: <span className="text-slate-300">{detail.adminUp ? 'up' : 'down'}</span></div>
                <div>Physical: <span className="text-slate-300">{detail.physicalUp ? 'up' : 'down'}</span></div>
                <div>Speed: <span className="text-slate-300">{detail.speed} Mbps</span></div>
                <div>MAC: <span className="font-mono text-slate-300">{detail.iface.mac}</span></div>
                <div>IP: <span className="font-mono text-slate-300">{formatIpWithMask(detail.iface.ip, detail.iface.mask) ?? 'unassigned'}</span></div>
                <div>Peer: <span className="text-slate-300">{detail.peer ? sim.device(detail.peer.deviceId)?.name : '—'}</span></div>
                {detail.iface.kind === 'serial' && <div className="col-span-2">Clock: <span className="text-slate-300">{detail.iface.clockRate ? `${detail.iface.clockRate} bps` : 'not set'}</span></div>}
                {detail.warning && <div className="col-span-2 text-amber-300">{detail.warning}</div>}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <Boxes size={12} className="text-cyan-300" /> Interfaces
          </div>
          <div className="overflow-hidden rounded-lg border border-white/8">
            <table className="w-full text-[11px]">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className="table-head px-2 py-1.5">Interface</th>
                  <th className="table-head px-2 py-1.5">Type</th>
                  <th className="table-head px-2 py-1.5">Speed</th>
                  <th className="table-head px-2 py-1.5">IP</th>
                  <th className="table-head px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {device.interfaces.map((i) => {
                  const d = sim.portDetail(device.id, i.id)
                  return (
                    <tr key={i.id} className="border-t border-white/5">
                      <td className="px-2 py-1 font-mono text-slate-300">{i.name}</td>
                      <td className="px-2 py-1 text-slate-500">{i.kind}</td>
                      <td className="px-2 py-1 text-slate-500">{i.speed ? `${i.speed}M` : '—'}</td>
                      <td className="px-2 py-1 font-mono text-[11px] text-slate-500">{formatIpWithMask(i.ip, i.mask) ?? '—'}</td>
                      <td className="px-2 py-1">
                        <span className={`inline-flex items-center gap-1 ${d?.physicalUp ? 'text-emerald-300' : 'text-slate-600'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${d?.physicalUp ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          {d?.physicalUp ? 'up' : 'down'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Modules</div>
          {!spec.modules.length && <div className="mt-2 text-[11px] text-slate-600">This device has no modular bays. All ports are fixed.</div>}
          <div className="mt-2 space-y-2">
            {spec.modules.map((m) => {
              const installed = device.modules.includes(m.id)
              return (
                <div key={m.id} className={`rounded-lg border p-2.5 ${installed ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-white/8 bg-ink-900/50'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-[11px] text-slate-200">{m.name}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{m.description}</div>
                    </div>
                    <button
                      className={`btn shrink-0 ${installed ? 'btn-danger' : 'btn-primary'}`}
                      onClick={() => {
                        if (device.power) {
                          store.setStatus('Power off the device before adding or removing modules')
                          return
                        }
                        if (installed) sim.uninstallModule(device.id, m.id)
                        else sim.installModule(device.id, m.id)
                        store.bump()
                      }}
                    >
                      {installed ? 'Remove' : 'Insert'}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.ports.map((p) => (
                      <span key={p.name} className="rounded border border-white/8 bg-ink-950/50 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{p.name}</span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Device state</div>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-white/8 bg-ink-900/50 px-2.5 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-300"><Power size={11} /> Power</span>
              <Toggle checked={device.power} onChange={togglePower} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/8 bg-ink-900/50 px-2.5 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-300"><Zap size={11} /> Power cycle</span>
              <button className="btn" onClick={() => { sim.reloadDevice(device.id); store.bump() }}>Reload</button>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/8 bg-ink-900/50 px-2.5 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-300"><CircleDot size={11} /> Startup config</span>
              <button className="btn" onClick={() => { sim.resetStartup(device); store.setStatus('Startup configuration saved') }}>
                <Check size={11} /> Save
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3 text-[11px] leading-relaxed text-slate-600">
          Modules require the device to be powered off. Serial WAN modules add <span className="font-mono">Serial0/3/0</span> and <span className="font-mono">Serial0/3/1</span>. Wireless adapters add a <span className="font-mono">Wireless0</span> interface.
        </div>
      </div>
    </div>
  )
}
