import { useState } from 'react'
import { ChevronDown, Cpu, Globe, Network, Plus, Route, Server, Shield, Trash2, Wifi } from 'lucide-react'
import type { Acl, Device, DhcpPool, Interface, StaticRoute } from '../../types'
import { useApp } from '../../store'
import { Field, Toggle } from '../common/Modal'
import { shortIfaceName } from '../../sim/runtime'
import { formatIpWithMask, parseAclAddress } from '../../lib/ip'

export function ConfigTab({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)
  const isEnd = ['pc', 'laptop', 'server', 'printer', 'tablet', 'smartphone', 'iot'].includes(device.kind)
  const isRouter = device.kind === 'router' || device.kind === 'firewall'
  const isSwitch = device.kind === 'switch'
  const isAp = device.kind === 'accesspoint'
  const isHome = device.kind === 'homerouter'

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Global settings" icon={<Cpu size={12} />}>
          <Field label="Display name">
            <input defaultValue={device.name} className="input" onBlur={(e) => update((d) => { d.name = e.target.value; d.config.hostname = e.target.value })} />
          </Field>
          <Field label="Hostname" hint="Used in the CLI prompt and prompt banners.">
            <input key={device.config.hostname} defaultValue={device.config.hostname} className="input" onBlur={(e) => update((d) => (d.config.hostname = e.target.value))} />
          </Field>
          {(isRouter || isSwitch) && (
            <Field label="Domain name">
              <input key={device.config.domainName} defaultValue={device.config.domainName ?? ''} placeholder="example.lab" className="input" onBlur={(e) => update((d) => (d.config.domainName = e.target.value || undefined))} />
            </Field>
          )}
          {isRouter && (
            <div className="flex items-center justify-between rounded-md border border-white/8 bg-ink-950/40 px-2 py-1.5">
              <span className="text-[10px] text-slate-300">IP routing</span>
              <Toggle checked={device.config.ipRouting} onChange={(v) => update((d) => (d.config.ipRouting = v))} />
            </div>
          )}
          {isEnd && (
            <>
              <div className="rounded-md border border-white/8 bg-ink-950/40 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">IPv4 configuration</div>
                <div className="flex gap-1">
                  <button
                    className={`flex-1 rounded px-2 py-1 text-[10px] ${device.interfaces[0]?.dhcp ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-500 hover:text-slate-300'}`}
                    onClick={() => { update((d) => { d.interfaces.forEach((i) => (i.dhcp = true)) }); sim.startDhcpFor(device.id); store.setStatus('DHCP requested') }}
                  >
                    DHCP
                  </button>
                  <button
                    className={`flex-1 rounded px-2 py-1 text-[10px] ${!device.interfaces[0]?.dhcp ? 'bg-white/10 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
                    onClick={() => update((d) => d.interfaces.forEach((i) => (i.dhcp = false)))}
                  >
                    Static
                  </button>
                </div>
              </div>
              <Field label="Default gateway">
                <input key={device.config.gateway} defaultValue={device.config.gateway ?? ''} placeholder="192.168.1.1" className="input" onBlur={(e) => update((d) => (d.config.gateway = e.target.value || undefined))} />
              </Field>
              <Field label="DNS server">
                <input key={device.config.dnsServer} defaultValue={device.config.dnsServer ?? ''} placeholder="8.8.8.8" className="input" onBlur={(e) => update((d) => (d.config.dnsServer = e.target.value || undefined))} />
              </Field>
            </>
          )}
          {isAp && <WirelessEditor device={device} onChange={(fn) => update((d) => { const w = d.interfaces.find((i) => i.kind === 'wireless'); if (w?.wireless) fn(w.wireless) })} />}
          {isHome && (
            <div className="rounded-md border border-white/8 bg-ink-950/40 px-2 py-1.5 text-[10px] text-slate-500">
              Configure the home gateway from the <span className="text-cyan-300">GUI</span> tab or edit LAN/WAN settings below.
            </div>
          )}
        </Section>

        <Section title="Management" icon={<Shield size={12} />}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Enable secret">
              <input key={device.config.enableSecret} defaultValue={device.config.enableSecret ?? ''} type="password" className="input" onBlur={(e) => update((d) => (d.config.enableSecret = e.target.value || undefined))} />
            </Field>
            <Field label="Enable password">
              <input key={device.config.enablePassword} defaultValue={device.config.enablePassword ?? ''} className="input" onBlur={(e) => update((d) => (d.config.enablePassword = e.target.value || undefined))} />
            </Field>
            <Field label="Console password">
              <input key={device.config.consolePassword} defaultValue={device.config.consolePassword ?? ''} className="input" onBlur={(e) => update((d) => (d.config.consolePassword = e.target.value || undefined))} />
            </Field>
            <Field label="VTY password">
              <input key={device.config.vtyPassword} defaultValue={device.config.vtyPassword ?? ''} className="input" onBlur={(e) => update((d) => (d.config.vtyPassword = e.target.value || undefined))} />
            </Field>
          </div>
          <Field label="VTY transport">
            <select className="input" value={device.config.vtyTransport} onChange={(e) => update((d) => (d.config.vtyTransport = e.target.value as 'telnet' | 'ssh' | 'all'))}>
              <option value="all">all</option>
              <option value="telnet">telnet</option>
              <option value="ssh">ssh</option>
            </select>
          </Field>
          <div className="flex items-center justify-between rounded-md border border-white/8 bg-ink-950/40 px-2 py-1.5">
            <span className="text-[10px] text-slate-300">SSH RSA keys</span>
            <Toggle checked={device.config.sshKeys} onChange={(v) => update((d) => (d.config.sshKeys = v))} />
          </div>
          <Field label="NTP server">
            <input key={device.config.ntpServer} defaultValue={device.config.ntpServer ?? ''} placeholder="10.10.10.10" className="input" onBlur={(e) => update((d) => (d.config.ntpServer = e.target.value || undefined))} />
          </Field>
          <Field label="Syslog server">
            <input key={device.config.syslogServer} defaultValue={device.config.syslogServer ?? ''} placeholder="10.10.10.10" className="input" onBlur={(e) => update((d) => (d.config.syslogServer = e.target.value || undefined))} />
          </Field>
        </Section>
      </div>

      {isSwitch ? <SwitchInterfaces device={device} /> : !isHome ? <InterfaceList device={device} /> : <HomeInterfaceSummary device={device} />}

      {(isRouter || device.kind === 'switch') && <RoutingSection device={device} />}
      {isSwitch && <VlanSection device={device} />}
      {(isRouter || device.kind === 'server') && <DhcpSection device={device} />}
      {(isRouter || isSwitch) && <AclSection device={device} />}
      {isRouter && <NatSection device={device} />}
      {isHome && <HomeGatewayBasics device={device} />}
    </div>
  )
}

export function Section({ title, icon, children, defaultOpen = true }: { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-xl border border-white/8 bg-ink-950/40">
      <button className="flex w-full items-center gap-2 border-b border-white/8 px-3 py-2 text-left" onClick={() => setOpen(!open)}>
        <span className="text-cyan-300">{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">{title}</span>
        <ChevronDown size={11} className={`ml-auto text-slate-600 transition ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="space-y-2 p-3">{children}</div>}
    </div>
  )
}

export function InterfaceList({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const [expanded, setExpanded] = useState<string | null>(device.interfaces.find((i) => i.kind === 'ethernet')?.id ?? null)
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)

  return (
    <Section title="Interfaces" icon={<Network size={12} />}>
      <div className="space-y-1.5">
        {device.interfaces.filter((i) => i.kind !== 'console').map((iface) => {
          const detail = sim.portDetail(device.id, iface.id)
          const open = expanded === iface.id
          return (
            <div key={iface.id} className={`rounded-lg border ${open ? 'border-cyan-400/20 bg-ink-900/70' : 'border-white/8 bg-ink-900/40'}`}>
              <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => setExpanded(open ? null : iface.id)}>
                <span className={`h-2 w-2 rounded-full ${!iface.adminUp ? 'bg-rose-500' : detail?.physicalUp ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span className="font-mono text-[10px] text-slate-200">{iface.name}</span>
                <span className="text-[10px] text-slate-600">{formatIpWithMask(iface.ip, iface.mask) ?? (iface.dhcp ? 'DHCP' : 'unassigned')}</span>
                {iface.nat && <span className="rounded bg-amber-400/10 px-1 py-0.5 text-[10px] text-amber-300">{iface.nat}</span>}
                {iface.trunk && <span className="rounded bg-cyan-400/10 px-1 py-0.5 text-[10px] text-cyan-300">trunk</span>}
                <ChevronDown size={10} className={`ml-auto text-slate-600 transition ${open ? '' : '-rotate-90'}`} />
              </button>
              {open && (
                <div className="space-y-2 border-t border-white/5 p-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="IP address">
                      <input key={`${iface.id}-${iface.ip}`} defaultValue={iface.ip ?? ''} placeholder="192.168.1.1" className="input font-mono" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (!i) return; i.ip = e.target.value || undefined; i.dhcp = false })} />
                    </Field>
                    <Field label="Subnet mask">
                      <input key={`${iface.id}-${iface.mask}`} defaultValue={iface.mask ?? ''} placeholder="255.255.255.0" className="input font-mono" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.mask = e.target.value || undefined })} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Toggle checked={iface.adminUp} onChange={(v) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.adminUp = v })} label="Port up" />
                    <Toggle checked={!!iface.dhcp} onChange={(v) => { update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) { i.dhcp = v; if (v) { i.ip = undefined; i.mask = undefined } } }); if (v) sim.startDhcpFor(device.id) }} label="DHCP client" />
                  </div>
                  {device.kind === 'router' || device.kind === 'firewall' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="NAT role">
                        <select className="input" value={iface.nat ?? ''} onChange={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.nat = (e.target.value || undefined) as Interface['nat'] })}>
                          <option value="">none</option>
                          <option value="inside">inside</option>
                          <option value="outside">outside</option>
                        </select>
                      </Field>
                      <Field label="Helper address">
                        <input key={`${iface.id}-helper`} defaultValue={iface.helper ?? ''} placeholder="DHCP server" className="input font-mono" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.helper = e.target.value || undefined })} />
                      </Field>
                      <Field label="ACL in">
                        <input key={`${iface.id}-acl-in`} defaultValue={iface.aclIn ?? ''} className="input font-mono" placeholder="ACL id/name" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.aclIn = e.target.value || undefined })} />
                      </Field>
                      <Field label="ACL out">
                        <input key={`${iface.id}-acl-out`} defaultValue={iface.aclOut ?? ''} className="input font-mono" placeholder="ACL id/name" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.aclOut = e.target.value || undefined })} />
                      </Field>
                    </div>
                  ) : null}
                  {iface.kind === 'serial' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Clock rate (DCE)">
                        <input key={`${iface.id}-clock`} defaultValue={iface.clockRate ?? ''} placeholder="64000" className="input font-mono" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.clockRate = Number(e.target.value) || 0 })} />
                      </Field>
                      <div className="flex items-end pb-1">
                        <Toggle checked={!!iface.ppp} onChange={(v) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.ppp = v })} label="PPP encapsulation" />
                      </div>
                    </div>
                  )}
                  {iface.kind === 'wireless' && device.kind !== 'accesspoint' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="SSID">
                        <input key={`${iface.id}-ssid`} defaultValue={iface.ssid ?? ''} className="input" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.ssid = e.target.value })} />
                      </Field>
                      <Field label="WPA2 key">
                        <input key={`${iface.id}-key`} defaultValue={iface.key ?? ''} className="input" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.key = e.target.value })} />
                      </Field>
                    </div>
                  )}
                  <Field label="Description">
                    <input key={`${iface.id}-desc`} defaultValue={iface.description ?? ''} className="input" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === iface.id); if (i) i.description = e.target.value || undefined })} />
                  </Field>
                  <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-500">
                    <div>MAC <span className="font-mono text-slate-400">{iface.mac}</span></div>
                    <div>Speed <span className="text-slate-400">{iface.speed} Mbps</span></div>
                    <div>Peer <span className="text-slate-400">{detail?.peer ? sim.device(detail.peer.deviceId)?.name : '—'}</span></div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function SwitchInterfaces({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)
  return (
    <Section title="Switch ports" icon={<Network size={12} />}>
      <div className="max-h-[320px] overflow-auto rounded-lg border border-white/8">
        <table className="w-full text-[10px]">
          <thead className="sticky top-0 bg-ink-850">
            <tr>
              <th className="table-head px-2 py-1.5">Port</th>
              <th className="table-head px-1.5 py-1.5">Link</th>
              <th className="table-head px-1.5 py-1.5">Mode</th>
              <th className="table-head px-1.5 py-1.5">VLAN</th>
              <th className="table-head px-1.5 py-1.5">Allowed</th>
              <th className="table-head px-1.5 py-1.5">PortFast</th>
            </tr>
          </thead>
          <tbody>
            {device.interfaces.filter((i) => i.kind === 'ethernet').map((iface) => {
              const d = sim.portDetail(device.id, iface.id)
              return (
                <tr key={iface.id} className="border-t border-white/5">
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center gap-1 font-mono text-slate-300">
                      <span className={`h-1.5 w-1.5 rounded-full ${!iface.adminUp ? 'bg-rose-500' : d?.physicalUp ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                      {shortIfaceName(iface.name)}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-[10px] text-slate-500">{d?.peer ? sim.device(d.peer.deviceId)?.name : '—'}</td>
                  <td className="px-1.5 py-1">
                    <select className="input px-1 py-0.5 text-[10px]" value={iface.trunk ? 'trunk' : 'access'} onChange={(e) => update((dd) => { const i = dd.interfaces.find((x) => x.id === iface.id); if (i) i.trunk = e.target.value === 'trunk' })}>
                      <option value="access">access</option>
                      <option value="trunk">trunk</option>
                    </select>
                  </td>
                  <td className="px-1.5 py-1">
                    <input type="number" min={1} max={4094} className="input w-14 px-1 py-0.5 text-[10px]" defaultValue={iface.vlan ?? 1} onBlur={(e) => update((dd) => { const i = dd.interfaces.find((x) => x.id === iface.id); if (i) i.vlan = Number(e.target.value) || 1 })} />
                  </td>
                  <td className="px-1.5 py-1">
                    <input className="input w-20 px-1 py-0.5 text-[10px]" defaultValue={Array.isArray(iface.allowedVlans) ? iface.allowedVlans.join(',') : 'all'} onBlur={(e) => update((dd) => { const i = dd.interfaces.find((x) => x.id === iface.id); if (!i) return; const v = e.target.value.trim(); i.allowedVlans = v === 'all' || !v ? 'all' : v.split(',').map(Number).filter(Boolean) })} />
                  </td>
                  <td className="px-1.5 py-1">
                    <input type="checkbox" checked={!!iface.portfast} onChange={(e) => update((dd) => { const i = dd.interfaces.find((x) => x.id === iface.id); if (i) i.portfast = e.target.checked })} className="accent-cyan-400" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-600">Access ports carry one untagged VLAN. Trunk ports carry 802.1Q tags for the allowed VLAN list.</p>
    </Section>
  )
}

function RoutingSection({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)
  const [route, setRoute] = useState<StaticRoute>({ network: '', mask: '255.255.255.0', nextHop: '' })
  return (
    <Section title="Routing" icon={<Route size={12} />}>
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Static routes</div>
        {device.config.routes.length === 0 && <div className="text-[10px] text-slate-600">No static routes.</div>}
        {device.config.routes.map((r, idx) => (
          <div key={idx} className="flex items-center gap-1.5 rounded-md border border-white/8 bg-ink-900/50 p-1.5">
            <input className="input flex-1 font-mono text-[10px]" defaultValue={r.network} placeholder="network" onBlur={(e) => update((d) => (d.config.routes[idx].network = e.target.value))} />
            <input className="input w-28 font-mono text-[10px]" defaultValue={r.mask} placeholder="mask" onBlur={(e) => update((d) => (d.config.routes[idx].mask = e.target.value))} />
            <input className="input w-28 font-mono text-[10px]" defaultValue={r.nextHop ?? r.iface ?? ''} placeholder="next hop" onBlur={(e) => update((d) => { d.config.routes[idx].nextHop = e.target.value; delete d.config.routes[idx].iface })} />
            <button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => d.config.routes.splice(idx, 1))}><Trash2 size={11} /></button>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <input className="input flex-1 font-mono text-[10px]" value={route.network} onChange={(e) => setRoute({ ...route, network: e.target.value })} placeholder="0.0.0.0" />
          <input className="input w-28 font-mono text-[10px]" value={route.mask} onChange={(e) => setRoute({ ...route, mask: e.target.value })} placeholder="mask" />
          <input className="input w-28 font-mono text-[10px]" value={route.nextHop} onChange={(e) => setRoute({ ...route, nextHop: e.target.value })} placeholder="next hop" />
          <button className="btn btn-primary" onClick={() => { if (!route.network) return; update((d) => { d.config.routes.push(route); sim.recompute() }); setRoute({ network: '', mask: '255.255.255.0', nextHop: '' }) }}><Plus size={10} /></button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="rounded-lg border border-white/8 bg-ink-900/40 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-300">RIPv2</span>
            <Toggle checked={device.config.rip.enabled} onChange={(v) => update((d) => { d.config.rip.enabled = v; sim.recompute() })} />
          </div>
          <textarea key={`rip-${device.config.rip.networks.join(',')}`} className="input mt-1 h-14 resize-none font-mono text-[10px]" defaultValue={device.config.rip.networks.join('\n')} placeholder="192.168.10.0" onBlur={(e) => update((d) => { d.config.rip.networks = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); sim.recompute() })} />
          <div className="mt-1 text-[10px] text-slate-600">One network statement per line.</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-ink-900/40 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-300">OSPF</span>
            <Toggle checked={device.config.ospf.enabled} onChange={(v) => update((d) => { d.config.ospf.enabled = v; sim.recompute() })} />
          </div>
          <textarea key={`ospf-${device.config.ospf.networks.map((n) => n.network).join(',')}`} className="input mt-1 h-14 resize-none font-mono text-[10px]" defaultValue={device.config.ospf.networks.map((n) => `${n.network} ${n.wildcard} area ${n.area}`).join('\n')} placeholder="10.0.0.0 0.0.0.255 area 0" onBlur={(e) => update((d) => {
            d.config.ospf.networks = e.target.value.split('\n').map((line) => line.trim().split(/\s+/)).filter((p) => p.length >= 4).map((p) => ({ network: p[0], wildcard: p[1], area: Number(p[3]) || 0 }))
            sim.recompute()
          })} />
          <div className="mt-1 text-[10px] text-slate-600">network wildcard area 0</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-ink-900/40 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-300">EIGRP</span>
            <Toggle checked={device.config.eigrp.enabled} onChange={(v) => update((d) => { d.config.eigrp.enabled = v; sim.recompute() })} />
          </div>
          <textarea key={`eigrp-${device.config.eigrp.networks.join(',')}`} className="input mt-1 h-14 resize-none font-mono text-[10px]" defaultValue={device.config.eigrp.networks.join('\n')} placeholder="10.0.0.0" onBlur={(e) => update((d) => { d.config.eigrp.networks = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); sim.recompute() })} />
          <div className="mt-1 text-[10px] text-slate-600">Autonomous system {device.config.eigrp.as}</div>
        </div>
      </div>
      <div className="mt-2 rounded-lg border border-white/8 bg-ink-950/50 p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Current routing table</div>
        <div className="max-h-32 overflow-auto">
          <table className="w-full text-[10px]">
            <thead><tr><th className="table-head px-1">Code</th><th className="table-head px-1">Network</th><th className="table-head px-1">Next hop</th><th className="table-head px-1">AD</th></tr></thead>
            <tbody>
              {sim.routesFor(device.id).map((r, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-1 py-0.5 font-mono text-cyan-200/70">{r.type === 'connected' ? 'C' : r.type === 'static' || r.type === 'default' ? 'S' : r.type === 'ospf' ? 'O' : r.type === 'rip' ? 'R' : 'D'}</td>
                  <td className="px-1 py-0.5 font-mono text-slate-400">{r.network}/{r.mask ? r.mask.split('.').reduce((n, o) => n + (Number(o).toString(2).match(/1/g)?.length ?? 0), 0) : 0}</td>
                  <td className="px-1 py-0.5 font-mono text-slate-500">{r.nextHop ?? 'connected'}</td>
                  <td className="px-1 py-0.5 text-slate-600">{r.ad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  )
}

function VlanSection({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const [newVlan, setNewVlan] = useState('10')
  const [newName, setNewName] = useState('USERS')
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)
  return (
    <Section title="VLANs & SVIs" icon={<Network size={12} />}>
      <div className="flex gap-1.5">
        <input className="input w-16" value={newVlan} onChange={(e) => setNewVlan(e.target.value)} placeholder="id" />
        <input className="input flex-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="name" />
        <button className="btn btn-primary" onClick={() => { const id = Number(newVlan); if (!id) return; update((d) => { if (!d.config.vlans.some((v) => v.id === id)) d.config.vlans.push({ id, name: newName || `VLAN${id}` }); sim.recompute() }) }}><Plus size={10} /> VLAN</button>
      </div>
      <div className="overflow-hidden rounded-lg border border-white/8">
        <table className="w-full text-[10px]">
          <thead className="bg-white/[0.03]"><tr><th className="table-head px-2 py-1">ID</th><th className="table-head px-2 py-1">Name</th><th className="table-head px-2 py-1">Ports</th><th /></tr></thead>
          <tbody>
            {device.config.vlans.map((v) => (
              <tr key={v.id} className="border-t border-white/5">
                <td className="px-2 py-1 font-mono text-slate-300">{v.id}</td>
                <td className="px-2 py-1">
                  <input className="input px-1 py-0.5 text-[10px]" defaultValue={v.name} onBlur={(e) => update((d) => { const x = d.config.vlans.find((y) => y.id === v.id); if (x) x.name = e.target.value })} />
                </td>
                <td className="px-2 py-1 text-[10px] text-slate-500">{device.interfaces.filter((i) => !i.trunk && (i.vlan ?? 1) === v.id).map((i) => shortIfaceName(i.name)).join(', ') || '—'}</td>
                <td className="px-1 py-1">
                  {v.id !== 1 && <button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => { d.config.vlans = d.config.vlans.filter((x) => x.id !== v.id); sim.recompute() })}><Trash2 size={10} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Switched virtual interfaces</div>
      {device.interfaces.filter((i) => i.kind === 'vlan').length === 0 && <div className="text-[10px] text-slate-600">No SVIs. Add one from the CLI with <span className="font-mono text-slate-400">interface vlan 10</span>.</div>}
      {device.interfaces.filter((i) => i.kind === 'vlan').map((svi) => (
        <div key={svi.id} className="flex items-center gap-2 rounded-md border border-white/8 bg-ink-900/50 p-2">
          <span className="w-16 font-mono text-[10px] text-cyan-200">{svi.name}</span>
          <input className="input w-28 font-mono text-[10px]" defaultValue={svi.ip ?? ''} placeholder="IP" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === svi.id); if (i) i.ip = e.target.value || undefined; sim.recompute() })} />
          <input className="input w-28 font-mono text-[10px]" defaultValue={svi.mask ?? ''} placeholder="mask" onBlur={(e) => update((d) => { const i = d.interfaces.find((x) => x.id === svi.id); if (i) i.mask = e.target.value || undefined; sim.recompute() })} />
          <Toggle checked={svi.adminUp} onChange={(v) => update((d) => { const i = d.interfaces.find((x) => x.id === svi.id); if (i) i.adminUp = v })} />
        </div>
      ))}
    </Section>
  )
}

function DhcpSection({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)
  const pools = device.kind === 'server' ? device.config.services.dhcp.pools : device.config.dhcpPools
  const addPool = () => {
    const p: DhcpPool = { name: `POOL${pools.length + 1}`, network: '192.168.1.0', mask: '255.255.255.0', start: '192.168.1.100', size: 50, gateway: '192.168.1.1', dns: '192.168.1.1' }
    update((d) => {
      if (d.kind === 'server') d.config.services.dhcp.pools.push(p)
      else d.config.dhcpPools.push(p)
    })
  }
  return (
    <Section title="DHCP server" icon={<Server size={12} />} defaultOpen={device.kind === 'router'}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-400">{pools.length} pool(s) · {sim.rt(device.id).dhcpLeases.length} active lease(s)</span>
        <button className="btn btn-primary" onClick={addPool}><Plus size={10} /> Add pool</button>
      </div>
      {pools.length === 0 && <div className="text-[10px] text-slate-600">No DHCP pools configured. Clients will not receive a lease.</div>}
      {pools.map((p, idx) => (
        <div key={idx} className="rounded-lg border border-white/8 bg-ink-900/50 p-2">
          <div className="flex items-center gap-1.5">
            <input className="input flex-1" defaultValue={p.name} onBlur={(e) => update((d) => { const x = d.kind === 'server' ? d.config.services.dhcp.pools[idx] : d.config.dhcpPools[idx]; if (x) x.name = e.target.value })} />
            <button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => { if (d.kind === 'server') d.config.services.dhcp.pools.splice(idx, 1); else d.config.dhcpPools.splice(idx, 1) })}><Trash2 size={11} /></button>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {(['network', 'mask', 'start', 'gateway', 'dns'] as const).map((field) => (
              <Field key={field} label={field}>
                <input className="input font-mono text-[10px]" defaultValue={(p[field] as string) ?? ''} onBlur={(e) => update((d) => { const x = d.kind === 'server' ? d.config.services.dhcp.pools[idx] : d.config.dhcpPools[idx]; if (x) (x[field] as string) = e.target.value })} />
              </Field>
            ))}
            <Field label="pool size">
              <input type="number" className="input" defaultValue={p.size} onBlur={(e) => update((d) => { const x = d.kind === 'server' ? d.config.services.dhcp.pools[idx] : d.config.dhcpPools[idx]; if (x) x.size = Number(e.target.value) || 1 })} />
            </Field>
          </div>
        </div>
      ))}
      {device.kind === 'router' && (
        <Field label="Excluded addresses" hint="One address or range per line, e.g. 192.168.1.1 192.168.1.9">
          <textarea key={device.config.dhcpExcluded.join('|')} className="input h-12 resize-none font-mono text-[10px]" defaultValue={device.config.dhcpExcluded.join('\n')} onBlur={(e) => update((d) => (d.config.dhcpExcluded = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)))} />
        </Field>
      )}
    </Section>
  )
}

function AclSection({ device }: { device: Device }) {
  const store = useApp()
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)
  const [newId, setNewId] = useState('100')
  const [form, setForm] = useState({ action: 'permit', proto: 'ip', src: 'any', dst: 'any', dstPort: '' })
  const [error, setError] = useState('')
  const src = parseAclAddress(form.src)
  const dst = parseAclAddress(form.dst)
  const patchForm = (patch: Partial<typeof form>) => {
    setError('')
    setForm({ ...form, ...patch })
  }
  const addRule = (aclId: string) => {
    if (!src || !dst) {
      setError('Address must be any, host 10.0.0.1, 10.0.0.1 or 192.168.1.0/24')
      return
    }
    setError('')
    update((d) => {
      const a = d.config.acls.find((x) => x.id === aclId)
      a?.rules.push({ action: form.action as 'permit' | 'deny', proto: form.proto, src: src.addr, srcWild: src.wildcard, dst: dst.addr, dstWild: dst.wildcard, dstPort: form.dstPort || undefined })
    })
  }
  return (
    <Section title="Access control lists" icon={<Shield size={12} />} defaultOpen={false}>
      <div className="flex gap-1.5">
        <input className="input w-20" value={newId} onChange={(e) => setNewId(e.target.value)} />
        <button className="btn btn-primary" onClick={() => { const id = newId.trim(); if (!id) return; update((d) => { if (!d.config.acls.some((a) => a.id === id)) d.config.acls.push({ id, type: Number(id) >= 100 ? 'extended' : 'standard', rules: [] } as Acl) }) }}><Plus size={10} /> ACL</button>
      </div>
      {device.config.acls.map((acl) => (
        <div key={acl.id} className="rounded-lg border border-white/8 bg-ink-900/50 p-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold text-slate-200">ACL {acl.id} <span className="ml-1 text-[10px] uppercase text-slate-500">{acl.type}</span></div>
            <button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => (d.config.acls = d.config.acls.filter((a) => a.id !== acl.id)))}><Trash2 size={10} /></button>
          </div>
          <div className="mt-1 space-y-0.5">
            {acl.rules.map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-ink-950/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                <span>{r.remark ? `remark ${r.remark}` : `${r.action} ${r.proto ?? 'ip'} ${r.src ?? 'any'} ${r.srcWild ?? ''} ${r.dst ?? 'any'} ${r.dstWild ?? ''}${r.dstPort ? ' eq ' + r.dstPort : ''}`}</span>
                <button className="text-slate-700 hover:text-rose-300" onClick={() => update((d) => { const a = d.config.acls.find((x) => x.id === acl.id); a?.rules.splice(i, 1) })}><Trash2 size={9} /></button>
              </div>
            ))}
            {!acl.rules.length && <div className="text-[10px] text-slate-600">No rules — implicit deny.</div>}
          </div>
          <div className="mt-1.5 grid grid-cols-6 gap-1">
            <select className="input px-1 py-0.5 text-[10px]" value={form.action} onChange={(e) => patchForm({ action: e.target.value })}><option>permit</option><option>deny</option></select>
            <select className="input px-1 py-0.5 text-[10px]" value={form.proto} onChange={(e) => patchForm({ proto: e.target.value })}><option>ip</option><option>tcp</option><option>udp</option><option>icmp</option></select>
            <input className="input px-1 py-0.5 text-[10px]" value={form.src} onChange={(e) => patchForm({ src: e.target.value })} placeholder="src" title="any, host 10.0.0.1, 10.0.0.1 or 192.168.1.0/24" />
            <input className="input px-1 py-0.5 text-[10px]" value={form.dst} onChange={(e) => patchForm({ dst: e.target.value })} placeholder="dst" title="any, host 10.0.0.1, 10.0.0.1 or 192.168.1.0/24" />
            <input className="input px-1 py-0.5 text-[10px]" value={form.dstPort} onChange={(e) => patchForm({ dstPort: e.target.value })} placeholder="port" />
            <button className="btn px-1 py-0.5 text-[10px]" onClick={() => addRule(acl.id)}>Add</button>
          </div>
          <div className={`mt-1 font-mono text-[10px] ${error ? 'text-rose-300' : 'text-slate-500'}`}>
            {error || (src && dst ? `${form.action} ${form.proto} ${src.addr} ${src.wildcard} ${dst.addr} ${dst.wildcard}${form.dstPort ? ' eq ' + form.dstPort : ''}` : 'Address: any, host 10.0.0.1, 10.0.0.1 or 192.168.1.0/24')}
          </div>
        </div>
      ))}
      <div className="text-[10px] text-slate-600">Apply ACLs per interface in the Interfaces section (in/out). ACLs are evaluated top-down with an implicit deny.</div>
    </Section>
  )
}

