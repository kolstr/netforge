import type { CableType } from '../../types'
import { CABLE_COLORS } from '../../data/catalog'

export const DEVICE_W = 176
export const DEVICE_H = 72

export interface Point {
  x: number
  y: number
}

export function edgePoint(from: Point, to: Point, w = DEVICE_W, h = DEVICE_H): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return { ...from }
  const sx = Math.abs(dx) < 1e-9 ? Infinity : w / 2 / Math.abs(dx)
  const sy = Math.abs(dy) < 1e-9 ? Infinity : h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: from.x + dx * s, y: from.y + dy * s }
}

export function screenToWorld(clientX: number, clientY: number, rect: DOMRect, view: { x: number; y: number; zoom: number }): Point {
  return {
    x: (clientX - rect.left - view.x) / view.zoom,
    y: (clientY - rect.top - view.y) / view.zoom,
  }
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function cableColor(type: string, up: boolean): string {
  if (!up) return '#ef4444'
  return CABLE_COLORS[type as CableType] ?? '#94a3b8'
}
