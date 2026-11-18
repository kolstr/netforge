import { useState } from 'react'
import { Activity, Send } from 'lucide-react'
import type { Device, UserPdu } from '../../types'
import { useApp } from '../../store'
import { Field, Toggle } from '../common/Modal'
import { randomPduColor } from '../../sim/engine'

export function TrafficApp({ device }: { device: Device }) {
  const store = useApp()
  const sim = store.sim
  const [destIp, setDestIp] = useState('')
  const [type, setType] = useState<UserPdu['type']>('ping')
  const [srcPort, setSrcPort] = useState(1024)
  const [dstPort, setDstPort] = useState(80)
  const [ttl, setTtl] = useState(64)
  const [tos, setTos] = useState(0)
  const [size, setSize] = useState(74)
  const [periodic, setPeriodic] = useState(false)
  const [interval, setInterval] = useState(5)
  const [status, setStatus] = useState('')

  const send = () => {
    if (!destIp) {
      setStatus('Enter a destination IP address')
      return
    }
    const pdu = sim.createComplexPdu({
      sourceId: device.id,
      destIp,
      type,
      srcPort: type === 'ping' ? undefined : srcPort,
      dstPort: type === 'ping' ? undefined : dstPort,
      ttl,
      tos,
      size,
      color: randomPduColor(),
      time: 0,
      periodic,
      interval: periodic ? interval : undefined,
    })
    sim.firePdu(pdu.id)
    store.bump()
    store.saveLocal()
    setStatus(`PDU fired — check the Event List in Simulation Mode`)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="rounded-xl border border-white/10 bg-ink-900 p-4">
        <div className="flex items-center gap-2">
          <Activity size={17} className="text-cyan-300" />
          <div>
            <div className="text-sm font-semibold text-slate-100">Traffic Generator</div>
            <div className="text-[10px] text-slate-500">Send custom one-shot or periodic PDUs from {device.name}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Destination IP"><input className="input font-mono" value={destIp} onChange={(e) => setDestIp(e.target.value)} placeholder="10.10.10.10" /></Field>
          <Field label="Application / protocol">
            <select className="input" value={type} onChange={(e) => setType(e.target.value as UserPdu['type'])}>
              <option value="ping">Ping (ICMP)</option>
              <option value="udp">UDP</option>
              <option value="dns">DNS</option>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="ftp">FTP</option>
              <option value="smtp">SMTP</option>
              <option value="pop3">POP3</option>
              <option value="telnet">Telnet</option>
              <option value="ssh">SSH</option>
            </select>
          </Field>
          <Field label="Source port"><input type="number" className="input" value={srcPort} onChange={(e) => setSrcPort(Number(e.target.value))} disabled={type === 'ping'} /></Field>
          <Field label="Destination port"><input type="number" className="input" value={dstPort} onChange={(e) => setDstPort(Number(e.target.value))} disabled={type === 'ping'} /></Field>
          <Field label="TTL"><input type="number" className="input" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} /></Field>
          <Field label="TOS / DSCP"><input type="number" className="input" value={tos} onChange={(e) => setTos(Number(e.target.value))} /></Field>
          <Field label="Size (bytes)"><input type="number" className="input" value={size} onChange={(e) => setSize(Number(e.target.value))} /></Field>
          <div className="flex items-end pb-1"><Toggle checked={periodic} onChange={setPeriodic} label="Periodic" /></div>
          {periodic && <Field label="Interval (s)"><input type="number" className="input" value={interval} onChange={(e) => setInterval(Number(e.target.value))} /></Field>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className="btn btn-primary" onClick={send}><Send size={12} /> Send PDU</button>
          {status && <span className="text-[10px] text-cyan-300">{status}</span>}
        </div>
      </div>
      <div className="rounded-xl border border-white/8 bg-ink-950/50 p-3 text-[10px] leading-relaxed text-slate-500">
        The PDU is added to the current simulation scenario. In Simulation Mode it will travel the network one hop at a time; in Realtime it is delivered immediately.
      </div>
    </div>
  )
}
