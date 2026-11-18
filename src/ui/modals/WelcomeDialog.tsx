import { CheckCircle2, ChevronRight, Keyboard, Layers, MousePointer2, Network, Router, Sparkles, Terminal, Wifi, Zap } from 'lucide-react'
import { useApp } from '../../store'
import { Modal } from '../common/Modal'

export function WelcomeDialog() {
  const store = useApp()
  return (
    <Modal onClose={() => store.setDialog(null)} width="max-w-3xl" title="Welcome to NetForge Studio" subtitle="A modern network simulator built for learning and experimentation" icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-ink-950"><Network size={19} /></div>}>
      <div className="space-y-4">
        <div className="rounded-xl border border-white/8 bg-gradient-to-br from-cyan-400/10 via-ink-900 to-indigo-500/10 p-4">
          <h3 className="text-sm font-semibold text-slate-100">Build, configure and simulate networks in your browser</h3>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-400">
            Drag routers, switches, PCs, servers and wireless devices onto the canvas. Configure them through a GUI or an IOS-style command line, then watch packets traverse the topology in Simulation Mode — complete with an event list and PDU details.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => { store.setDialog(null); if (!store.sim.listDevices().length) store.loadExample() }}>
              <Sparkles size={12} /> Load starter lab
            </button>
            <button className="btn" onClick={() => store.setDialog(null)}>Start with an empty workspace</button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { icon: <Router size={15} />, title: 'Devices', text: 'Router, 24-port switch, hub, PC, laptop, server, printer, IP phone, access point, home gateway, firewall and WAN cloud.' },
            { icon: <Wifi size={15} />, title: 'Protocols', text: 'ARP, ICMP, DHCP, DNS, HTTP(S), email, FTP, TFTP, NTP, syslog, STP, VLANs, RIP, OSPF, EIGRP, NAT and ACLs.' },
            { icon: <Terminal size={15} />, title: 'CLI', text: 'IOS-style modes, abbreviation, context help, tab completion and hundreds of configuration and show commands.' },
          ].map((c) => (
            <div key={c.title} className="rounded-lg border border-white/8 bg-ink-950/40 p-3">
              <div className="text-cyan-300">{c.icon}</div>
              <div className="mt-1.5 text-[11px] font-semibold text-slate-200">{c.title}</div>
              <div className="mt-0.5 text-[9px] leading-relaxed text-slate-500">{c.text}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><Zap size={11} className="text-cyan-300" /> Quick start</div>
            <ol className="mt-2 space-y-1.5 text-[10px] text-slate-400">
              {[
                'Pick a device from the left palette and click the canvas.',
                'Choose a cable, click both devices and select interfaces.',
                'Double-click a device to open its configuration window.',
                'Use DHCP or set static IPs; configure DNS/HTTP on a server.',
                'Switch to Simulation Mode, add a PDU and press Play.',
              ].map((s, i) => (
                <li key={i} className="flex gap-2"><span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-[8px] font-bold text-cyan-300">{i + 1}</span>{s}</li>
              ))}
            </ol>
          </div>
          <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><Keyboard size={11} className="text-cyan-300" /> Keyboard shortcuts</div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[9px] text-slate-500">
              {[
                ['Esc', 'Select tool / cancel'],
                ['Del', 'Delete selection'],
                ['Ctrl+Z', 'Undo'],
                ['Ctrl+Y', 'Redo'],
                ['Ctrl+S', 'Save workspace'],
                ['Ctrl+D', 'Duplicate'],
                ['Space+drag', 'Pan canvas'],
                ['Wheel', 'Zoom'],
                ['Ctrl+A', 'Select all'],
                ['Double-click', 'Configure device'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5"><span className="kbd">{k}</span><span className="truncate">{v}</span></div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[10px] text-emerald-200">
          <CheckCircle2 size={13} />
          Everything runs locally in your browser. No account, no cloud, no telemetry.
          <button className="ml-auto inline-flex items-center gap-0.5 text-emerald-300 hover:underline" onClick={() => store.setDialog({ type: 'about' })}>About <ChevronRight size={10} /></button>
        </div>
      </div>
    </Modal>
  )
}

export function AboutDialog() {
  const store = useApp()
  return (
    <Modal onClose={() => store.setDialog(null)} width="max-w-lg" title="About NetForge Studio" subtitle="Version 1.0.0" icon={<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-ink-950"><Network size={18} /></div>}>
      <div className="space-y-3 text-[11px] leading-relaxed text-slate-400">
        <p>NetForge Studio is an independent, browser-based network simulation and learning tool. It is not affiliated with, endorsed by, or connected to Cisco Systems. “Packet Tracer” is a trademark of its respective owner; this project implements similar learning concepts with original code, branding and artwork.</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Simulation', 'Discrete-event packet engine with per-hop animation'],
            ['Routing', 'Static, RIP, OSPF and EIGRP'],
            ['Switching', 'VLANs, 802.1Q trunks and STP'],
            ['Services', 'DHCP, DNS, HTTP(S), email, FTP, TFTP, NTP, syslog'],
            ['Security', 'ACLs, NAT/PAT and stateful firewall concepts'],
            ['Storage', 'Local browser autosave + portable JSON export'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-white/8 bg-ink-950/40 p-2">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-cyan-300">{k}</div>
              <div className="mt-0.5 text-[9px] text-slate-500">{v}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500">Built with React, TypeScript, Tailwind CSS and a custom discrete-event network simulator. Workspace data never leaves this browser unless you export it.</p>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => store.setDialog({ type: 'welcome' })}><MousePointer2 size={11} /> Quick start</button>
          <button className="btn" onClick={() => store.setDialog({ type: 'preferences' })}><Layers size={11} /> Preferences</button>
          <button className="btn ml-auto" onClick={() => store.setDialog(null)}>Close</button>
        </div>
      </div>
    </Modal>
  )
}
