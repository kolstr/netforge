import type { Device, Note, Shape } from '../types'

export interface Viewport {
  x: number
  y: number
  zoom: number
}

interface FitItem {
  x: number
  y: number
  w?: number
  h?: number
}

export function layoutItems(sim: { listDevices: () => Device[]; notes: Note[]; shapes: Shape[] }): FitItem[] {
  return [
    ...sim.listDevices(),
    ...sim.notes.map((n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2, w: n.w, h: n.h })),
    ...sim.shapes.map((s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2, w: s.w, h: s.h })),
  ]
}

export function fitWorkspace(setView: (v: Viewport) => void, devices: FitItem[]) {
  const host = document.querySelector('[data-workspace]') as HTMLElement | null
  const rect = host?.getBoundingClientRect()
  const width = rect?.width ?? Math.max(320, window.innerWidth - 560)
  const height = rect?.height ?? Math.max(260, window.innerHeight - 340)
  if (!devices.length) {
    setView({ x: 0, y: 0, zoom: 1 })
    return
  }
  const minX = Math.min(...devices.map((d) => d.x - (d.w ?? 140) / 2)) - 40
  const minY = Math.min(...devices.map((d) => d.y - (d.h ?? 82) / 2)) - 30
  const maxX = Math.max(...devices.map((d) => d.x + (d.w ?? 140) / 2)) + 40
  const maxY = Math.max(...devices.map((d) => d.y + (d.h ?? 82) / 2)) + 30
  const bw = Math.max(120, maxX - minX)
  const bh = Math.max(100, maxY - minY)
  const zoom = Math.max(0.35, Math.min(1.25, Math.min((width - 70) / bw, (height - 60) / bh)))
  setView({
    zoom,
    x: (width - bw * zoom) / 2 - minX * zoom,
    y: (height - bh * zoom) / 2 - minY * zoom,
  })
}