function NatSection({ device }: { device: Device }) {
  const store = useApp()
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)
  const nat = device.config.nat
  return (
    <Section title="NAT" icon={<Globe size={12} />} defaultOpen={false}>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Inside source ACL">
          <input className="input font-mono" defaultValue={nat.insideSourceList?.aclId ?? ''} placeholder="1" onBlur={(e) => update((d) => { d.config.nat.insideSourceList = e.target.value ? { aclId: e.target.value, iface: d.config.nat.insideSourceList?.iface, overload: d.config.nat.insideSourceList?.overload ?? true } : undefined })} />
        </Field>
        <Field label="Outside interface">
          <input className="input font-mono" defaultValue={nat.insideSourceList?.iface ?? ''} placeholder="GigabitEthernet0/1" onBlur={(e) => update((d) => { if (d.config.nat.insideSourceList) d.config.nat.insideSourceList.iface = e.target.value || undefined })} />
        </Field>
        <div className="flex items-end pb-1">
          <Toggle checked={nat.insideSourceList?.overload ?? false} onChange={(v) => update((d) => { if (d.config.nat.insideSourceList) d.config.nat.insideSourceList.overload = v })} label="PAT overload" />
        </div>
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Static translations</div>
      {nat.static.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input className="input flex-1 font-mono text-[10px]" defaultValue={s.inside} onBlur={(e) => update((d) => (d.config.nat.static[i].inside = e.target.value))} />
          <span className="text-slate-600">→</span>
          <input className="input flex-1 font-mono text-[10px]" defaultValue={s.outside} onBlur={(e) => update((d) => (d.config.nat.static[i].outside = e.target.value))} />
          <button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => d.config.nat.static.splice(i, 1))}><Trash2 size={10} /></button>
        </div>
      ))}
      <button className="btn" onClick={() => update((d) => d.config.nat.static.push({ inside: '192.168.1.10', outside: '203.0.113.10' }))}><Plus size={10} /> Static mapping</button>
    </Section>
  )
}

