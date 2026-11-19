import { useEffect, useState } from 'react'
import { Cpu, FileCode2, Laptop, Network, Power, Server, Settings2, SlidersHorizontal, Smartphone, Wifi, Wrench } from 'lucide-react'
import { useApp } from '../../store'
import { Modal, Tabs } from '../common/Modal'
import { DeviceIcon, deviceTint } from '../common/DeviceIcon'
import { PhysicalTab } from '../device/PhysicalTab'
import { ConfigTab } from '../device/ConfigTab'
import { CliTab } from '../device/CliTab'
import { DesktopTab } from '../desktop/DesktopTab'
import { ServicesTab } from '../device/ServicesTab'
import { AttributesTab } from '../device/AttributesTab'
import { HomeRouterAdmin } from '../desktop/HomeRouterAdmin'
import { formatIpWithMask } from '../../lib/ip'

type TabId = 'physical' | 'config' | 'cli' | 'desktop' | 'services' | 'gui' | 'attributes'

export function DeviceDialog() {
  const store = useApp()
  const dialog = store.dialog
  const device = dialog?.type === 'device' ? store.sim.device(dialog.deviceId) : undefined
  const [tab, setTab] = useState<TabId>('physical')

  useEffect(() => {
    if (dialog?.type === 'device') {
      const d = store.sim.device(dialog.deviceId)
      if (!d) return
      const requested = dialog.tab as TabId | undefined
      const defaultTab: TabId = d.kind === 'pc' || d.kind === 'laptop' || d.kind === 'tablet' || d.kind === 'smartphone' ? 'desktop' : 'physical'
      setTab(requested ?? defaultTab)
    }
  }, [dialog, store.sim])

  if (!device) return null
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [{ id: 'physical', label: 'Physical', icon: <Wrench size={11} /> }]
  tabs.push({ id: 'config', label: 'Config', icon: <Settings2 size={11} /> })
  if (['router', 'switch', 'firewall', 'accesspoint'].includes(device.kind)) tabs.push({ id: 'cli', label: 'CLI', icon: <FileCode2 size={11} /> })
  if (device.kind === 'server') tabs.push({ id: 'services', label: 'Services', icon: <Server size={11} /> })
  if (['pc', 'laptop', 'server', 'tablet', 'smartphone'].includes(device.kind)) tabs.push({ id: 'desktop', label: 'Desktop', icon: <Laptop size={11} /> })
  if (device.kind === 'homerouter') tabs.push({ id: 'gui', label: 'GUI', icon: <Wifi size={11} /> })
  tabs.push({ id: 'attributes', label: 'Attributes', icon: <SlidersHorizontal size={11} /> })

  const current = tabs.some((t) => t.id === tab) ? tab : 'physical'
  const primaryIface = device.interfaces.find((i) => i.ip)
  const primaryAddress = formatIpWithMask(primaryIface?.ip, primaryIface?.mask)

  return (
    <Modal
      onClose={() => store.setDialog(null)}
      width="max-w-[1120px]"
      noPadding
      headerRight={
        <div className="flex items-center gap-1.5">
          <button
            className={`btn ${device.power ? '' : 'btn-primary'}`}
            onClick={() => { device.power = !device.power; store.sim.topologyChanged() }}
          >
            <Power size={12} /> {device.power ? 'On' : 'Off'}
          </button>
        </div>
      }
      title={
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10" style={{ backgroundColor: `${deviceTint(device.kind)}18`, color: deviceTint(device.kind) }}>
            <DeviceIcon kind={device.kind} size={15} />
          </span>
          <span>{device.name}</span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-normal text-slate-500">{device.model}</span>
          {!device.power && <span className="rounded bg-rose-400/10 px-1.5 py-0.5 text-[9px] font-normal text-rose-300">powered off</span>}
        </div>
      }
      subtitle={`${device.kind} · ${device.interfaces.filter((i) => i.kind !== 'console').length} ports · ${primaryAddress ?? 'no IP address'}`}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <Tabs tabs={tabs} value={current} onChange={setTab} />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain p-4">
          {current === 'physical' && <PhysicalTab device={device} />}
          {current === 'config' && <ConfigTab device={device} />}
          {current === 'cli' && <CliTab device={device} />}
          {current === 'services' && <ServicesTab device={device} />}
          {current === 'desktop' && <DesktopTab device={device} />}
          {current === 'gui' && <div className="rounded-xl border border-white/8 bg-ink-950/40 p-4"><HomeRouterAdmin device={device} /></div>}
          {current === 'attributes' && <AttributesTab device={device} />}
        </div>
      </div>
    </Modal>
  )
}

export function deviceKindIcon(kind: string) {
  switch (kind) {
    case 'pc':
    case 'laptop':
      return <Laptop size={12} />
    case 'server':
      return <Server size={12} />
    case 'smartphone':
    case 'tablet':
      return <Smartphone size={12} />
    case 'switch':
      return <Network size={12} />
    case 'router':
      return <Cpu size={12} />
    default:
      return <Cpu size={12} />
  }
}
