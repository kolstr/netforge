import { useState } from 'react'
import { Lock, RefreshCw, Signal, Wifi, WifiOff } from 'lucide-react'
import type { Device } from '../../types'
import { useApp } from '../../store'
import { Field } from '../common/Modal'

export function WirelessApp({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const [networks, setNetworks] = useState(() => sim.availableWirelessNetworks(device.id))
  const [ssid, setSsid] = useState('')
  const [key, setKey] = useState('')
  const [status, setStatus] = useState('')
  const wifi = device.interfaces.find((i) => i.kind === 'wireless')
  const signal = sim.wirelessSignal(device.id)
  const assoc = signal ? sim.device(signal.apId) : undefined

  if (!wifi) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-white/10 bg-ink-900 p-5 text-center">
        <WifiOff size={28} className="mx-auto text-slate-500" />
        <div className="mt-2 text-sm font-semibold text-slate-100">No wireless adapter</div>
        <p className="mt-1 text-[10px] text-slate-500">Power off the device, open the Physical tab and insert the Wireless-N Adapter module, then power it back on.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="rounded-xl border border-white/10 bg-ink-900 p-4">
        <div className="flex items-center gap-2">
          <Wifi size={18} className="text-cyan-300" />
          <div>
            <div className="text-sm font-semibold text-slate-100">Wireless Client</div>
            <div className="text-[10px] text-slate-500">{wifi.ssid ? `Profile: ${wifi.ssid}` : 'No profile configured'}</div>
          </div>
          <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ${assoc ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${assoc ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            {assoc ? 'associated' : 'disconnected'}
          </span>
        </div>
        {assoc && signal && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-white/8 bg-ink-950/50 p-2"><div className="text-[8px] uppercase text-slate-500">Access point</div><div className="text-[11px] text-slate-200">{assoc.name}</div></div>
            <div className="rounded-lg border border-white/8 bg-ink-950/50 p-2"><div className="text-[8px] uppercase text-slate-500">Signal</div><div className="text-[11px] text-slate-200">{signal.rssi} dBm</div></div>
            <div className="rounded-lg border border-white/8 bg-ink-950/50 p-2"><div className="text-[8px] uppercase text-slate-500">Distance</div><div className="text-[11px] text-slate-200">{Math.round(signal.distance)} units</div></div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-ink-900 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-slate-200">Available networks</div>
          <button className="btn" onClick={() => setNetworks(sim.availableWirelessNetworks(device.id))}><RefreshCw size={11} /> Scan</button>
        </div>
        <div className="mt-2 space-y-1">
          {!networks.length && <div className="text-[10px] text-slate-600">No networks in range. Move closer to an access point or enable its radio.</div>}
          {networks.map((n) => (
            <button key={n.apId} className="flex w-full items-center gap-2 rounded-lg border border-white/8 bg-ink-950/50 px-2.5 py-2 text-left hover:border-cyan-400/30" onClick={() => { setSsid(n.ssid); setKey(''); setStatus(`Selected ${n.ssid}`) }}>
              <Signal size={13} className={n.rssi > -60 ? 'text-emerald-300' : n.rssi > -75 ? 'text-amber-300' : 'text-slate-500'} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-slate-200">{n.ssid}</div>
                <div className="text-[9px] text-slate-500">{n.security === 'wpa2' ? 'WPA2-PSK' : 'Open'} · channel {n.channel} · {n.rssi} dBm</div>
              </div>
              {n.security === 'wpa2' && <Lock size={11} className="text-amber-300" />}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="SSID"><input className="input" value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="Network name" /></Field>
          <Field label="WPA2 key"><input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Passphrase" /></Field>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button className="btn btn-primary" onClick={() => { if (!ssid) return; sim.setClientWireless(device.id, ssid, key ? 'wpa2' : 'open', key); setStatus(`Connecting to ${ssid}…`); setTimeout(() => setNetworks(sim.availableWirelessNetworks(device.id)), 300) }}>Connect</button>
          <button className="btn" onClick={() => { sim.setClientWireless(device.id, '', 'open', ''); setStatus('Profile cleared') }}>Disconnect</button>
          {status && <span className="text-[10px] text-cyan-300">{status}</span>}
        </div>
      </div>
    </div>
  )
}
