import { useState } from 'react'
import { ArrowUpRight, Send } from 'lucide-react'
import type { UserPdu } from '../../types'
import { useApp } from '../../store'
import { Field, Modal, Toggle } from '../common/Modal'
import { randomPduColor } from '../../sim/engine'
import { formatIpWithMask } from '../../lib/ip'

const TYPES: { id: UserPdu['type']; label: string; port?: number }[] = [
  { id: 'ping', label: 'Ping (ICMP)' },
  { id: 'dns', label: 'DNS', port: 53 },
  { id: 'ftp', label: 'FTP', port: 21 },
  { id: 'http', label: 'HTTP', port: 80 },
  { id: 'https', label: 'HTTPS', port: 443 },
  { id: 'imap', label: 'IMAP', port: 143 },
  { id: 'pop3', label: 'POP3', port: 110 },
  { id: 'smtp', label: 'SMTP', port: 25 },
  { id: 'ssh', label: 'SSH', port: 22 },
  { id: 'telnet', label: 'Telnet', port: 23 },
  { id: 'tftp', label: 'TFTP', port: 69 },
  { id: 'udp', label: 'Other UDP', port: 53 },
]

export function ComplexPduDialog() {
  const store = useApp()
  const sim = store.sim
  const dialog = store.dialog
  const devices = sim.listDevices().filter((d) => sim.l3Endpoints(d).length)
  const defaultSource = dialog?.type === 'complex-pdu' && dialog.sourceId ? dialog.sourceId : devices[0]?.id ?? ''
  const [sourceId, setSourceId] = useState(defaultSource)
  const [destMode, setDestMode] = useState<'ip' | 'device'>('ip')
  const [destDevice, setDestDevice] = useState(devices.find((d) => d.id !== defaultSource)?.id ?? '')
  const [destIp, setDestIp] = useState('')
  const [type, setType] = useState<UserPdu['type']>('ping')
  const [srcPort, setSrcPort] = useState(1024)
  const [dstPort, setDstPort] = useState(80)
  const [ttl, setTtl] = useState(64)
  const [tos, setTos] = useState(0)
  const [size, setSize] = useState(74)
  const [time, setTime] = useState(0)
  const [periodic, setPeriodic] = useState(false)
  const [interval, setInterval] = useState(5)
  const [color, setColor] = useState(randomPduColor())

  const chooseType = (t: UserPdu['type']) => {
    setType(t)
    const meta = TYPES.find((x) => x.id === t)
    if (meta?.port) setDstPort(meta.port)
    setSize(t === 'ping' ? 74 : 128)
  }

  const create = () => {
    const target = destMode === 'device' ? sim.l3Endpoints(sim.device(destDevice)!)[0] : undefined
    const ip = destMode === 'device' ? target?.ip : destIp
    if (!sourceId || !ip) return
    store.addComplexPdu({
      sourceId,
      destId: destMode === 'device' ? destDevice : undefined,
      destIp: ip,
      type,
      srcPort: type === 'ping' ? undefined : srcPort,
      dstPort: type === 'ping' ? undefined : dstPort,
      ttl,
      tos,
      size,
      color,
      time,
      periodic,
      interval: periodic ? interval : undefined,
      lastRun: undefined,
    })
  }

  return (
    <Modal onClose={() => store.setDialog(null)} title="Create Complex PDU" subtitle="Choose source, destination and protocol parameters" icon={<ArrowUpRight size={16} className="text-cyan-300" />} width="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Source device">
            <select className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {!devices.length && <option value="">No configured devices</option>}
              {devices.map((d) => {
                const iface = d.interfaces.find((i) => i.ip)
                return <option key={d.id} value={d.id}>{d.name} ({formatIpWithMask(iface?.ip, iface?.mask) ?? 'no IP'})</option>
              })}
            </select>
          </Field>
          <Field label="Destination mode">
            <select className="input" value={destMode} onChange={(e) => setDestMode(e.target.value as 'ip' | 'device')}>
              <option value="ip">IP address</option>
              <option value="device">Device</option>
            </select>
          </Field>
          {destMode === 'ip' ? (
            <Field label="Destination IP"><input className="input font-mono" value={destIp} onChange={(e) => setDestIp(e.target.value)} placeholder="10.10.10.10" /></Field>
          ) : (
            <Field label="Destination device">
              <select className="input" value={destDevice} onChange={(e) => setDestDevice(e.target.value)}>
                {devices.filter((d) => d.id !== sourceId).map((d) => {
                  const ep = sim.l3Endpoints(d)[0]
                  return <option key={d.id} value={d.id}>{d.name} ({formatIpWithMask(ep?.ip, ep?.mask) ?? 'no IP'})</option>
                })}
              </select>
            </Field>
          )}
          <Field label="Application / protocol">
            <select className="input" value={type} onChange={(e) => chooseType(e.target.value as UserPdu['type'])}>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Source port"><input type="number" className="input" value={srcPort} onChange={(e) => setSrcPort(Number(e.target.value))} disabled={type === 'ping'} /></Field>
          <Field label="Destination port"><input type="number" className="input" value={dstPort} onChange={(e) => setDstPort(Number(e.target.value))} disabled={type === 'ping'} /></Field>
          <Field label="TTL"><input type="number" className="input" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} /></Field>
          <Field label="TOS / DSCP"><input type="number" className="input" value={tos} onChange={(e) => setTos(Number(e.target.value))} /></Field>
          <Field label="Size (bytes)"><input type="number" className="input" value={size} onChange={(e) => setSize(Number(e.target.value))} /></Field>
          <Field label="Send at (seconds)"><input type="number" className="input" value={time} onChange={(e) => setTime(Number(e.target.value))} /></Field>
        </div>
        <div className="flex items-center gap-3">
          <Toggle checked={periodic} onChange={setPeriodic} label="Periodic" />
          {periodic && <Field label="Interval (s)"><input type="number" className="input w-24" value={interval} onChange={(e) => setInterval(Number(e.target.value))} /></Field>}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">Color</span>
            {['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#fb7185'].map((c) => (
              <button key={c} className={`h-4 w-4 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-white/8 pt-3">
          <button className="btn btn-primary" onClick={create} disabled={!sourceId || (destMode === 'ip' ? !destIp : !destDevice)}><Send size={12} /> Create PDU</button>
          <button className="btn" onClick={() => store.setDialog(null)}>Cancel</button>
          <span className="ml-auto text-[11px] text-slate-600">The PDU is added to {sim.activeScenario().name}. Press Play in Simulation Mode to send it.</span>
        </div>
      </div>
    </Modal>
  )
}