function HomeInterfaceSummary({ device }: { device: Device }) {
  return (
    <Section title="LAN & WAN" icon={<Network size={12} />}>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-white/8 bg-ink-900/50 p-2.5">
          <div className="text-[10px] font-semibold text-slate-200">LAN</div>
          <div className="mt-1 font-mono text-[10px] text-slate-400">{device.config.homeRouter?.lanIp} / {device.config.homeRouter?.lanMask}</div>
          <div className="mt-1 text-[10px] text-slate-600">4 Ethernet ports + Wi-Fi bridge</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-ink-900/50 p-2.5">
          <div className="text-[10px] font-semibold text-slate-200">WAN</div>
          <div className="mt-1 font-mono text-[10px] text-slate-400">{device.config.homeRouter?.wanIp ?? 'DHCP'} / {device.config.homeRouter?.wanMask ?? ''}</div>
          <div className="mt-1 text-[10px] text-slate-600">{device.config.homeRouter?.wanMode} mode · NAT enabled</div>
        </div>
      </div>
    </Section>
  )
}

function HomeGatewayBasics({ device }: { device: Device }) {
  const store = useApp()
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)
  const hr = device.config.homeRouter
  if (!hr) return null
  return (
    <Section title="Home gateway" icon={<Wifi size={12} />}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="WAN mode">
          <select className="input" value={hr.wanMode} onChange={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wanMode = e.target.value as typeof hr.wanMode })}>
            <option value="dhcp">DHCP</option>
            <option value="static">Static</option>
            <option value="pppoe">PPPoE</option>
          </select>
        </Field>
        <Field label="Admin password">
          <input className="input" defaultValue={hr.adminPassword} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.adminPassword = e.target.value })} />
        </Field>
        <Field label="LAN IP">
          <input className="input font-mono" defaultValue={hr.lanIp} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.lanIp = e.target.value; store.sim.recompute() })} />
        </Field>
        <Field label="LAN mask">
          <input className="input font-mono" defaultValue={hr.lanMask} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.lanMask = e.target.value; store.sim.recompute() })} />
        </Field>
        <Field label="DHCP start">
          <input className="input font-mono" defaultValue={hr.dhcpStart} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.dhcpStart = e.target.value })} />
        </Field>
        <Field label="DHCP pool size">
          <input type="number" className="input" defaultValue={hr.dhcpSize} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.dhcpSize = Number(e.target.value) || 1 })} />
        </Field>
      </div>
      <div className="flex items-center justify-between rounded-md border border-white/8 bg-ink-950/40 px-2 py-1.5">
        <span className="text-[10px] text-slate-300">DHCP server enabled</span>
        <Toggle checked={hr.dhcpEnabled} onChange={(v) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.dhcpEnabled = v })} />
      </div>
      {hr.wanMode === 'static' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="WAN IP"><input className="input font-mono" defaultValue={hr.wanIp ?? ''} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wanIp = e.target.value; store.sim.recompute() })} /></Field>
          <Field label="WAN mask"><input className="input font-mono" defaultValue={hr.wanMask ?? ''} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wanMask = e.target.value; store.sim.recompute() })} /></Field>
          <Field label="WAN gateway"><input className="input font-mono" defaultValue={hr.wanGateway ?? ''} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wanGateway = e.target.value; store.sim.recompute() })} /></Field>
          <Field label="WAN DNS"><input className="input font-mono" defaultValue={hr.wanDns ?? ''} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.wanDns = e.target.value })} /></Field>
        </div>
      )}
      <WirelessEditor device={device} onChange={(fn) => update((d) => { if (d.config.homeRouter) fn(d.config.homeRouter.wireless) })} />
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Port forwarding</div>
      {hr.portForwarding.map((f, i) => (
        <div key={i} className="flex items-center gap-1">
          <input className="input flex-1 text-[10px]" defaultValue={f.name} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.portForwarding[i].name = e.target.value })} />
          <input type="number" className="input w-16 text-[10px]" defaultValue={f.extPort} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.portForwarding[i].extPort = Number(e.target.value) || 0 })} />
          <input className="input w-24 text-[10px]" defaultValue={f.intIp} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.portForwarding[i].intIp = e.target.value })} />
          <input type="number" className="input w-16 text-[10px]" defaultValue={f.intPort} onBlur={(e) => update((d) => { if (d.config.homeRouter) d.config.homeRouter.portForwarding[i].intPort = Number(e.target.value) || 0 })} />
          <button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => d.config.homeRouter?.portForwarding.splice(i, 1))}><Trash2 size={10} /></button>
        </div>
      ))}
      <button className="btn" onClick={() => update((d) => d.config.homeRouter?.portForwarding.push({ name: 'Web server', extPort: 8080, intIp: '192.168.0.100', intPort: 80, proto: 'tcp' }))}><Plus size={10} /> Forward a port</button>
    </Section>
  )
}

