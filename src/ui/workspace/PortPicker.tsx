import { Cable, Check } from 'lucide-react'
import type { CableType, Device, Interface } from '../../types'
import { Modal } from '../common/Modal'
import { useApp } from '../../store'
import { formatIpWithMask } from '../../lib/ip'
import { cableColor } from './geometry'

export function compatiblePort(kind: CableType, iface: Interface): boolean {
  switch (kind) {
    case 'serial':
      return iface.kind === 'serial'
    case 'console':
      return iface.kind === 'console'
    case 'coax':
      return iface.kind === 'coax'
    case 'phone':
      return iface.kind === 'phone'
    case 'fiber':
      return iface.kind === 'ethernet' || iface.kind === 'fiber'
    default:
      return iface.kind === 'ethernet' || iface.kind === 'fiber'
  }
}

export function PortPicker({
  device,
  cable,
  title,
  peer,
  onPick,
  onClose,
}: {
  device: Device
  cable: CableType
  title: string
  peer?: { deviceId: string; ifaceId: string }
  onPick: (iface: Interface) => void
  onClose: () => void
}) {
  const sim = useApp((s) => s.sim)
  const peerDevice = peer ? sim.device(peer.deviceId) : undefined
  const peerIface = peer ? peerDevice?.interfaces.find((i) => i.id === peer.ifaceId) : undefined
  const usable = device.interfaces.filter((i) => compatiblePort(cable, i))
  const ports = usable.filter((i) => !peerIface || !peerDevice || !sim.checkCable(cable, peerIface, i, peerDevice, device))
  const inUse = new Set(ports.filter((i) => sim.portDetail(device.id, i.id)?.peer).map((i) => i.id))
  const available = ports.length - inUse.size

  return (
    <Modal onClose={onClose} title={title} subtitle={`${device.name} · ${device.model}`} width="max-w-lg">
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-ink-950/60 px-2.5 py-2 text-[11px] text-slate-400">
          <Cable size={13} style={{ color: cableColor(cable, true) }} />
          {cable} cable · {available} of {ports.length} compatible port{ports.length === 1 ? '' : 's'} available
        </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-white/8">
          {!ports.length && (
            <div className="p-6 text-center text-[11px] text-slate-500">
              {usable.length
                ? `No ${cable} port works with ${peerDevice?.name ?? 'the other end'}: a ${cable} cable cannot pair those ports. Choose a different cable type.`
                : 'No compatible ports. Add a module (Physical tab) or choose a different cable type.'}
            </div>
          )}
          {!!ports.length && !available && (
            <div className="p-6 text-center text-[11px] text-slate-500">
              Every compatible port already has a cable plugged in. Remove an existing link to free one up.
            </div>
          )}
          {ports.map((iface) => {
            const detail = sim.portDetail(device.id, iface.id)
            const busy = inUse.has(iface.id)
            const addr = formatIpWithMask(iface.ip, iface.mask)
            return (
              <button
                key={iface.id}
                onClick={() => {
                  if (!busy) onPick(iface)
                }}
                aria-disabled={busy}
                title={busy ? `${iface.name} already has a cable plugged in — remove that link first` : undefined}
                className={`flex w-full items-center gap-3 border-b border-white/5 px-3 py-2 text-left transition last:border-0 ${
                  busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-white/5'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${detail?.physicalUp ? 'bg-emerald-400' : busy ? 'bg-amber-400' : 'bg-slate-600'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] text-slate-200">{iface.name}</span>
                  <span className="block text-[9px] text-slate-500">
                    {iface.kind} · {iface.speed >= 1000 ? `${iface.speed / 1000} Gbps` : `${iface.speed} Mbps`}
                    {addr ? ` · ${addr}` : ''}
                    {iface.kind === 'serial' ? ' · serial WAN' : ''}
                    {iface.kind === 'console' ? ' · RS-232' : ''}
                  </span>
                </span>
                {busy ? (
                  <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-300">in use</span>
                ) : (
                  <Check size={13} className="text-slate-600" />
                )}
              </button>
            )
          })}
        </div>
        {!!inUse.size && !!available && (
          <p className="text-[10px] text-amber-300/80">Ports marked “in use” already have a cable plugged in and cannot be selected.</p>
        )}
        <p className="text-[10px] text-slate-600">
          {cable === 'serial'
            ? 'The first device you select becomes the DCE side. Configure a clock rate on the DCE interface to bring the line up.'
            : cable === 'console'
              ? 'Console links provide out-of-band CLI access through the PC Terminal application.'
              : 'Link lights show physical status. Use the Inspect tool to view learned tables.'}
        </p>
      </div>
    </Modal>
  )
}
