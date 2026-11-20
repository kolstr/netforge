import { useState } from 'react'
import { Globe, Lock, Plus, Router, Settings, Trash2, Wifi } from 'lucide-react'
import type { Device } from '../../types'
import { useApp } from '../../store'
import { Field, Toggle } from '../common/Modal'

export function HomeRouterAdmin({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const hr = device.config.homeRouter
  const [authed, setAuthed] = useState(false)
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'status' | 'wireless' | 'dhcp' | 'forward' | 'admin'>('status')
  if (!hr) return <div className="p-4 text-[11px] text-slate-500">This device has no home gateway configuration.</div>

  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)

  if (!authed) {
    return (
      <div className="mx-auto max-w-sm rounded-xl border border-white/10 bg-ink-900 p-6">
        <div className="mb-4 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-accent-ink">
            <Router size={24} />
          </div>
        </div>
        <h3 className="text-center text-sm font-semibold text-slate-100">{device.name} — Web Configuration</h3>
        <p className="mt-1 text-center text-[10px] text-slate-500">Enter the administrator password to continue.</p>
        <div className="mt-4">
          <Field label="Password">
            <input type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { if (pass === hr.adminPassword) { setAuthed(true); setError('') } else setError('Invalid password') } }} />
          </Field>
        </div>
        {error && <div className="mt-2 text-[10px] text-rose-300">{error}</div>}
        <button className="btn btn-primary mt-3 w-full" onClick={() => { if (pass === hr.adminPassword) { setAuthed(true); setError('') } else setError('Invalid password') }}>
          <Lock size={12} /> Log in
        </button>
        <div className="mt-2 text-center text-[9px] text-slate-600">Default password: admin</div>
      </div>
    )
  }

  const tabs = [
    { id: 'status' as const, label: 'Status', icon: <Globe size={11} /> },
    { id: 'wireless' as const, label: 'Wireless', icon: <Wifi size={11} /> },
    { id: 'dhcp' as const, label: 'DHCP', icon: <Settings size={11} /> },
    { id: 'forward' as const, label: 'Forwarding', icon: <Globe size={11} /> },
    { id: 'admin' as const, label: 'Administration', icon: <Lock size={11} /> },
  ]

  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-ink-900">
      <div className="flex items-center gap-2 border-b border-white/8 bg-gradient-to-r from-cyan-400/10 to-indigo-500/10 px-4 py-3">
        <Router size={18} className="text-cyan-300" />
        <div>
          <div className="text-sm font-semibold text-slate-100">{device.name}</div>
          <div className="text-[9px] text-slate-500">Home gateway web configuration</div>
        </div>
        <button className="btn ml-auto" onClick={() => setAuthed(false)}><Lock size={11} /> Log out</button>
      </div>
      <div className="flex gap-1 border-b border-white/8 px-2">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="inline-flex items-center gap-1">{t.icon}{t.label}</span>
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'status' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/8 bg-ink-950/50 p-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Internet / WAN</div>
              <div className="mt-1 font-mono text-[11px] text-slate-200">{hr.wanMode === 'dhcp' ? (sim.rt(device.id).dhcpClient?.ip ?? 'DHCP pending') : hr.wanIp ?? 'not set'}</div>
              <div className="text-[9px] text-slate-500">{hr.wanMode === 'dhcp' ? sim.rt(device.id).dhcpClient?.mask ?? '' : hr.wanMask ?? ''}</div>
            </div>
            <div className="rounded-lg border border-white/8 bg-ink-950/50 p-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">LAN</div>
              <div className="mt-1 font-mono text-[11px] text-slate-200">{hr.lanIp}</div>
              <div className="text-[9px] text-slate-500">{hr.lanMask}</div>
            </div>
            <div className="rounded-lg border border-white/8 bg-ink-950/50 p-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Wireless</div>
              <div className="mt-1 text-[11px] text-slate-200">{hr.wireless.ssid}</div>
              <div className="text-[9px] text-slate-500">{hr.wireless.security === 'wpa2' ? 'WPA2-PSK' : 'Open'} · channel {hr.wireless.channel}</div>
            </div>
            <div className="rounded-lg border border-white/8 bg-ink-950/50 p-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Connected clients</div>
              <div className="mt-1 text-[11px] text-slate-200">{sim.rt(device.id).assoc.length} wireless</div>
              <div className="text-[9px] text-slate-500">{sim.rt(device.id).dhcpLeases.length} DHCP leases</div>
            </div>
          </div>
        )}
        {tab === 'wireless' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Network name (SSID)"><input className="input" defaultValue={hr.wireless.ssid} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wireless.ssid = e.target.value; sim.topologyChanged() })} /></Field>
              <Field label="Security mode">
                <select className="input" value={hr.wireless.security} onChange={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wireless.security = e.target.value as 'open' | 'wpa2'; sim.topologyChanged() })}>
                  <option value="open">Open</option>
                  <option value="wpa2">WPA2 Personal</option>
                </select>
              </Field>
              <Field label="Passphrase"><input className="input" defaultValue={hr.wireless.key} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wireless.key = e.target.value; sim.topologyChanged() })} /></Field>
              <Field label="Channel"><input type="number" className="input" defaultValue={hr.wireless.channel} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wireless.channel = Number(e.target.value) || 6 })} /></Field>
            </div>
            <Toggle checked={hr.wireless.enabled} onChange={(v) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wireless.enabled = v; sim.topologyChanged() })} label="Enable wireless radio" />
          </div>
        )}
        {tab === 'dhcp' && (
          <div className="space-y-2">
            <Toggle checked={hr.dhcpEnabled} onChange={(v) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.dhcpEnabled = v })} label="DHCP server enabled" />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Starting address"><input className="input font-mono" defaultValue={hr.dhcpStart} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.dhcpStart = e.target.value })} /></Field>
              <Field label="Maximum users"><input type="number" className="input" defaultValue={hr.dhcpSize} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.dhcpSize = Number(e.target.value) || 1 })} /></Field>
            </div>
            <div className="rounded-lg border border-white/8 bg-ink-950/50 p-2">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Active leases</div>
              {sim.rt(device.id).dhcpLeases.length === 0 && <div className="mt-1 text-[10px] text-slate-600">No active leases.</div>}
              {sim.rt(device.id).dhcpLeases.map((l) => (
                <div key={l.mac} className="mt-1 flex items-center justify-between font-mono text-[9px] text-slate-400"><span>{l.ip}</span><span>{l.mac}</span></div>
              ))}
            </div>
          </div>
        )}
        {tab === 'forward' && (
          <div className="space-y-2">
            <div className="grid grid-cols-5 gap-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500"><span>Name</span><span>Ext port</span><span>Internal IP</span><span>Int port</span><span /></div>
            {hr.portForwarding.map((f, i) => (
              <div key={i} className="grid grid-cols-5 items-center gap-1">
                <input className="input text-[9px]" defaultValue={f.name} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.portForwarding[i].name = e.target.value })} />
                <input type="number" className="input text-[9px]" defaultValue={f.extPort} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.portForwarding[i].extPort = Number(e.target.value) || 0 })} />
                <input className="input font-mono text-[9px]" defaultValue={f.intIp} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.portForwarding[i].intIp = e.target.value })} />
                <input type="number" className="input text-[9px]" defaultValue={f.intPort} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.portForwarding[i].intPort = Number(e.target.value) || 0 })} />
                <button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => d.config.homeRouter?.portForwarding.splice(i, 1))}><Trash2 size={11} /></button>
              </div>
            ))}
            <button className="btn" onClick={() => update((d) => d.config.homeRouter?.portForwarding.push({ name: 'Service', extPort: 8080, intIp: '192.168.0.100', intPort: 80, proto: 'tcp' }))}><Plus size={11} /> Add rule</button>
          </div>
        )}
        {tab === 'admin' && (
          <div className="space-y-2">
            <Field label="Administrator password"><input className="input" defaultValue={hr.adminPassword} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.adminPassword = e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="WAN mode">
                <select className="input" value={hr.wanMode} onChange={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wanMode = e.target.value as typeof hr.wanMode; sim.recompute() })}>
                  <option value="dhcp">Automatic (DHCP)</option>
                  <option value="static">Static</option>
                  <option value="pppoe">PPPoE</option>
                </select>
              </Field>
              <Field label="LAN IP address"><input className="input font-mono" defaultValue={hr.lanIp} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.lanIp = e.target.value; sim.recompute() })} /></Field>
            </div>
            <div className="text-[10px] text-slate-500">Firmware NF-1.4.2 · uptime {Math.floor(sim.time)}s</div>
          </div>
        )}
      </div>
    </div>
  )
}
