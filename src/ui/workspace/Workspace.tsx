import { useEffect, useRef, useState } from 'react'
import { Activity, Cable, CheckCircle2, Eye, Grid3x3, Info, MousePointer2, Network, Play, Plus, Settings2, Sparkles, Trash2, Zap } from 'lucide-react'
import type { CableType, Device, Interface, Shape } from '../../types'
import { useApp } from '../../store'
import { DeviceNode } from './DeviceNode'
import { LinkLayer } from './LinkLayer'
import { PortPicker } from './PortPicker'
import { ContextMenu, type ContextItem } from './ContextMenu'
import { clamp, screenToWorld, type Point } from './geometry'

export function Workspace() {
  const store = useApp()
  const sim = store.sim
  const ref = useRef<HTMLDivElement>(null)
  const [pduFrom, setPduFrom] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [portPicker, setPortPicker] = useState<{
    device: Device
    cable: CableType
    stage: 'from' | 'to'
    from?: { deviceId: string; ifaceId: string }
  } | null>(null)
  const [context, setContext] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null)
  const [marquee, setMarquee] = useState<{ start: Point; current: Point } | null>(null)
  const [shapeDraft, setShapeDraft] = useState<{ start: Point; current: Point } | null>(null)
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ ids: string[]; start: Point; origins: Map<string, Point>; moved: boolean } | null>(null)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [noteDrag, setNoteDrag] = useState<{ id: string; start: Point; origin: Point; moved: boolean } | null>(null)
  const [shapeDrag, setShapeDrag] = useState<{ id: string; start: Point; origin: Point; moved: boolean } | null>(null)
  const [shapeResize, setShapeResize] = useState<{ id: string; handle: string; start: Point; origin: { x: number; y: number; w: number; h: number }; moved: boolean } | null>(null)
  const [editingShape, setEditingShape] = useState<string | null>(null)
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const notePanRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const spaceRef = useRef(false)

  const worldPoint = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return screenToWorld(clientX, clientY, rect, useApp.getState().view)
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = useApp.getState()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const wx = (mx - s.view.x) / s.view.zoom
      const wy = (my - s.view.y) / s.view.zoom
      const factor = Math.exp(-e.deltaY * 0.0016)
      const zoom = clamp(s.view.zoom * factor, 0.25, 2.2)
      s.setView({ zoom, x: mx - wx * zoom, y: my - wy * zoom })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) spaceRef.current = true
      if (e.key === 'Escape') {
        setPduFrom(null)
        setMarquee(null)
        setShapeDraft(null)
        setPortPicker(null)
        setContext(null)
        useApp.getState().clearPalette()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const view = useApp.getState().view
      const wx = (e.clientX - rect.left - view.x) / view.zoom
      const wy = (e.clientY - rect.top - view.y) / view.zoom
      const dx = wx - drag.start.x
      const dy = wy - drag.start.y
      const moved = drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2
      for (const id of drag.ids) {
        const d = sim.device(id)
        const origin = drag.origins.get(id)
        if (d && origin) {
          d.x = store.settings.snapToGrid ? Math.round((origin.x + dx) / 20) * 20 : origin.x + dx
          d.y = store.settings.snapToGrid ? Math.round((origin.y + dy) / 20) * 20 : origin.y + dy
        }
      }
      if (store.settings.alignmentGuides) {
        const moving = new Set(drag.ids)
        const others = Array.from(sim.devices.values()).filter((d) => !moving.has(d.id))
        const gx: number[] = []
        const gy: number[] = []
        for (const id of drag.ids) {
          const d = sim.device(id)
          if (!d) continue
          for (const o of others) {
            if (Math.abs(d.x - o.x) < 4 && !gx.includes(o.x)) gx.push(o.x)
            if (Math.abs(d.y - o.y) < 4 && !gy.includes(o.y)) gy.push(o.y)
          }
        }
        setGuides((prev) => {
          if (gx.length === prev.x.length && gy.length === prev.y.length && gx.every((v, i) => v === prev.x[i]) && gy.every((v, i) => v === prev.y[i])) return prev
          return { x: gx, y: gy }
        })
      }
      if (moved !== drag.moved) setDrag({ ...drag, moved })
      sim.bump()
    }
    const up = () => {
      if (drag.moved) {
        store.saveLocal()
        store.setStatus('Devices moved')
      }
      setDrag(null)
      setGuides({ x: [], y: [] })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, sim, store])

  useEffect(() => {
    if (!noteDrag) return
    const move = (e: PointerEvent) => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const view = useApp.getState().view
      const wx = (e.clientX - rect.left - view.x) / view.zoom
      const wy = (e.clientY - rect.top - view.y) / view.zoom
      const note = sim.notes.find((n) => n.id === noteDrag.id)
      if (note) {
        note.x = noteDrag.origin.x + (wx - noteDrag.start.x)
        note.y = noteDrag.origin.y + (wy - noteDrag.start.y)
        setNoteDrag({ ...noteDrag, moved: true })
        sim.bump()
      }
    }
    const up = () => {
      if (noteDrag.moved) {
        store.saveLocal()
      }
      setNoteDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [noteDrag, sim, store])

  useEffect(() => {
    if (!shapeDrag) return
    const move = (e: PointerEvent) => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const view = useApp.getState().view
      const wx = (e.clientX - rect.left - view.x) / view.zoom
      const wy = (e.clientY - rect.top - view.y) / view.zoom
      const shape = sim.shapes.find((x) => x.id === shapeDrag.id)
      if (shape) {
        const nx = shapeDrag.origin.x + (wx - shapeDrag.start.x)
        const ny = shapeDrag.origin.y + (wy - shapeDrag.start.y)
        shape.x = store.settings.snapToGrid ? Math.round(nx / 20) * 20 : nx
        shape.y = store.settings.snapToGrid ? Math.round(ny / 20) * 20 : ny
        if (!shapeDrag.moved) setShapeDrag({ ...shapeDrag, moved: true })
        sim.bump()
      }
    }
    const up = () => {
      if (shapeDrag.moved) {
        store.saveLocal()
        store.setStatus('Shape moved')
      }
      setShapeDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [shapeDrag, sim, store])

  useEffect(() => {
    if (!shapeResize) return
    const move = (e: PointerEvent) => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const view = useApp.getState().view
      const wx = (e.clientX - rect.left - view.x) / view.zoom
      const wy = (e.clientY - rect.top - view.y) / view.zoom
      const shape = sim.shapes.find((x) => x.id === shapeResize.id)
      if (!shape) return
      const o = shapeResize.origin
      const dx = wx - shapeResize.start.x
      const dy = wy - shapeResize.start.y
      if (shape.kind === 'line') {
        if (shapeResize.handle === 'line-start') {
          const endX = o.x + o.w
          const endY = o.y + o.h
          shape.x = o.x + dx
          shape.y = o.y + dy
          shape.w = endX - shape.x
          shape.h = endY - shape.y
        } else {
          shape.w = o.w + dx
          shape.h = o.h + dy
        }
      } else {
        const min = 20
        const left = shapeResize.handle.includes('w') ? o.x + dx : o.x
        const right = shapeResize.handle.includes('e') ? o.x + o.w + dx : o.x + o.w
        const top = shapeResize.handle.includes('n') ? o.y + dy : o.y
        const bottom = shapeResize.handle.includes('s') ? o.y + o.h + dy : o.y + o.h
        let x = left
        let y = top
        let w = right - left
        let h = bottom - top
        if (w < min) {
          if (shapeResize.handle.includes('w')) x = right - min
          w = min
        }
        if (h < min) {
          if (shapeResize.handle.includes('n')) y = bottom - min
          h = min
        }
        shape.x = x
        shape.y = y
        shape.w = w
        shape.h = h
      }
      if (!shapeResize.moved) setShapeResize({ ...shapeResize, moved: true })
      sim.bump()
    }
    const up = () => {
      if (shapeResize.moved) {
        store.saveLocal()
        store.setStatus('Shape resized')
      }
      setShapeResize(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [shapeResize, sim, store])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = panRef.current
      if (!p) return
      useApp.getState().setView({ x: p.originX + (e.clientX - p.startX), y: p.originY + (e.clientY - p.startY) })
    }
    const up = () => {
      panRef.current = null
      if (notePanRef.current) notePanRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  useEffect(() => {
    if (!marquee) return
    const up = (e: PointerEvent) => {
      const s = useApp.getState()
      const x1 = Math.min(marquee.start.x, marquee.current.x)
      const x2 = Math.max(marquee.start.x, marquee.current.x)
      const y1 = Math.min(marquee.start.y, marquee.current.y)
      const y2 = Math.max(marquee.start.y, marquee.current.y)
      if (Math.abs(x2 - x1) > 4 && Math.abs(y2 - y1) > 4) {
        const ids = sim
          .listDevices()
          .filter((d) => d.x + 69 >= x1 && d.x - 69 <= x2 && d.y + 36 >= y1 && d.y - 36 <= y2)
          .map((d) => d.id)
        s.select(ids, e.shiftKey)
      }
      setMarquee(null)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [marquee, sim])

  useEffect(() => {
    if (!shapeDraft) return
    const up = () => {
      const s = useApp.getState()
      const w = Math.abs(shapeDraft.current.x - shapeDraft.start.x)
      const h = Math.abs(shapeDraft.current.y - shapeDraft.start.y)
      const x = Math.min(shapeDraft.start.x, shapeDraft.current.x)
      const y = Math.min(shapeDraft.start.y, shapeDraft.current.y)
      const kind = s.tool === 'shape-line' ? 'line' : s.tool === 'shape-ellipse' ? 'ellipse' : 'rect'
      if (kind === 'line') {
        if (Math.hypot(w, h) > 8) {
          s.createShape('line', shapeDraft.start.x, shapeDraft.start.y, shapeDraft.current.x - shapeDraft.start.x, shapeDraft.current.y - shapeDraft.start.y)
          const shape = s.sim.shapes[s.sim.shapes.length - 1]
          if (shape) s.select([shape.id])
          s.setTool('select')
        }
      } else if (w > 12 && h > 12) {
        s.createShape(kind, x, y, w, h)
        const shape = s.sim.shapes[s.sim.shapes.length - 1]
        if (shape) s.select([shape.id])
        s.setTool('select')
      }
      setShapeDraft(null)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [shapeDraft])

  const onCanvasDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.canvas) return
    const p = worldPoint(e.clientX, e.clientY)
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault()
      panRef.current = { startX: e.clientX, startY: e.clientY, originX: store.view.x, originY: store.view.y }
      return
    }
    if (e.button !== 0) return
    if (store.palette.kind) {
      store.addDeviceAt(store.palette.kind, p.x, p.y)
      return
    }
    if (store.tool === 'note') {
      store.createNote(p.x - 95, p.y - 45)
      const n = sim.notes[sim.notes.length - 1]
      if (n) setEditingNote(n.id)
      return
    }
    if (store.tool === 'text') {
      store.createShape('text', p.x, p.y, 180, 24)
      const shape = sim.shapes[sim.shapes.length - 1]
      if (shape) {
        store.updateShape(shape.id, { text: 'Text', color: '#e2e8f0' })
        store.select([shape.id])
        setEditingShape(shape.id)
        store.setTool('select')
      }
      return
    }
    if (store.tool.startsWith('shape-')) {
      setShapeDraft({ start: p, current: p })
      return
    }
    if (store.tool === 'pdu-simple') {
      if (pduFrom) setPduFrom(null)
      return
    }
    if (store.tool === 'select') {
      if (!e.shiftKey) store.select([])
      setMarquee({ start: p, current: p })
    }
  }

  const onCanvasMove = (e: React.PointerEvent) => {
    const p = worldPoint(e.clientX, e.clientY)
    setCursor(p)
    if (marquee) setMarquee({ ...marquee, current: p })
    if (shapeDraft) setShapeDraft({ ...shapeDraft, current: p })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const p = worldPoint(e.clientX, e.clientY)
    const kind = e.dataTransfer.getData('application/netforge-device')
    if (kind) useApp.getState().addDeviceAt(kind as Device['kind'], p.x, p.y)
    const cable = e.dataTransfer.getData('application/netforge-cable')
    if (cable) useApp.getState().chooseCable(cable as CableType)
  }

  const onCanvasContext = (e: React.MouseEvent) => {
    e.preventDefault()
    const s = useApp.getState()
    if (s.palette.kind || s.palette.cable || s.connectingFrom) {
      s.clearPalette()
      s.setStatus('Placement cancelled')
    }
  }

  const deviceDown = (e: React.PointerEvent, device: Device) => {
    e.stopPropagation()
    if (e.button === 1 || spaceRef.current) {
      panRef.current = { startX: e.clientX, startY: e.clientY, originX: store.view.x, originY: store.view.y }
      return
    }
    if (e.button !== 0) return
    const s = useApp.getState()
    if (s.tool === 'delete') {
      s.select([device.id])
      s.deleteSelection()
      return
    }
    if (s.tool === 'inspect') {
      s.select([device.id])
      s.setRightOpen(true)
      s.setStatus(`Inspecting ${device.name}`)
      return
    }
    if (s.connectingFrom) {
      setPortPicker({ device, cable: s.connectingFrom.cable, stage: 'to', from: { deviceId: s.connectingFrom.deviceId, ifaceId: s.connectingFrom.ifaceId } })
      return
    }
    if (s.palette.cable) {
      setPortPicker({ device, cable: s.palette.cable, stage: 'from' })
      return
    }
    if (s.tool === 'pdu-simple') {
      if (!pduFrom) {
        setPduFrom(device.id)
        s.setStatus(`PDU source: ${device.name} — now click the destination`)
      } else if (pduFrom !== device.id) {
        s.addSimplePdu(pduFrom, device.id)
        setPduFrom(null)
        s.setTool('select')
      }
      return
    }
    if (s.tool === 'pdu-complex') {
      s.setDialog({ type: 'complex-pdu', sourceId: device.id })
      return
    }
    if (!s.selectedIds.includes(device.id)) s.select([device.id], e.shiftKey)
    else if (e.shiftKey) s.toggleSelect(device.id)
    const ids = useApp.getState().selectedIds
    const origins = new Map<string, Point>()
    for (const id of ids) {
      const d = sim.device(id)
      if (d) origins.set(id, { x: d.x, y: d.y })
    }
    setDrag({ ids, start: worldPoint(e.clientX, e.clientY), origins, moved: false })
  }

  const openContext = (e: React.MouseEvent, device: Device) => {
    e.preventDefault()
    e.stopPropagation()
    setContext({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Configure', icon: <Settings2 size={13} />, onClick: () => store.setDialog({ type: 'device', deviceId: device.id }) },
        { label: 'Inspect tables', icon: <Eye size={13} />, onClick: () => { store.select([device.id]); store.setRightOpen(true); store.setTool('inspect') } },
        { label: device.power ? 'Power off' : 'Power on', icon: <Zap size={13} />, onClick: () => { device.power = !device.power; sim.topologyChanged() } },
        { label: 'Ping from this device', icon: <Activity size={13} />, onClick: () => { setPduFrom(device.id); store.setTool('pdu-simple') } },
        { label: 'Duplicate', icon: <Plus size={13} />, onClick: () => { store.select([device.id]); store.duplicateSelection() } },
        { label: 'Delete', icon: <Trash2 size={13} />, danger: true, onClick: () => { store.select([device.id]); store.deleteSelection() } },
      ],
    })
  }

  const linkContext = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContext({
      x: e.clientX,
      y: e.clientY,
      items: [{ label: 'Delete link', icon: <Trash2 size={13} />, danger: true, onClick: () => { store.selectLink(id); store.deleteSelection() } }],
    })
  }

  const resizeDown = (e: React.PointerEvent, shape: Shape, handle: string) => {
    e.stopPropagation()
    e.preventDefault()
    const s = useApp.getState()
    s.select([shape.id])
    s.setRightOpen(true)
    setShapeResize({ id: shape.id, handle, start: worldPoint(e.clientX, e.clientY), origin: { x: shape.x, y: shape.y, w: shape.w, h: shape.h }, moved: false })
  }

  const shapeDown = (e: React.PointerEvent, shape: Shape) => {
    e.stopPropagation()
    if (e.button !== 0 || editingShape === shape.id) return
    const s = useApp.getState()
    if (s.tool === 'delete') {
      s.select([shape.id])
      s.deleteSelection()
      return
    }
    if (s.tool !== 'select' && s.tool !== 'inspect') return
    if (!s.selectedIds.includes(shape.id) || e.shiftKey) s.select([shape.id], e.shiftKey)
    s.setRightOpen(true)
    setShapeDrag({ id: shape.id, start: worldPoint(e.clientX, e.clientY), origin: { x: shape.x, y: shape.y }, moved: false })
    s.setStatus('Shape selected — drag to move, double-click to edit text, Del to delete')
  }

  const openShapeContext = (e: React.MouseEvent, shape: Shape) => {
    e.preventDefault()
    e.stopPropagation()
    setContext({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Edit text', icon: <Settings2 size={13} />, onClick: () => { store.select([shape.id]); setEditingShape(shape.id) } },
        { label: 'Duplicate', icon: <Plus size={13} />, onClick: () => { store.select([shape.id]); store.duplicateSelection() } },
        { label: 'Delete', icon: <Trash2 size={13} />, danger: true, onClick: () => { store.select([shape.id]); store.deleteSelection() } },
      ],
    })
  }

  const commitShapeText = (text: string) => {
    if (!editingShape) return
    const shape = sim.shapes.find((s) => s.id === editingShape)
    if (shape?.kind === 'text' && !text.trim()) {
      sim.shapes = sim.shapes.filter((s) => s.id !== editingShape)
      store.select([])
      sim.bump()
      store.saveLocal()
    } else {
      store.updateShape(editingShape, { text })
    }
    setEditingShape(null)
  }

  const view = store.view
  const devices = sim.listDevices()
  const visibleEvents = sim.mode === 'simulation' ? sim.log.filter((l) => l.visible) : []
  // While a palette device or a drawing tool is armed, annotations must not swallow the click that creates the new object.
  const annotationsClickThrough =
    Boolean(store.palette.kind) || store.tool === 'note' || store.tool === 'text' || store.tool.startsWith('shape-')

  const onPickPort = (iface: Interface) => {
    if (!portPicker) return
    const s = useApp.getState()
    if (portPicker.stage === 'from') {
      s.setConnectingFrom({ deviceId: portPicker.device.id, ifaceId: iface.id, cable: portPicker.cable })
      s.setStatus(`${portPicker.device.name} ${iface.name} selected — choose the far end`)
      setPortPicker(null)
      return
    }
    if (portPicker.from) {
      if (portPicker.from.deviceId === portPicker.device.id) {
        s.setStatus('Cannot connect a device to itself')
        setPortPicker(null)
        return
      }
      const connected = s.connect(portPicker.from, { deviceId: portPicker.device.id, ifaceId: iface.id }, portPicker.cable)
      if (connected) {
        s.setConnectingFrom(null)
        if (s.palette.cable) s.setStatus('Link created — click another device to connect, Esc or right-click to finish')
      }
    }
    setPortPicker(null)
  }

  return (
    <div
      ref={ref}
      className="workspace-bg relative min-h-0 flex-1 overflow-hidden" data-workspace
      onPointerDown={onCanvasDown}
      onPointerMove={onCanvasMove}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      onContextMenu={onCanvasContext}
      style={{ cursor: store.palette.kind || store.palette.cable || spaceRef.current ? 'crosshair' : 'default' }}
    >
      <div
        className={`pointer-events-none absolute inset-0 ${store.settings.showGrid ? 'workspace-grid' : ''}`}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px` }}
      />

      <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})` }}>
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {shapeDraft && store.tool !== 'shape-line' && (
            <rect
              x={Math.min(shapeDraft.start.x, shapeDraft.current.x)}
              y={Math.min(shapeDraft.start.y, shapeDraft.current.y)}
              width={Math.abs(shapeDraft.current.x - shapeDraft.start.x)}
              height={Math.abs(shapeDraft.current.y - shapeDraft.start.y)}
              rx={10}
              fill="#22d3ee0d"
              stroke="#22d3ee"
              strokeDasharray="5 4"
              strokeWidth={1.5}
            />
          )}
          {shapeDraft && store.tool === 'shape-line' && (
            <line x1={shapeDraft.start.x} y1={shapeDraft.start.y} x2={shapeDraft.current.x} y2={shapeDraft.current.y} stroke="#22d3ee" strokeDasharray="5 4" strokeWidth={2} />
          )}
          {store.connectingFrom &&
            (() => {
              const d = sim.device(store.connectingFrom.deviceId)
              if (!d) return null
              return (
                <g>
                  <line x1={d.x} y1={d.y} x2={cursor.x} y2={cursor.y} stroke="#22d3ee" strokeDasharray="6 5" strokeWidth={1.8} className="animate-dash" />
                  <circle cx={cursor.x} cy={cursor.y} r={4} fill="#22d3ee" />
                </g>
              )
            })()}
          {marquee && (
            <rect
              x={Math.min(marquee.start.x, marquee.current.x)}
              y={Math.min(marquee.start.y, marquee.current.y)}
              width={Math.abs(marquee.current.x - marquee.start.x)}
              height={Math.abs(marquee.current.y - marquee.start.y)}
              fill="#22d3ee12"
              stroke="#22d3ee"
              strokeDasharray="4 3"
              strokeWidth={1}
            />
          )}
        </svg>

        {sim.shapes.map((shape) => {
          const selected = store.selectedIds.includes(shape.id)
          if (shape.kind === 'line') {
            const length = Math.hypot(shape.w, shape.h)
            const angle = Math.atan2(shape.h, shape.w)
            return (
              <div
                key={shape.id}
                data-shape-id={shape.id}
                className={`absolute cursor-move ${annotationsClickThrough ? 'pointer-events-none' : 'pointer-events-auto'}`}
                style={{ left: shape.x, top: shape.y - 6, width: Math.max(8, length), height: 12, transform: `rotate(${angle}rad)`, transformOrigin: '0 6px' }}
                onPointerDown={(e) => shapeDown(e, shape)}
                onDoubleClick={(e) => { e.stopPropagation(); setEditingShape(shape.id) }}
                onContextMenu={(e) => openShapeContext(e, shape)}
                title="Drag to move · double-click to add text"
              >
                <div className="absolute left-0 top-[5px] w-full rounded" style={{ height: shape.stroke, backgroundColor: shape.color, opacity: 0.75 }} />
                {selected && <div className="absolute inset-0 rounded outline outline-1 outline-cyan-300/80" />}
                {shape.text && (
                  <span className="absolute left-1/2 top-[-14px] -translate-x-1/2 whitespace-nowrap rounded bg-ink-950/85 px-1 text-[9px] font-semibold" style={{ color: shape.color }}>
                    {shape.text}
                  </span>
                )}
              </div>
            )
          }
          return (
            <div
              key={shape.id}
              data-shape-id={shape.id}
              className={`absolute cursor-move ${annotationsClickThrough ? 'pointer-events-none' : 'pointer-events-auto'} ${shape.kind === 'text' ? '' : 'overflow-hidden'}`}
              style={{
                left: shape.x,
                top: shape.y,
                width: shape.kind === 'text' ? 'max-content' : Math.abs(shape.w),
                minWidth: shape.kind === 'text' ? Math.abs(shape.w) : undefined,
                minHeight: shape.kind === 'text' ? 24 : Math.abs(shape.h),
                borderRadius: shape.kind === 'ellipse' ? '50%' : shape.kind === 'text' ? 4 : 10,
                border: shape.kind === 'text' ? '1px solid transparent' : `${shape.stroke}px solid ${shape.color}`,
                backgroundColor: shape.kind === 'text' ? (selected ? 'rgba(34,211,238,0.08)' : 'transparent') : `${shape.color}0d`,
                color: shape.color,
                boxShadow: selected ? '0 0 0 2px rgba(103,232,249,0.55)' : undefined,
                outline: shape.kind === 'text' && selected ? '1px dashed rgba(103,232,249,0.8)' : undefined,
              }}
              onPointerDown={(e) => shapeDown(e, shape)}
              onDoubleClick={(e) => { e.stopPropagation(); setEditingShape(shape.id) }}
              onContextMenu={(e) => openShapeContext(e, shape)}
              title="Drag to move · double-click to edit text"
            >
              <div className={`whitespace-pre-wrap px-2 ${shape.kind === 'text' ? 'py-1 text-[12px] font-semibold' : 'py-1.5 text-[10px] font-semibold'}`}>
                {shape.text || (shape.kind === 'text' ? 'Text' : '')}
              </div>
            </div>
          )
        })}

        <LinkLayer links={sim.links} selectedLinkId={store.selectedLinkId} onSelectLink={(id) => store.selectLink(id)} onLinkContextMenu={linkContext} />

        {sim.shapes.map((shape) => {
          if (!store.selectedIds.includes(shape.id) || shape.kind === 'text' || editingShape === shape.id) return null
          const handles = shape.kind === 'line'
            ? [
                { id: 'line-start', x: shape.x, y: shape.y, cursor: 'crosshair' },
                { id: 'line-end', x: shape.x + shape.w, y: shape.y + shape.h, cursor: 'crosshair' },
              ]
            : [
                { id: 'nw', x: shape.x, y: shape.y, cursor: 'nwse-resize' },
                { id: 'n', x: shape.x + shape.w / 2, y: shape.y, cursor: 'ns-resize' },
                { id: 'ne', x: shape.x + shape.w, y: shape.y, cursor: 'nesw-resize' },
                { id: 'e', x: shape.x + shape.w, y: shape.y + shape.h / 2, cursor: 'ew-resize' },
                { id: 'se', x: shape.x + shape.w, y: shape.y + shape.h, cursor: 'nwse-resize' },
                { id: 's', x: shape.x + shape.w / 2, y: shape.y + shape.h, cursor: 'ns-resize' },
                { id: 'sw', x: shape.x, y: shape.y + shape.h, cursor: 'nesw-resize' },
                { id: 'w', x: shape.x, y: shape.y + shape.h / 2, cursor: 'ew-resize' },
              ]
          return handles.map((h) => (
            <div
              key={`${shape.id}-${h.id}`}
              data-shape-handle={h.id}
              className={`absolute z-40 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-cyan-200 bg-ink-900 shadow ${annotationsClickThrough ? 'pointer-events-none' : 'pointer-events-auto'}`}
              style={{ left: h.x, top: h.y, cursor: h.cursor }}
              onPointerDown={(e) => resizeDown(e, shape, h.id)}
            />
          ))
        })}

        {editingShape && (() => {
          const shape = sim.shapes.find((s) => s.id === editingShape)
          if (!shape) return null
          return (
            <textarea
              key={shape.id}
              autoFocus
              defaultValue={shape.text ?? ''}
              onFocus={(e) => e.target.select()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => commitShapeText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitShapeText((e.target as HTMLTextAreaElement).value)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditingShape(null)
                }
              }}
              className="pointer-events-auto absolute z-40 resize-none rounded border border-cyan-300/60 bg-ink-950/95 px-2 py-1 text-[12px] text-slate-100 shadow-xl outline-none"
              style={{ left: shape.x, top: shape.y, width: Math.max(180, Math.abs(shape.w)), minHeight: 28 }}
            />
          )
        })()}

        {guides.x.map((x) => (
          <div key={`gx-${x}`} className="pointer-events-none absolute inset-y-0 w-px bg-cyan-300/35" style={{ left: x }} />
        ))}
        {guides.y.map((y) => (
          <div key={`gy-${y}`} className="pointer-events-none absolute inset-x-0 h-px bg-cyan-300/35" style={{ top: y }} />
        ))}

        {sim.notes.map((note) => (
          <div
            key={note.id}
            className={`absolute rounded-md border border-amber-200/40 bg-amber-200 text-ink-950 shadow-[0_12px_30px_-10px_rgba(0,0,0,0.7)] ${annotationsClickThrough ? 'pointer-events-none' : 'pointer-events-auto'}`}
            style={{ left: note.x, top: note.y, width: note.w, minHeight: note.h, backgroundColor: note.color, color: '#1c1917' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              if (e.button !== 0 || editingNote === note.id) return
              setNoteDrag({ id: note.id, start: worldPoint(e.clientX, e.clientY), origin: { x: note.x, y: note.y }, moved: false })
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEditingNote(note.id)
            }}
          >
            <div className="flex items-center justify-between border-b border-black/10 px-2 py-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider opacity-60">Note</span>
              <button className="rounded p-0.5 opacity-50 hover:bg-black/10 hover:opacity-100" onClick={() => { sim.notes = sim.notes.filter((n) => n.id !== note.id); sim.bump(); store.saveLocal() }}>
                <Trash2 size={10} />
              </button>
            </div>
            {editingNote === note.id ? (
              <textarea
                autoFocus
                defaultValue={note.text}
                className="h-full min-h-[64px] w-full resize-none bg-transparent px-2 py-1.5 text-[11px] leading-relaxed outline-none"
                onBlur={(e) => {
                  store.updateNote(note.id, { text: e.target.value })
                  setEditingNote(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditingNote(null)
                    store.updateNote(note.id, { text: (e.target as HTMLTextAreaElement).value })
                  }
                  e.stopPropagation()
                }}
              />
            ) : (
              <div className="whitespace-pre-wrap px-2 py-1.5 text-[11px] leading-relaxed">{note.text}</div>
            )}
          </div>
        ))}

        {devices.map((device) => (
          <DeviceNode
            key={device.id}
            device={device}
            selected={store.selectedIds.includes(device.id)}
            onPointerDown={(e) => deviceDown(e, device)}
            onDoubleClick={() => store.setDialog({ type: 'device', deviceId: device.id })}
            onContextMenu={(e) => openContext(e, device)}
          />
        ))}

        {pduFrom && sim.device(pduFrom) && (
          <div
            className="pointer-events-none absolute rounded-xl border-2 border-dashed border-amber-300/80"
            style={{ left: sim.device(pduFrom)!.x - 74, top: sim.device(pduFrom)!.y - 41, width: 148, height: 82 }}
          >
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-amber-300 px-1.5 py-0.5 text-[8px] font-bold uppercase text-ink-950">source</span>
          </div>
        )}
      </div>

      {/* HUD */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-ink-900/80 px-2.5 py-1.5 text-[10px] font-medium text-slate-300 shadow-lg backdrop-blur">
          <Network size={12} className="text-cyan-300" />
          Logical Workspace
          <span className="text-slate-600">/</span>
          <span className="text-slate-500">Root</span>
        </div>
        {store.connectingFrom && (
          <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1.5 text-[10px] text-cyan-200 shadow-lg">
            <Cable size={11} className="mr-1 inline" />
            select the far-end interface · Esc to cancel
          </div>
        )}
        {sim.mode === 'simulation' && (
          <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-[10px] text-amber-200 shadow-lg">
            <Play size={10} className="mr-1 inline" /> batch {sim.batch} · {visibleEvents.length} packet event{visibleEvents.length === 1 ? '' : 's'}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2">
        <div className="rounded-lg border border-white/8 bg-ink-900/80 px-2.5 py-1.5 text-[10px] text-slate-400 shadow-lg backdrop-blur">
          <span className="font-semibold text-slate-200">{devices.length}</span> devices · <span className="font-semibold text-slate-200">{sim.links.length}</span> links
        </div>
        {sim.assessment?.enabled && (
          <button
            className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/15 px-2.5 py-1.5 text-[10px] font-medium text-violet-200 shadow-lg"
            onClick={() => store.runAssessment()}
          >
            <CheckCircle2 size={12} /> Check activity
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border border-white/8 bg-ink-900/80 px-2.5 py-1.5 text-[9px] text-slate-500 shadow-lg backdrop-blur">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> up</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> down</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> STP blocked</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-300" /> activity</span>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-white/8 bg-ink-900/80 px-2.5 py-1.5 text-[9px] text-slate-600 shadow-lg backdrop-blur">
        {store.palette.kind
          ? 'Click to place another · Esc or right-click to finish'
          : store.palette.cable
            ? 'Click a device to connect · Esc or right-click to finish'
            : 'Wheel to zoom · Space / middle-drag to pan · Double-click to configure'}
      </div>

      {devices.length === 0 && !store.palette.kind && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto w-[420px] rounded-2xl border border-white/10 bg-ink-900/90 p-7 text-center shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 shadow-[0_0_40px_-8px_rgba(34,211,238,0.8)]">
              <Network size={24} className="text-ink-950" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100">Build your network</h2>
            <p className="mx-auto mt-2 max-w-[320px] text-[12px] leading-relaxed text-slate-400">
              Drag devices from the palette, wire them together, then configure addresses via the GUI or an IOS-style CLI.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button className="btn btn-primary" onClick={() => store.setDialog({ type: 'welcome' })}>
                <Info size={13} /> Quick start
              </button>
              <button className="btn" onClick={() => store.loadExample()}>
                <Sparkles size={13} /> Load example
              </button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-left">
              {[
                { icon: <MousePointer2 size={13} />, title: 'Place', text: 'Pick a device, click canvas' },
                { icon: <Cable size={13} />, title: 'Connect', text: 'Choose a cable, click ports' },
                { icon: <Play size={13} />, title: 'Simulate', text: 'Add PDUs and press play' },
              ].map((s) => (
                <div key={s.title} className="rounded-lg border border-white/8 bg-ink-950/50 p-2.5">
                  <div className="text-cyan-300">{s.icon}</div>
                  <div className="mt-1 text-[10px] font-semibold text-slate-200">{s.title}</div>
                  <div className="mt-0.5 text-[9px] leading-snug text-slate-500">{s.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {portPicker && (
        <PortPicker
          device={portPicker.device}
          cable={portPicker.cable}
          title={portPicker.stage === 'from' ? 'Select source interface' : 'Select destination interface'}
          onPick={onPickPort}
          onClose={() => setPortPicker(null)}
        />
      )}

      {context && <ContextMenu x={context.x} y={context.y} items={context.items} onClose={() => setContext(null)} />}

      <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/8 bg-ink-950/70 px-3 py-1 text-[9px] text-slate-600 backdrop-blur lg:flex">
        <Grid3x3 size={10} /> {store.settings.snapToGrid ? 'snap on' : 'snap off'}
      </div>
    </div>
  )
}
