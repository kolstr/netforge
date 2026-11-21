import type { Link } from '../../types'
import { useApp } from '../../store'
import { edgePoint, cableColor } from './geometry'

const PROTOCOL_COLORS: Record<string, string> = {
  ICMP: '#22d3ee',
  ARP: '#fbbf24',
  DHCP: '#a78bfa',
  DNS: '#60a5fa',
  TCP: '#34d399',
  UDP: '#34d399',
  HTTP: '#f472b6',
  HTTPS: '#f472b6',
  SMTP: '#fb923c',
  POP3: '#fb923c',
  FTP: '#facc15',
  STP: '#94a3b8',
  RIP: '#f87171',
  OSPF: '#c084fc',
  EIGRP: '#fbbf24',
  SYSLOG: '#94a3b8',
  NTP: '#94a3b8',
}

export function LinkLayer({
  links,
  selectedLinkId,
  onSelectLink,
  onLinkContextMenu,
}: {
  links: Link[]
  selectedLinkId: string | null
  onSelectLink: (id: string) => void
  onLinkContextMenu: (e: React.MouseEvent, id: string) => void
}) {
  const rev = useApp((s) => s.rev)
  const sim = useApp((s) => s.sim)
  const mode = sim.mode
  const showLights = useApp((s) => s.settings.showLinkLights)
  void rev

  return (
    <>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} style={{ overflow: 'visible' }}>
        {links.map((link) => {
          const a = sim.device(link.a.deviceId)
          const b = sim.device(link.b.deviceId)
          if (!a || !b) return null
          const pa = edgePoint({ x: a.x, y: a.y }, { x: b.x, y: b.y })
          const pb = edgePoint({ x: b.x, y: b.y }, { x: a.x, y: a.y })
          const up = sim.linkUp(link)
          const color = cableColor(link.type, up)
          const selected = selectedLinkId === link.id
          const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
          const dx = pb.x - pa.x
          const dy = pb.y - pa.y
          const len = Math.hypot(dx, dy) || 1
          const nx = -dy / len
          const ny = dx / len
          const activeA = sim.recentlyActive(link.a.deviceId, link.a.ifaceId)
          const activeB = sim.recentlyActive(link.b.deviceId, link.b.ifaceId)
          const stpA = sim.rt(link.a.deviceId).stp[sim.device(link.a.deviceId)?.interfaces.find((i) => i.id === link.a.ifaceId)?.vlan ?? 1]?.ports[link.a.ifaceId]
          const stpB = sim.rt(link.b.deviceId).stp[sim.device(link.b.deviceId)?.interfaces.find((i) => i.id === link.b.ifaceId)?.vlan ?? 1]?.ports[link.b.ifaceId]
          return (
            <g key={link.id}>
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke={selected ? '#67e8f9' : color}
                strokeWidth={selected ? 3.2 : 2.2}
                strokeOpacity={up ? 0.95 : 0.55}
                strokeDasharray={up ? undefined : '5 4'}
                className="pointer-events-none"
              />
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke="transparent"
                strokeWidth={14}
                className="pointer-events-auto cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectLink(link.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onLinkContextMenu(e, link.id)
                }}
              />
              {selected && (
                <text x={mid.x} y={mid.y - 8} textAnchor="middle" fill="#67e8f9" fontSize={10} className="pointer-events-none select-none">
                  {link.type} · {up ? 'up' : 'down'}
                </text>
              )}
              {showLights && <LinkLight x={pa.x + (pb.x - pa.x) * 0.08 + nx * 5} y={pa.y + (pb.y - pa.y) * 0.08 + ny * 5} up={up} active={activeA} stp={stpA} />}
              {showLights && <LinkLight x={pb.x + (pa.x - pb.x) * 0.08 + nx * 5} y={pb.y + (pa.y - pb.y) * 0.08 + ny * 5} up={up} active={activeB} stp={stpB} />}
              {link.type === 'serial' && (
                <text x={mid.x + nx * 9} y={mid.y + ny * 9} textAnchor="middle" fill={cableColor('serial', true)} fontSize={8} className="pointer-events-none select-none">
                  {link.dceSide === 'a' ? 'DCE' : 'DTE'}
                </text>
              )}
              {link.type === 'console' && (
                <text x={mid.x} y={mid.y - 6} textAnchor="middle" fill={cableColor('console', true)} fontSize={8} className="pointer-events-none select-none">
                  console
                </text>
              )}
            </g>
          )
        })}

        {sim.wireless.map((w) => {
          const client = sim.device(w.clientId)
          const ap = sim.device(w.apId)
          if (!client || !ap) return null
          const mid = { x: (client.x + ap.x) / 2, y: (client.y + ap.y) / 2 - 26 }
          const sig = sim.wirelessSignal(w.clientId)
          return (
            <g key={`${w.clientId}-${w.apId}`}>
              <path
                d={`M ${ap.x} ${ap.y} Q ${mid.x} ${mid.y} ${client.x} ${client.y}`}
                fill="none"
                stroke="#22d3ee"
                strokeOpacity={0.45}
                strokeWidth={1.4}
                strokeDasharray="3 4"
              />
              <circle cx={mid.x} cy={mid.y} r={2} fill="#22d3ee" opacity={0.75} />
              {sig && sig.rssi < -70 && (
                <text x={mid.x} y={mid.y - 6} textAnchor="middle" fill="#fbbf24" fontSize={9}>
                  weak {sig.rssi} dBm
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {mode === 'simulation' &&
        sim.log
          .filter((l) => l.visible)
          .slice(-14)
          .map((entry, i) => {
            const d = sim.device(entry.atDeviceId)
            if (!d) return null
            const color = entry.pdu.color ?? PROTOCOL_COLORS[entry.type] ?? '#22d3ee'
            return (
              <div
                key={`${entry.id}-${i}`}
                className="pointer-events-none absolute z-30 flex items-center gap-1"
                style={{ left: d.x - 40 + (i % 4) * 20, top: d.y - 58 - Math.floor(i / 4) * 16 }}
              >
                <span className="relative flex h-3 w-3 items-center justify-center">
                  <span className="packet-pulse absolute h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="h-1.5 w-1.5 rounded-full ring-1 ring-black/40" style={{ backgroundColor: color }} />
                </span>
                <span className="rounded bg-ink-950/85 px-1 py-0.5 font-mono text-[11px] text-slate-200 shadow" style={{ borderLeft: `2px solid ${color}` }}>
                  {entry.type}
                </span>
              </div>
            )
          })}
    </>
  )
}

function LinkLight({ x, y, up, active, stp }: { x: number; y: number; up: boolean; active: boolean; stp?: 'forwarding' | 'blocking' }) {
  if (stp === 'blocking') return <circle cx={x} cy={y} r={3.4} fill="#f59e0b" stroke="#78350f" strokeWidth={1} />
  if (!up) return <circle cx={x} cy={y} r={3.2} fill="#ef4444" stroke="#450a0a" strokeWidth={1} />
  return (
    <g>
      {active && <circle cx={x} cy={y} r={7} fill="#22d3ee" opacity={0.22} className="animate-pulse" />}
      <circle cx={x} cy={y} r={2.7} fill={active ? '#67e8f9' : '#34d399'} stroke="#052e1b" strokeWidth={0.8} />
    </g>
  )
}