function WirelessEditor({ device, onChange }: { device: Device; onChange: (fn: (w: import('../../types').WirelessSettings) => void) => void }) {
  const wifi = device.kind === 'homerouter' ? device.config.homeRouter?.wireless : device.interfaces.find((i) => i.kind === 'wireless')?.wireless
  if (!wifi) return <div className="text-[10px] text-slate-600">No wireless radio installed.</div>
  return (
    <div className="space-y-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] p-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-cyan-200"><Wifi size={11} /> Radio</div>
      <div className="grid grid-cols-2 gap-1.5">
        <Field label="SSID"><input key={wifi.ssid} className="input" defaultValue={wifi.ssid} onBlur={(e) => onChange((w) => (w.ssid = e.target.value))} /></Field>
        <Field label="Security">
          <select className="input" value={wifi.security} onChange={(e) => onChange((w) => (w.security = e.target.value as 'open' | 'wpa2'))}>
            <option value="open">Open</option>
            <option value="wpa2">WPA2-PSK</option>
          </select>
        </Field>
        <Field label="WPA2 key"><input key={wifi.key} className="input" defaultValue={wifi.key} onBlur={(e) => onChange((w) => (w.key = e.target.value))} /></Field>
        <Field label="Channel"><input type="number" className="input" defaultValue={wifi.channel} onBlur={(e) => onChange((w) => (w.channel = Number(e.target.value) || 6))} /></Field>
      </div>
      <Toggle checked={wifi.enabled} onChange={(v) => onChange((w) => (w.enabled = v))} label="Radio enabled" />
    </div>
  )
}
