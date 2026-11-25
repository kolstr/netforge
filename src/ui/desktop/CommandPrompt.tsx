import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Terminal } from 'lucide-react'
import type { Device } from '../../types'
import { useApp } from '../../store'
import { CliTerminal } from '../device/CliTab'
import { formatIpWithMask } from '../../lib/ip'

export function CommandPrompt({ device }: { device: Device }) {
  const sim = useApp((s) => s.sim)
  const primaryIface = device.interfaces.find((i) => i.ip)
  const primaryAddress = formatIpWithMask(primaryIface?.ip, primaryIface?.mask) ?? 'no address'
  const [lines, setLines] = useState<string[]>([`NetForge Command Prompt [Version 10.0.19045.3803]`, `(c) NetForge Studio. All rights reserved.`, ''])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [remote, setRemote] = useState<{ deviceId: string; protocol: string } | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [lines, busy])
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100) }, [remote])
  useEffect(() => {
    if (busy) return
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [busy])

  const print = (text: string) => setLines((l) => [...l, ...text.split('\n')])

  const run = async (raw: string) => {
    const cmd = raw.trim()
    setLines((l) => [...l, `C:\\>${raw}`])
    setInput('')
    setHistIdx(-1)
    if (!cmd) return
    setHistory((h) => [...h, cmd])
    const [name, ...args] = cmd.split(/\s+/)
    const low = name.toLowerCase()
    setBusy(true)
    try {
      if (low === 'help' || low === '?') {
        print('Available commands:\n  arp -a            Display the ARP cache\n  cls               Clear the screen\n  delete <file>     Delete a file\n  dir               List files\n  ftp <host>        Open the FTP client\n  ipconfig [/all]   Show IP configuration\n  netstat           Show TCP connections\n  nslookup <name>   Resolve a DNS name\n  ping <host>       Send ICMP echo requests\n  ssh <user@host>   Open an SSH session\n  telnet <host>     Open a Telnet session\n  tracert <host>    Trace the route to a host\n  exit              Close the command prompt')
      } else if (low === 'cls' || low === 'clear') {
        setLines([])
      } else if (low === 'ipconfig') {
        const all = args.includes('/all') || args.includes('-a')
        const parts: string[] = ['']
        for (const iface of device.interfaces.filter((i) => i.kind === 'ethernet' || i.kind === 'wireless')) {
          parts.push(`Ethernet adapter ${iface.name}:`, '')
          if (iface.ip) {
            parts.push(`   Connection-specific DNS Suffix  . : ${device.config.domainName ?? ''}`)
            parts.push(`   IPv4 Address. . . . . . . . . . . : ${iface.ip}`)
            parts.push(`   Subnet Mask . . . . . . . . . . . : ${iface.mask ?? ''}`)
            parts.push(`   Default Gateway . . . . . . . . . : ${device.config.gateway ?? ''}`)
            if (all) {
              parts.push(`   Physical Address. . . . . . . . . : ${iface.mac}`)
              parts.push(`   DHCP Enabled. . . . . . . . . . . : ${iface.dhcp ? 'Yes' : 'No'}`)
              parts.push(`   DNS Servers . . . . . . . . . . . : ${device.config.dnsServer ?? ''}`)
            }
          } else {
            parts.push('   Media State . . . . . . . . . . . : Media disconnected')
            parts.push(`   Physical Address. . . . . . . . . : ${iface.mac}`)
          }
          parts.push('')
        }
        print(parts.join('\n'))
      } else if (low === 'ping') {
        const target = args[0]
        if (!target) print('Usage: ping <host>')
        else {
          const resolved = /^\d+\.\d+\.\d+\.\d+$/.test(target) ? { ok: true, ip: target } : await sim.resolveName(device.id, target)
          if (!resolved.ok || !resolved.ip) {
            print(`Ping request could not find host ${target}. Please check the name and try again.`)
          } else {
            const res = await sim.ping(device.id, resolved.ip, 4, true)
            const out = [`Pinging ${target} [${resolved.ip}] with 32 bytes of data:`]
            for (const r of res.replies ?? []) out.push(r.ok ? `Reply from ${resolved.ip}: bytes=32 time=${Math.round((r.rtt ?? 0) * 1000)}ms TTL=64` : 'Request timed out.')
            const lost = 4 - (res.replies?.filter((r) => r.ok).length ?? 0)
            out.push('', `Ping statistics for ${resolved.ip}:`, `    Packets: Sent = 4, Received = ${4 - lost}, Lost = ${lost} (${lost * 25}% loss),`)
            if (lost > 0) {
              const src = device.interfaces.find((i) => (i.kind === 'ethernet' || i.kind === 'wireless') && i.ip)
              if (src && !sim.portDetail(device.id, src.id)?.physicalUp) {
                out.push('', `Transmit failed: ${src.name} has no active link.`)
              } else if (!sim.rt(device.id).arp.some((a) => a.ip === resolved.ip)) {
                out.push('', `Destination host unreachable: no ARP entry for ${resolved.ip}. Check that the destination is powered on and connected to the same VLAN.`)
              }
            }
            print(out.join('\n'))
          }
        }
      } else if (low === 'tracert' || low === 'traceroute') {
        const target = args[0]
        if (!target) print('Usage: tracert <host>')
        else {
          const resolved = /^\d+\.\d+\.\d+\.\d+$/.test(target) ? { ok: true, ip: target } : await sim.resolveName(device.id, target)
          if (!resolved.ip) print(`Unable to resolve target system name ${target}.`)
          else {
            const trace = sim.traceRoute(device.id, resolved.ip)
            const out = [`Tracing route to ${target} [${resolved.ip}]`, 'over a maximum of 30 hops:', '']
            if (!trace.hops.length) {
              print(out.concat(`Unable to trace route: ${device.name} is powered off or has no usable IP address.`).join('\n'))
            } else {
              for (const h of trace.hops) out.push(`  ${String(h.hop).padStart(2)}    ${Math.round(h.rtt)} ms    ${Math.round(h.rtt + 1)} ms    ${Math.round(h.rtt + 2)} ms  ${h.ip}`)
              if (!trace.complete) {
                out.push(`  ${String(trace.hops.length + 1).padStart(2)}     *        *        *     Request timed out.`)
                out.push('', 'Trace could not reach the destination: check that routers and switches along the path are powered on and that the destination can route replies back to this host.')
              }
              out.push('', 'Trace complete.')
              print(out.join('\n'))
            }
          }
        }
      } else if (low === 'arp') {
        const rt = sim.rt(device.id)
        print(['Interface: ' + (device.interfaces.find((i) => i.ip)?.ip ?? '0.0.0.0') + ' --- 0x5', '  Internet Address      Physical Address      Type', ...rt.arp.map((a) => `  ${a.ip.padEnd(21)} ${a.mac.padEnd(21)} dynamic`)].join('\n'))
      } else if (low === 'nslookup') {
        const name = args[0]
        if (!name) print('Usage: nslookup <name>')
        else {
          const res = await sim.resolveName(device.id, name)
          if (res.ok && res.ip) print(`Server:  ${device.config.dnsServer ?? 'unknown'}\nAddress:  ${device.config.dnsServer ?? 'unknown'}\n\nName:    ${name}\nAddress:  ${res.ip}`)
          else if (res.error === 'Request timed out') print(`*** ${device.config.dnsServer ?? 'DNS'} can't find ${name}: Request timed out\nThe DNS query did not receive a reply. Check UDP/53 routing and ACLs across the path.`)
          else print(`*** ${device.config.dnsServer ?? 'DNS'} can't find ${name}: ${res.error === 'NXDOMAIN' ? 'Non-existent domain' : (res.error ?? 'DNS query failed')}`)
        }
      } else if (low === 'netstat') {
        const rt = sim.rt(device.id)
        print(['Active Connections', '', '  Proto  Local Address          Foreign Address        State', ...Object.entries(rt.tcp).map(([k, v]) => `  TCP    ${k.padEnd(22)} ${v.state}`)].join('\n'))
      } else if (low === 'dir') {
        print(' Volume in drive C has no label.\n Volume Serial Number is 4C3F-91A2\n\n Directory of C:\\\n\n01/01/2026  09:00 AM    <DIR>          Users\n01/01/2026  09:00 AM    <DIR>          Windows\n01/01/2026  09:00 AM             1,024 readme.txt\n               1 File(s)          1,024 bytes\n               2 Dir(s)   9,999,998,976 bytes free')
      } else if (low === 'delete' || low === 'del') {
        print('File deleted (simulated).')
      } else if (low === 'ftp') {
        print(`FTP client: open the FTP Client utility from the Desktop to transfer files${args[0] ? ` from ${args[0]}` : ''}.`)
      } else if (low === 'telnet' || low === 'ssh') {
        const target = args[args.length - 1]
        const owner = sim.findOwnerOfIp(target)
        if (!owner) print(`Connecting To ${target}...Could not open connection to the host, on port 23: Connect failed`)
        else if (!['router', 'switch', 'firewall', 'accesspoint'].includes(owner.kind)) print(`Connecting To ${target}...Could not open connection to the host on port 23: Connect failed`)
        else setRemote({ deviceId: owner.id, protocol: low })
      } else if (low === 'exit') {
        print('Use the Back button to close the command prompt.')
      } else {
        print(`'${name}' is not recognized as an internal or external command,\noperable program or batch file.`)
      }
    } catch (e) {
      print(`Error: ${e instanceof Error ? e.message : 'command failed'}`)
    } finally {
      setBusy(false)
    }
  }

  if (remote) {
    const target = sim.device(remote.deviceId)
    return (
      <div className="flex h-full flex-col">
        <div className="mb-2 flex items-center gap-2">
          <button className="btn" onClick={() => setRemote(null)}><ArrowLeft size={12} /> Back to {device.name}</button>
          <span className="text-[11px] text-slate-500">Remote {remote.protocol.toUpperCase()} session → {target?.name}</span>
        </div>
        <div className="min-h-0 flex-1">
          <CliTerminal deviceId={remote.deviceId} access="vty" compact />
        </div>
      </div>
    )
  }

  return (
    <div className="nf-palette-default flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#03080d]">
      <div className="flex items-center gap-2 border-b border-white/8 bg-ink-900/80 px-3 py-1.5">
        <Terminal size={12} className="text-slate-400" />
        <span className="font-mono text-[11px] text-slate-400">Command Prompt — {device.name}</span>
        <span className="ml-auto text-[11px] text-slate-600">{primaryAddress}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55] text-slate-300" onClick={() => inputRef.current?.focus()}>
        {lines.map((line, i) => <div key={i} className="whitespace-pre-wrap">{line || '\u00a0'}</div>)}
        {!busy && (
          <div className="flex items-center">
            <span className="shrink-0 text-emerald-300">C:\&gt;</span>
            <input
              ref={inputRef}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void run(input) }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (history.length) { const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1); setHistIdx(idx); setInput(history[idx]) }
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  if (histIdx !== -1) { const idx = histIdx + 1; if (idx >= history.length) { setHistIdx(-1); setInput('') } else { setHistIdx(idx); setInput(history[idx]) } }
                }
              }}
              className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] text-slate-100 caret-cyan-300 outline-none"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        )}
        {busy && <div className="text-slate-500">working…</div>}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
