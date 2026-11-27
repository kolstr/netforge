import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Device, Interface } from '../../types'
import { useApp } from '../../store'
import { Field } from '../common/Modal'
import { isValidMask } from '../../lib/ip'

export function IPConfigApp({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const nics = device.interfaces.filter((i) => i.kind === 'ethernet' || i.kind === 'wireless')
  const [ifaceId, setIfaceId] = useState(nics[0]?.id ?? '')
  const iface = device.interfaces.find((i) => i.id === ifaceId) ?? nics[0]
  const [ip, setIp] = useState(iface?.ip ?? '')
  const [mask, setMask] = useState(iface?.mask ?? '')
  const [gateway, setGateway] = useState(device.config.gateway ?? '')
  const [dns, setDns] = useState(device.config.dnsServer ?? '')
  const [ipv6, setIpv6] = useState(iface?.ipv6 ?? '')
  const [dhcp, setDhcp] = useState(!!iface?.dhcp)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  if (!iface) return <div className="p-4 text-[12px] text-slate-500">No Ethernet or wireless interface on this device.</div>
  const detail = sim.portDetail(device.id, iface.id)
  const lease = sim.rt(device.id).dhcpClient

  const saveIface = (patch: Partial<Interface>) => {
    store.updateDevice(device.id, (d) => {
      const i = d.interfaces.find((x) => x.id === iface.id)
      if (i) Object.assign(i, patch)
    })
  }

  const saved = () => {
    setError('')
    setStatus('Saved')
  }

  const chooseDhcp = () => {
    setError('')
    setDhcp(true)
    setIp('')
    setMask('')
    store.updateDevice(device.id, (d) => {
      const i = d.interfaces.find((x) => x.id === iface.id)
      if (!i) return
      i.dhcp = true
      i.ip = undefined
      i.mask = undefined
    })
    sim.rt(device.id).dhcpClient = undefined
    sim.startDhcpFor(device.id)
    setStatus('DHCP requested — waiting for lease…')
  }

  const chooseStatic = () => {
    if (mask && !isValidMask(mask)) {
      setError('Enter a subnet mask, e.g. 255.255.255.0')
      return
    }
    setError('')
    setDhcp(false)
    saveIface({ dhcp: false, ip: ip || undefined, mask: mask || undefined, ipv6: ipv6 || undefined })
    sim.rt(device.id).dhcpClient = undefined
    setStatus('')
  }

  const commitIp = () => {
    saveIface({ ip: ip || undefined })
    saved()
  }

  const commitMask = () => {
    if (mask && !isValidMask(mask)) {
      setError('Enter a subnet mask, e.g. 255.255.255.0')
      return
    }
    saveIface({ mask: mask || undefined })
    saved()
  }

  const commitGateway = () => {
    store.updateDevice(device.id, (d) => (d.config.gateway = gateway || undefined))
    saved()
  }

  const commitDns = () => {
    store.updateDevice(device.id, (d) => (d.config.dnsServer = dns || undefined))
    saved()
  }

  const commitIpv6 = () => {
    saveIface({ ipv6: ipv6 || undefined })
    saved()
  }

  const renew = () => {
    sim.renewDhcpFor(device.id)
    setStatus('DHCP renewal sent')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div
        className="rounded-xl border border-white/10 bg-ink-900/80 p-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.target instanceof HTMLElement) e.target.blur()
          }
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">IP Configuration</div>
            <div className="text-[11px] text-slate-500">{device.name} · {iface.name}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ${detail?.physicalUp ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${detail?.physicalUp ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              {detail?.physicalUp ? 'link up' : 'link down'}
            </span>
          </div>
        </div>

        {nics.length > 1 && (
          <select className="input mt-3" value={ifaceId} onChange={(e) => { setIfaceId(e.target.value); const i = device.interfaces.find((x) => x.id === e.target.value); setIp(i?.ip ?? ''); setMask(i?.mask ?? ''); setIpv6(i?.ipv6 ?? ''); setDhcp(!!i?.dhcp); setError(''); setStatus('') }}>
            {nics.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className={`rounded-lg border px-3 py-2 text-[12px] transition ${dhcp ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-slate-500 hover:text-slate-300'}`} onClick={chooseDhcp}>
            DHCP
          </button>
          <button className={`rounded-lg border px-3 py-2 text-[12px] transition ${!dhcp ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-slate-500 hover:text-slate-300'}`} onClick={chooseStatic}>
            Static
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="IPv4 address"><input className="input font-mono" value={dhcp ? (lease?.ip ?? '') : ip} onChange={(e) => { setIp(e.target.value); setError('') }} onBlur={commitIp} disabled={dhcp} placeholder="192.168.1.10" /></Field>
          <Field label="Subnet mask"><input className="input font-mono" value={dhcp ? (lease?.mask ?? '') : mask} onChange={(e) => { setMask(e.target.value); setError('') }} onBlur={commitMask} disabled={dhcp} placeholder="255.255.255.0" /></Field>
          <Field label="Default gateway"><input className="input font-mono" value={dhcp ? (lease?.gateway ?? '') : gateway} onChange={(e) => setGateway(e.target.value)} onBlur={commitGateway} disabled={dhcp} /></Field>
          <Field label="DNS server"><input className="input font-mono" value={dhcp ? (lease?.dns ?? '') : dns} onChange={(e) => setDns(e.target.value)} onBlur={commitDns} disabled={dhcp} /></Field>
          <Field label="IPv6 address" className="col-span-2"><input className="input font-mono" value={ipv6} onChange={(e) => setIpv6(e.target.value)} onBlur={commitIpv6} disabled={dhcp} placeholder="2001:db8::1" /></Field>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
          <div>MAC address: <span className="font-mono text-slate-300">{iface.mac}</span></div>
          <div>Bandwidth: <span className="text-slate-300">{iface.speed} Mbps</span></div>
          <div>DHCP server: <span className="text-slate-300">{iface.dhcp ? (lease?.server ?? '—') : '—'}</span></div>
          <div>Lease state: <span className={iface.dhcp && lease?.state === 'bound' ? 'text-emerald-300' : 'text-slate-300'}>{iface.dhcp ? (lease?.state ?? 'requesting') : 'static'}</span></div>
        </div>

        {(dhcp || error || status) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {dhcp && <button className="btn" onClick={renew}><RefreshCw size={12} /> Renew DHCP</button>}
            {error ? <span className="text-[11px] text-rose-300">{error}</span> : status && <span className="text-[11px] text-cyan-300">{status}</span>}
          </div>
        )}
        <div className="mt-1 text-[11px] text-slate-600">
          {dhcp ? 'DHCP is active automatically. Renew requests a fresh lease from the server.' : 'Changes save automatically as you leave each field.'}
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-ink-950/50 p-3 text-[11px] leading-relaxed text-slate-500">
        DHCP clients broadcast a DISCOVER and accept the first OFFER from a reachable DHCP server or router pool. Use the Inspect tool to view leases, ARP and routing tables.
      </div>
    </div>
  )
}
