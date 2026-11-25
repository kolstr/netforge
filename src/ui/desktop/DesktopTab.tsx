import { useState } from 'react'
import { Activity, ArrowLeft, FolderOpen, Globe, Mail, Monitor, Settings, Terminal, Wifi } from 'lucide-react'
import type { Device } from '../../types'
import { useApp } from '../../store'
import { IPConfigApp } from './IPConfigApp'
import { CommandPrompt } from './CommandPrompt'
import { WebBrowser } from './WebBrowser'
import { EmailApp } from './EmailApp'
import { WirelessApp } from './WirelessApp'
import { FTPApp } from './FTPApp'
import { TrafficApp } from './TrafficApp'
import { CliTerminal } from '../device/CliTab'
import { formatIpWithMask } from '../../lib/ip'

type AppId = 'ipconfig' | 'command' | 'browser' | 'email' | 'wireless' | 'ftp' | 'traffic' | 'terminal' | null

export function DesktopTab({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const [app, setApp] = useState<AppId>(null)
  const isEnd = ['pc', 'laptop', 'server', 'tablet', 'smartphone'].includes(device.kind)
  const hasWifi = device.interfaces.some((i) => i.kind === 'wireless')
  const consoleLink = sim.links.find((l) => l.type === 'console' && (l.a.deviceId === device.id || l.b.deviceId === device.id))
  const consolePeer = consoleLink ? sim.device(consoleLink.a.deviceId === device.id ? consoleLink.b.deviceId : consoleLink.a.deviceId) : undefined
  const primaryIface = device.interfaces.find((i) => i.ip)
  const primaryAddress = formatIpWithMask(primaryIface?.ip, primaryIface?.mask) ?? 'no address'

  const apps: { id: AppId; label: string; icon: React.ReactNode; color: string; kinds?: Device['kind'][] }[] = [
    { id: 'ipconfig', label: 'IP Configuration', icon: <Settings size={22} />, color: 'from-cyan-500 to-blue-600' },
    { id: 'command', label: 'Command Prompt', icon: <Terminal size={22} />, color: 'from-slate-600 to-slate-800' },
    { id: 'browser', label: 'Web Browser', icon: <Globe size={22} />, color: 'from-sky-500 to-indigo-600', kinds: ['pc', 'laptop', 'server', 'tablet', 'smartphone', 'printer', 'iot'] },
    { id: 'email', label: 'Email', icon: <Mail size={22} />, color: 'from-amber-500 to-orange-600', kinds: ['pc', 'laptop', 'server', 'tablet', 'smartphone'] },
    { id: 'wireless', label: 'Wireless', icon: <Wifi size={22} />, color: 'from-teal-500 to-emerald-600', kinds: ['pc', 'laptop', 'tablet', 'smartphone', 'iot'] },
    { id: 'ftp', label: 'FTP Client', icon: <FolderOpen size={22} />, color: 'from-violet-500 to-purple-700', kinds: ['pc', 'laptop', 'server'] },
    { id: 'traffic', label: 'Traffic Generator', icon: <Activity size={22} />, color: 'from-rose-500 to-pink-600' },
    { id: 'terminal', label: 'Terminal', icon: <Monitor size={22} />, color: 'from-cyan-600 to-teal-700', kinds: ['pc', 'laptop'] },
  ]

  const visible = apps.filter((a) => !a.kinds || a.kinds.includes(device.kind))

  if (app) {
    return (
      <div className="flex h-full min-h-[460px] flex-col">
        <div className="mb-2 flex items-center gap-2">
          <button className="btn" onClick={() => setApp(null)}><ArrowLeft size={12} /> Desktop</button>
          <span className="text-[11px] text-slate-500">{visible.find((a) => a.id === app)?.label} — {device.name}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {app === 'ipconfig' && <IPConfigApp device={device} />}
          {app === 'command' && <CommandPrompt key={device.id} device={device} />}
          {app === 'browser' && <WebBrowser device={device} />}
          {app === 'email' && <EmailApp device={device} />}
          {app === 'wireless' && <WirelessApp device={device} />}
          {app === 'ftp' && <FTPApp device={device} />}
          {app === 'traffic' && <TrafficApp device={device} />}
          {app === 'terminal' && (
            consolePeer ? (
              <CliTerminal deviceId={consolePeer.id} access="console" compact />
            ) : (
              <div className="mx-auto max-w-md rounded-xl border border-white/10 bg-ink-900 p-6 text-center">
                <Monitor size={30} className="mx-auto text-slate-500" />
                <div className="mt-2 text-sm font-semibold text-slate-100">No console connection</div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Connect a Console cable from this PC's RS-232 port to the console port of a router, switch, access point or firewall. Then reopen Terminal to start an out-of-band CLI session.</p>
              </div>
            )
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="nf-palette-default relative flex min-h-[460px] flex-col overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#0b2a3d] via-[#0a1a2e] to-[#170b2d]">
      <div className="pointer-events-none absolute -left-20 top-0 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-indigo-500/15 blur-3xl" />
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2 text-[11px] text-slate-400">
        <Monitor size={12} className="text-cyan-300" /> {device.name} — Desktop
        <span className="ml-auto font-mono text-[11px] text-slate-500">{primaryAddress}</span>
      </div>
      <div className="relative z-10 grid flex-1 content-start grid-cols-4 gap-4 p-6 sm:grid-cols-5">
        {visible.map((a) => (
          <button key={a.id} className="group flex flex-col items-center gap-2 rounded-xl p-2 transition hover:bg-white/5" onClick={() => setApp(a.id)}>
            <span className={`flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${a.color} text-on-solid shadow-lg transition group-hover:scale-105`}>{a.icon}</span>
            <span className="text-center text-[11px] font-medium text-slate-200">{a.label}</span>
          </button>
        ))}
      </div>
      <div className="relative z-10 flex items-center gap-2 border-t border-white/8 bg-ink-950/40 px-3 py-1.5 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> connected</span>
        <span>{hasWifi ? 'Wi-Fi adapter present' : 'Ethernet only'}</span>
        <span className="ml-auto">{isEnd ? 'Double-click any app to open it' : ''}</span>
      </div>
    </div>
  )
}
