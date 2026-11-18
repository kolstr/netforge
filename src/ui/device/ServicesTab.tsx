import { useState } from 'react'
import { Clock, Cloud, FileText, Globe, Lock, Mail, Network, Plus, Server, Shield, Trash2, Wifi } from 'lucide-react'
import type { Device, DhcpPool } from '../../types'
import { useApp } from '../../store'
import { ipInNetwork } from '../../lib/ip'
import { Field, Toggle } from '../common/Modal'

type ServiceId = 'http' | 'dns' | 'dhcp' | 'tftp' | 'email' | 'ftp' | 'ntp' | 'syslog' | 'aaa'

export function ServicesTab({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const [service, setService] = useState<ServiceId>('http')
  const s = device.config.services
  const update = (fn: (d: Device) => void) => store.updateDevice(device.id, fn)
  const [httpFile, setHttpFile] = useState(s.http.files[0]?.name ?? 'index.html')
  const [tftpFile, setTftpFile] = useState(s.tftp.files[0]?.name ?? '')
  const [ftpFile, setFtpFile] = useState(s.ftp.files[0]?.name ?? '')

  const services: { id: ServiceId; label: string; icon: React.ReactNode; enabled: boolean }[] = [
    { id: 'http', label: 'HTTP', icon: <Globe size={13} />, enabled: s.http.enabled },
    { id: 'dns', label: 'DNS', icon: <Network size={13} />, enabled: s.dns.enabled },
    { id: 'dhcp', label: 'DHCP', icon: <Server size={13} />, enabled: s.dhcp.enabled },
    { id: 'tftp', label: 'TFTP', icon: <Cloud size={13} />, enabled: s.tftp.enabled },
    { id: 'email', label: 'Email', icon: <Mail size={13} />, enabled: s.email.enabled },
    { id: 'ftp', label: 'FTP', icon: <FileText size={13} />, enabled: s.ftp.enabled },
    { id: 'ntp', label: 'NTP', icon: <Clock size={13} />, enabled: s.ntp.enabled },
    { id: 'syslog', label: 'Syslog', icon: <FileText size={13} />, enabled: s.syslog.enabled },
    { id: 'aaa', label: 'AAA', icon: <Shield size={13} />, enabled: s.aaa.enabled },
  ]

  const current = s.http.files.find((f) => f.name === httpFile) ?? s.http.files[0]
  const serverAddrs = device.interfaces.filter((i) => i.ip && i.mask)
  const poolMatchesLocal = s.dhcp.pools.some((p) => serverAddrs.some((i) => ipInNetwork(i.ip!, p.network, p.mask)))

  return (
    <div className="grid min-h-[440px] gap-3 md:grid-cols-[190px_1fr]">
      <div className="rounded-xl border border-white/8 bg-ink-950/40 p-2">
        <div className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Services</div>
        {services.map((sv) => (
          <button key={sv.id} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[10px] transition ${service === sv.id ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-400 hover:bg-white/5'}`} onClick={() => setService(sv.id)}>
            <span className={service === sv.id ? 'text-cyan-300' : 'text-slate-500'}>{sv.icon}</span>
            <span className="flex-1">{sv.label}</span>
            <span className={`h-1.5 w-1.5 rounded-full ${sv.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          </button>
        ))}
        <div className="mt-2 rounded-lg border border-white/8 bg-ink-900/50 p-2 text-[8px] leading-relaxed text-slate-600">
          Services listen on standard ports: 80/443, 53, 67, 69, 25/110, 21, 123, 514, 1812.
        </div>
      </div>

      <div className="min-w-0 rounded-xl border border-white/8 bg-ink-950/40 p-3">
        {service === 'http' && (
          <div className="space-y-2">
            <Header title="HTTP / HTTPS Server" enabled={s.http.enabled} onToggle={(v) => update((d) => (d.config.services.http.enabled = v))} />
            <div className="flex items-center gap-2 rounded-md border border-white/8 bg-ink-900/50 px-2 py-1.5">
              <span className="text-[10px] text-slate-300">HTTPS (port 443)</span>
              <Toggle checked={s.https.enabled} onChange={(v) => update((d) => (d.config.services.https.enabled = v))} />
              <span className="ml-auto inline-flex items-center gap-1 text-[9px] text-slate-600"><Lock size={10} /> self-signed</span>
            </div>
            <div className="flex gap-2">
              <div className="w-40 space-y-1">
                {s.http.files.map((f) => (
                  <button key={f.name} className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-[9px] ${current?.name === f.name ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-400 hover:bg-white/5'}`} onClick={() => setHttpFile(f.name)}>{f.name}</button>
                ))}
                <div className="flex gap-1 pt-1">
                  <button className="btn flex-1" onClick={() => { const name = `page${s.http.files.length + 1}.html`; update((d) => d.config.services.http.files.push({ name, content: '<html><body><h1>New page</h1></body></html>' })); setHttpFile(name) }}><Plus size={9} /> Add</button>
                  <button className="btn btn-danger" onClick={() => { if (!current) return; update((d) => (d.config.services.http.files = d.config.services.http.files.filter((f) => f.name !== current.name))); setHttpFile(s.http.files[0]?.name ?? '') }}><Trash2 size={9} /></button>
                </div>
              </div>
              {current && (
                <textarea key={current.name} className="input h-64 flex-1 resize-none font-mono text-[9px] leading-relaxed" defaultValue={current.content} onBlur={(e) => update((d) => { const f = d.config.services.http.files.find((x) => x.name === current.name); if (f) f.content = e.target.value })} />
              )}
            </div>
          </div>
        )}

        {service === 'dns' && (
          <div className="space-y-2">
            <Header title="DNS Server" enabled={s.dns.enabled} onToggle={(v) => update((d) => (d.config.services.dns.enabled = v))} />
            {!s.dns.enabled && <div className="rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[9px] text-amber-200">DNS service is off — enable it before clients query this server.</div>}
            <div className="overflow-hidden rounded-lg border border-white/8">
              <table className="w-full text-[9px]">
                <thead className="bg-white/[0.03]"><tr><th className="table-head px-2 py-1">Name</th><th className="table-head px-2 py-1">Type</th><th className="table-head px-2 py-1">Value</th><th /></tr></thead>
                <tbody>
                  {s.dns.records.map((r, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-2 py-1"><input className="input px-1 py-0.5 font-mono text-[8px]" defaultValue={r.name} onChange={(e) => update((d) => (d.config.services.dns.records[i].name = e.target.value))} /></td>
                      <td className="px-2 py-1">
                        <select className="input px-1 py-0.5 text-[8px]" value={r.type} onChange={(e) => update((d) => (d.config.services.dns.records[i].type = e.target.value as typeof r.type))}>
                          <option>A</option><option>CNAME</option><option>NS</option><option>SOA</option>
                        </select>
                      </td>
                      <td className="px-2 py-1"><input className="input px-1 py-0.5 font-mono text-[8px]" defaultValue={r.value} onChange={(e) => update((d) => (d.config.services.dns.records[i].value = e.target.value))} /></td>
                      <td className="px-1 py-1"><button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => d.config.services.dns.records.splice(i, 1))}><Trash2 size={9} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-primary" onClick={() => update((d) => { d.config.services.dns.enabled = true; d.config.services.dns.records.push({ name: 'www.example.lab', type: 'A', value: '10.10.10.10' }) })}><Plus size={10} /> Add record</button>
            <div className="rounded-lg border border-white/8 bg-ink-900/50 p-2">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Cache</div>
              {sim.rt(device.id).dnsCache.length === 0 ? <div className="text-[9px] text-slate-600">Cache empty.</div> : sim.rt(device.id).dnsCache.map((c) => <div key={c.name} className="font-mono text-[8px] text-slate-400">{c.name} → {c.ip}</div>)}
            </div>
          </div>
        )}

        {service === 'dhcp' && (
          <div className="space-y-2">
            <Header title="DHCP Server" enabled={s.dhcp.enabled} onToggle={(v) => update((d) => (d.config.services.dhcp.enabled = v))} />
            {!s.dhcp.enabled && <div className="rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[9px] text-amber-200">DHCP service is off — enable it to answer client requests.</div>}
            {!serverAddrs.length && <div className="rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[9px] text-amber-200">Assign a static IPv4 address to this server's interface, otherwise replies cannot be sent.</div>}
            {serverAddrs.length > 0 && s.dhcp.pools.length > 0 && !poolMatchesLocal && <div className="rounded-md border border-sky-400/25 bg-sky-400/10 px-2 py-1.5 text-[9px] text-sky-200">No pool matches a local interface subnet. Clients on another subnet need <span className="font-mono">ip helper-address</span> on their router.</div>}
            {s.dhcp.pools.length === 0 && <div className="text-[10px] text-slate-600">No pools configured.</div>}
            {s.dhcp.pools.map((p, i) => (
              <div key={i} className="rounded-lg border border-white/8 bg-ink-900/50 p-2">
                <div className="flex items-center gap-1"><input className="input flex-1" defaultValue={p.name} onChange={(e) => update((d) => (d.config.services.dhcp.pools[i].name = e.target.value))} /><button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => d.config.services.dhcp.pools.splice(i, 1))}><Trash2 size={10} /></button></div>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {(['network', 'mask', 'start', 'gateway', 'dns'] as const).map((f) => (
                    <Field key={f} label={f}><input className="input font-mono text-[8px]" defaultValue={(p[f] as string) ?? ''} onChange={(e) => update((d) => { const x = d.config.services.dhcp.pools[i]; (x[f] as string) = e.target.value })} /></Field>
                  ))}
                  <Field label="size"><input type="number" className="input text-[8px]" defaultValue={p.size} onChange={(e) => update((d) => (d.config.services.dhcp.pools[i].size = Number(e.target.value) || 1))} /></Field>
                </div>
              </div>
            ))}
            <button className="btn btn-primary" onClick={() => update((d) => { d.config.services.dhcp.enabled = true; d.config.services.dhcp.pools.push({ name: `POOL${s.dhcp.pools.length + 1}`, network: '192.168.1.0', mask: '255.255.255.0', start: '192.168.1.100', size: 50, gateway: '192.168.1.1', dns: '192.168.1.1' } as DhcpPool) })}><Plus size={10} /> Add pool</button>
            <div className="overflow-hidden rounded-lg border border-white/8">
              <table className="w-full text-[9px]"><thead className="bg-white/[0.03]"><tr><th className="table-head px-2 py-1">Lease</th><th className="table-head px-2 py-1">MAC</th><th className="table-head px-2 py-1">Expires</th></tr></thead>
                <tbody>{sim.rt(device.id).dhcpLeases.map((l) => <tr key={l.mac} className="border-t border-white/5"><td className="px-2 py-1 font-mono text-slate-300">{l.ip}</td><td className="px-2 py-1 font-mono text-slate-500">{l.mac}</td><td className="px-2 py-1 text-slate-500">{Math.max(0, Math.floor(l.expires - sim.time))}s</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {service === 'tftp' && (
          <div className="space-y-2">
            <Header title="TFTP Server" enabled={s.tftp.enabled} onToggle={(v) => update((d) => (d.config.services.tftp.enabled = v))} />
            <div className="flex gap-2">
              <div className="w-44 space-y-1">
                {s.tftp.files.map((f) => (
                  <button key={f.name} className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-[9px] ${tftpFile === f.name ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-400 hover:bg-white/5'}`} onClick={() => setTftpFile(f.name)}>{f.name}</button>
                ))}
                <div className="flex gap-1">
                  <button className="btn flex-1" onClick={() => { const name = `file${s.tftp.files.length + 1}.txt`; update((d) => d.config.services.tftp.files.push({ name, content: '' })); setTftpFile(name) }}><Plus size={9} /> Add</button>
                  <button className="btn btn-danger" onClick={() => { update((d) => (d.config.services.tftp.files = d.config.services.tftp.files.filter((f) => f.name !== tftpFile))); setTftpFile(s.tftp.files[0]?.name ?? '') }}><Trash2 size={9} /></button>
                </div>
              </div>
              {s.tftp.files.find((f) => f.name === tftpFile) && (
                <textarea className="input h-56 flex-1 resize-none font-mono text-[9px]" defaultValue={s.tftp.files.find((f) => f.name === tftpFile)?.content ?? ''} onBlur={(e) => update((d) => { const f = d.config.services.tftp.files.find((x) => x.name === tftpFile); if (f) f.content = e.target.value })} />
              )}
            </div>
          </div>
        )}

        {service === 'email' && (
          <div className="space-y-2">
            <Header title="Email Server" enabled={s.email.enabled} onToggle={(v) => update((d) => (d.config.services.email.enabled = v))} />
            <Field label="Domain name"><input className="input" defaultValue={s.email.domain} onBlur={(e) => update((d) => (d.config.services.email.domain = e.target.value))} /></Field>
            <div className="overflow-hidden rounded-lg border border-white/8">
              <table className="w-full text-[9px]"><thead className="bg-white/[0.03]"><tr><th className="table-head px-2 py-1">User</th><th className="table-head px-2 py-1">Password</th><th className="table-head px-2 py-1">Inbox</th><th /></tr></thead>
                <tbody>{s.email.accounts.map((a, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-2 py-1"><input className="input px-1 py-0.5 text-[8px]" defaultValue={a.user} onBlur={(e) => update((d) => (d.config.services.email.accounts[i].user = e.target.value))} /></td>
                    <td className="px-2 py-1"><input className="input px-1 py-0.5 text-[8px]" defaultValue={a.password} onBlur={(e) => update((d) => (d.config.services.email.accounts[i].password = e.target.value))} /></td>
                    <td className="px-2 py-1 text-slate-500">{a.inbox.length} message(s)</td>
                    <td className="px-1 py-1"><button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => d.config.services.email.accounts.splice(i, 1))}><Trash2 size={9} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <button className="btn btn-primary" onClick={() => update((d) => d.config.services.email.accounts.push({ user: 'user', password: 'user', inbox: [] }))}><Plus size={10} /> Add account</button>
            <div className="space-y-1">
              {s.email.accounts.flatMap((a) => a.inbox.map((m) => (
                <div key={m.id} className="rounded border border-white/8 bg-ink-900/40 p-2 text-[9px]">
                  <div className="text-slate-300">{m.subject} <span className="text-slate-600">from {m.from} to {m.to}</span></div>
                  <div className="mt-0.5 text-slate-500">{m.body}</div>
                </div>
              )))}
            </div>
          </div>
        )}

        {service === 'ftp' && (
          <div className="space-y-2">
            <Header title="FTP Server" enabled={s.ftp.enabled} onToggle={(v) => update((d) => (d.config.services.ftp.enabled = v))} />
            <div className="overflow-hidden rounded-lg border border-white/8">
              <table className="w-full text-[9px]"><thead className="bg-white/[0.03]"><tr><th className="table-head px-2 py-1">User</th><th className="table-head px-2 py-1">Password</th><th className="table-head px-2 py-1">Permissions</th><th /></tr></thead>
                <tbody>{s.ftp.users.map((u, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-2 py-1"><input className="input px-1 py-0.5 text-[8px]" defaultValue={u.user} onBlur={(e) => update((d) => (d.config.services.ftp.users[i].user = e.target.value))} /></td>
                    <td className="px-2 py-1"><input className="input px-1 py-0.5 text-[8px]" defaultValue={u.password} onBlur={(e) => update((d) => (d.config.services.ftp.users[i].password = e.target.value))} /></td>
                    <td className="px-2 py-1 text-[8px] text-slate-500">{u.permissions.join(', ')}</td>
                    <td className="px-1 py-1"><button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => d.config.services.ftp.users.splice(i, 1))}><Trash2 size={9} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <button className="btn btn-primary" onClick={() => update((d) => d.config.services.ftp.users.push({ user: 'user', password: 'user', permissions: ['read', 'list'] }))}><Plus size={10} /> Add user</button>
            <div className="flex gap-2">
              <div className="w-40 space-y-1">
                {s.ftp.files.map((f) => <button key={f.name} className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-[9px] ${ftpFile === f.name ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-400 hover:bg-white/5'}`} onClick={() => setFtpFile(f.name)}>{f.name}</button>)}
                <button className="btn w-full" onClick={() => { const name = `file${s.ftp.files.length + 1}.txt`; update((d) => d.config.services.ftp.files.push({ name, content: '' })); setFtpFile(name) }}><Plus size={9} /> Add file</button>
              </div>
              {s.ftp.files.find((f) => f.name === ftpFile) && <textarea className="input h-32 flex-1 resize-none font-mono text-[9px]" defaultValue={s.ftp.files.find((f) => f.name === ftpFile)?.content ?? ''} onBlur={(e) => update((d) => { const f = d.config.services.ftp.files.find((x) => x.name === ftpFile); if (f) f.content = e.target.value })} />}
            </div>
          </div>
        )}

        {service === 'ntp' && (
          <div className="space-y-2">
            <Header title="NTP Server" enabled={s.ntp.enabled} onToggle={(v) => update((d) => (d.config.services.ntp.enabled = v))} />
            <div className="rounded-lg border border-white/8 bg-ink-900/50 p-3 text-[10px] text-slate-400">Server time: <span className="font-mono text-slate-200">{new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC</span></div>
            <p className="text-[9px] leading-relaxed text-slate-600">Configure routers with <span className="font-mono text-slate-400">ntp server &lt;ip&gt;</span> to synchronize their clocks. NTP packets are logged in the Event List.</p>
          </div>
        )}

        {service === 'syslog' && (
          <div className="space-y-2">
            <Header title="Syslog Server" enabled={s.syslog.enabled} onToggle={(v) => update((d) => (d.config.services.syslog.enabled = v))} />
            <div className="max-h-72 overflow-auto rounded-lg border border-white/8">
              <table className="w-full text-[9px]"><thead className="bg-white/[0.03]"><tr><th className="table-head px-2 py-1">Time</th><th className="table-head px-2 py-1">Host</th><th className="table-head px-2 py-1">Message</th></tr></thead>
                <tbody>{s.syslog.entries.length === 0 && <tr><td colSpan={3} className="px-2 py-4 text-center text-slate-600">No messages received.</td></tr>}
                  {s.syslog.entries.slice(-100).reverse().map((e, i) => <tr key={i} className="border-t border-white/5"><td className="px-2 py-1 font-mono text-slate-500">{e.time.toFixed(2)}</td><td className="px-2 py-1 text-slate-400">{e.host}</td><td className="px-2 py-1 font-mono text-slate-400">{e.message}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {service === 'aaa' && (
          <div className="space-y-2">
            <Header title="AAA Server" enabled={s.aaa.enabled} onToggle={(v) => update((d) => (d.config.services.aaa.enabled = v))} />
            <div className="space-y-1">
              {s.aaa.clients.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded border border-white/8 bg-ink-900/50 p-1.5 text-[9px]">
                  <input className="input flex-1" defaultValue={c.name} onBlur={(e) => update((d) => (d.config.services.aaa.clients[i].name = e.target.value))} />
                  <input className="input w-24 font-mono" defaultValue={c.ip} onBlur={(e) => update((d) => (d.config.services.aaa.clients[i].ip = e.target.value))} />
                  <select className="input w-20" value={c.type} onChange={(e) => update((d) => (d.config.services.aaa.clients[i].type = e.target.value as 'radius' | 'tacacs'))}><option>radius</option><option>tacacs</option></select>
                  <button className="text-slate-600 hover:text-rose-300" onClick={() => update((d) => d.config.services.aaa.clients.splice(i, 1))}><Trash2 size={9} /></button>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" onClick={() => update((d) => d.config.services.aaa.clients.push({ name: 'R1', ip: '10.10.10.1', secret: 'key', type: 'radius' }))}><Plus size={10} /> Add client</button>
            <p className="text-[9px] text-slate-600">AAA client entries describe network devices allowed to authenticate against this server.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Header({ title, enabled, onToggle }: { title: string; enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-white/8 bg-ink-900/50 px-2.5 py-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200"><Wifi size={11} className="text-cyan-300" />{title}</span>
      <Toggle checked={enabled} onChange={onToggle} label={enabled ? 'on' : 'off'} />
    </div>
  )
}
