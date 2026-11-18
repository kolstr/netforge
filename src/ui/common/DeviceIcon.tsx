import {
  Cable,
  Cloud,
  Cpu,
  House,
  Laptop,
  Monitor,
  Network,
  Phone,
  Printer,
  Router,
  Server,
  Share2,
  Shield,
  Smartphone,
  Tablet,
  Wifi,
} from 'lucide-react'
import type { DeviceKind } from '../../types'
import { DEVICE_SPECS } from '../../data/catalog'

const ICONS: Record<DeviceKind, typeof Router> = {
  router: Router,
  switch: Network,
  hub: Share2,
  pc: Monitor,
  laptop: Laptop,
  server: Server,
  printer: Printer,
  phone: Phone,
  accesspoint: Wifi,
  homerouter: House,
  firewall: Shield,
  cloud: Cloud,
  modem: Cable,
  tablet: Tablet,
  smartphone: Smartphone,
  iot: Cpu,
}

export function DeviceIcon({ kind, size = 18, className = '' }: { kind: DeviceKind; size?: number; className?: string }) {
  const Icon = ICONS[kind] ?? Network
  return <Icon size={size} className={className} strokeWidth={1.8} />
}

export function deviceTint(kind: DeviceKind): string {
  return DEVICE_SPECS[kind].tint
}
