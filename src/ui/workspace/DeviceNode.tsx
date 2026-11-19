import { useMemo } from 'react'
import { Power, Wifi } from 'lucide-react'
import type { Device } from '../../types'
import { useApp } from '../../store'
import { DeviceIcon, deviceTint } from '../common/DeviceIcon'
import { formatIpWithMask } from '../../lib/ip'
import { DEVICE_H, DEVICE_W } from './geometry'

export function DeviceNode({
  device,
  selected,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
}: {
  device: Device
  selected: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const rev = useApp((s) => s.rev)
  const showLabels = useApp((s) => s.settings.showLabels)
  const sim = useApp((s) => s.sim)
  const ipText = useMemo(() => {
    void rev
    const eps = sim.l3Endpoints(device)
    const primary = formatIpWithMask(eps[0]?.ip, eps[0]?.mask)
    if (primary) return eps.length > 1 ? `${primary} +${eps.length - 1}` : primary
    const iface = device.interfaces.find((i) => i.ip)
    const ip = formatIpWithMask(iface?.ip, iface?.mask)
    if (ip) return ip
    if (device.kind === 'switch') return 'Layer 2 switch'
    return device.model
  }, [device, rev, sim])

  const ports = device.interfaces.filter((i) => i.kind !== 'console' && i.kind !== 'vlan').slice(0, 5)
  const active = ports.some((i) => sim.recentlyActive(device.id, i.id))
  const wifiAssoc = sim.wireless.find((w) => w.clientId === device.id)
  const apAssoc = sim.rt(device.id).assoc.length
  const upCount = ports.filter((i) => sim.portDetail(device.id, i.id)?.physicalUp).length
  const linkCount = device.interfaces.filter((i) => sim.linkForIface(device.id, i.id)).length + (wifiAssoc ? 1 : 0) + apAssoc
  const tint = deviceTint(device.kind)
  const tooltip = [
    device.name,
    `${device.model}${device.power ? '' : ' (powered off)'}`,
    ...device.interfaces
      .filter((i) => i.kind !== 'console')
      .slice(0, 8)
      .map((i) => {
        const d = sim.portDetail(device.id, i.id)
        const addr = formatIpWithMask(i.ip, i.mask)
        return `${i.name}: ${!i.adminUp ? 'admin down' : d?.physicalUp ? 'up' : 'down'}${addr ? ` · ${addr}` : ''}`
      }),
  ].join('\n')

  return (
    <div
      className={`pointer-events-auto absolute select-none rounded-xl border transition-[background,border,box-shadow] duration-150 ${
        selected
          ? 'border-cyan-300/70 bg-ink-800 shadow-[0_0_0_3px_rgba(34,211,238,0.14),0_14px_40px_-12px_rgba(34,211,238,0.5)]'
          : 'border-white/12 bg-ink-850/95 hover:border-white/25 hover:bg-ink-800'
      } ${device.power ? '' : 'opacity-60 saturate-0'}`}
      style={{ left: device.x - DEVICE_W / 2, top: device.y - DEVICE_H / 2, width: DEVICE_W, height: DEVICE_H }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={tooltip}
      data-device-id={device.id}
    >
      <div className="flex h-full flex-col justify-between p-2">
        <div className="flex items-start gap-2">
          <span
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/12"
            style={{ backgroundColor: `${tint}18`, color: tint }}
          >
            <DeviceIcon kind={device.kind} size={17} />
            {device.power ? (
              <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-ink-900 ${active ? 'bg-cyan-300' : 'bg-emerald-400'}`} />
            ) : (
              <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full border border-ink-900 bg-rose-500">
                <Power size={5} />
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1">
              <span className="truncate text-[12px] font-semibold text-slate-100">{device.name}</span>
              {device.kind === 'accesspoint' || device.kind === 'homerouter' ? <Wifi size={10} className="shrink-0 text-cyan-300" /> : null}
            </div>
            {showLabels && <div className="truncate text-[9px] uppercase tracking-wide text-slate-500">{device.model}</div>}
            {showLabels && <div className="mt-0.5 truncate font-mono text-[9px] text-slate-400">{ipText}</div>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {ports.map((p) => {
            const d = sim.portDetail(device.id, p.id)
            const activePort = sim.recentlyActive(device.id, p.id)
            return (
              <span
                key={p.id}
                className={`h-1.5 w-1.5 rounded-full transition ${activePort ? 'bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.9)]' : d?.physicalUp ? 'bg-emerald-400/80' : 'bg-slate-700'}`}
              />
            )
          })}
          <span className="ml-auto text-[8px] font-medium uppercase tracking-wide text-slate-600">
            {wifiAssoc ? `Wi-Fi · ${upCount}/${linkCount}` : linkCount ? `${upCount}/${linkCount} links` : 'no links'}
          </span>
        </div>
      </div>
      {active && <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-cyan-300/30" />}
    </div>
  )
}
