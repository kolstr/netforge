import { useState } from 'react'
import { ArrowDown, ArrowUp, Layers } from 'lucide-react'
import { useApp } from '../../store'
import { Modal, Tabs } from '../common/Modal'
import type { PacketRecord } from '../../types'

export function PduInfoDialog() {
  const store = useApp()
  const dialog = store.dialog
  const event = dialog?.type === 'pdu-info' ? store.sim.log.find((e) => e.id === dialog.eventId) : undefined
  const [tab, setTab] = useState<'osi' | 'inbound' | 'outbound'>('osi')
  if (!event) return null
  const sim = store.sim
  const at = sim.device(event.atDeviceId)
  const last = event.lastDeviceId ? sim.device(event.lastDeviceId) : undefined
  const p = event.pdu
  const payload = p.payload ?? ''
  const layers = buildLayers(p, payload)

  return (
    <Modal onClose={() => store.setDialog(null)} title={`${event.type} PDU`} subtitle={`${last ? `${last.name} → ` : ''}${at?.name ?? '—'} · t = ${event.time.toFixed(4)}s`} icon={<Layers size={16} className="text-cyan-300" />} width="max-w-4xl">
      <Tabs
        tabs={[
          { id: 'osi', label: 'OSI Model', icon: <Layers size={11} /> },
          { id: 'inbound', label: 'Inbound PDU Details', icon: <ArrowDown size={11} /> },
          { id: 'outbound', label: 'Outbound PDU Details', icon: <ArrowUp size={11} /> },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="pt-3">
        {tab === 'osi' && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300"><ArrowDown size={11} /> In Layers (bottom → top)</div>
              <div className="space-y-1">
                {[...layers].reverse().map((l) => (
                  <div key={`in-${l.layer}`} className="rounded-lg border border-white/8 bg-ink-900/50 p-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-cyan-400/10 font-mono text-[10px] text-cyan-200">L{l.layer}</span>
                      <span className="text-[10px] font-medium text-slate-200">{l.name}</span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] leading-relaxed text-slate-400">{l.inbound}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300"><ArrowUp size={11} /> Out Layers (top → bottom)</div>
              <div className="space-y-1">
                {layers.map((l) => (
                  <div key={`out-${l.layer}`} className="rounded-lg border border-white/8 bg-ink-900/50 p-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-400/10 font-mono text-[10px] text-emerald-200">L{l.layer}</span>
                      <span className="text-[10px] font-medium text-slate-200">{l.name}</span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] leading-relaxed text-slate-400">{l.outbound}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === 'inbound' && (
          <HeaderDetails title={last ? `Received from ${last.name}` : 'Originated at this device'} p={p} />
        )}
        {tab === 'outbound' && <HeaderDetails title={`Forwarded by ${at?.name ?? 'device'}`} p={p} />}
        <div className="mt-3 rounded-lg border border-white/8 bg-ink-950/40 p-2.5 font-mono text-[10px] text-slate-500">
          <span className="text-slate-600">Event info:</span> {event.info}
          <span className="ml-3 text-slate-600">Size:</span> {p.size} bytes
          {p.vlan ? <><span className="ml-3 text-slate-600">VLAN:</span> {p.vlan}</> : null}
        </div>
      </div>
    </Modal>
  )
}

function HeaderDetails({ title, p }: { title: string; p: PacketRecord }) {
  const rows: [string, string][] = [
    ['Ethernet II · Destination', String(p.dstMac ?? '')],
    ['Ethernet II · Source', String(p.srcMac ?? '')],
    ['Ethernet II · Type', p.vlan ? '0x8100 (802.1Q)' : '0x0800 (IPv4)'],
  ]
  if (p.srcIp || p.dstIp) {
    rows.push(['IPv4 · Source', String(p.srcIp ?? '')], ['IPv4 · Destination', String(p.dstIp ?? '')], ['IPv4 · TTL', String(p.ttl ?? '')], ['IPv4 · Protocol', String(p.type ?? '')])
  }
  if (p.srcPort) rows.push(['TCP/UDP · Source port', String(p.srcPort)])
  if (p.dstPort) rows.push(['TCP/UDP · Destination port', String(p.dstPort)])
  if (p.flags) rows.push(['TCP · Flags', String(p.flags)])
  if (p.seq !== undefined) rows.push(['TCP · Sequence', String(p.seq)])
  if (p.ack !== undefined) rows.push(['TCP · Acknowledgment', String(p.ack)])
  if (p.payload) rows.push(['Application · Payload', String(p.payload).slice(0, 120)])
  return (
    <div className="rounded-xl border border-white/8 bg-ink-950/40">
      <div className="border-b border-white/8 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</div>
      <table className="w-full text-[10px]">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className="border-t border-white/5">
              <td className="w-1/2 px-3 py-1.5 text-slate-500">{k}</td>
              <td className="px-3 py-1.5 font-mono text-slate-300">{v}</td>
            </tr>
          ))}
          {!rows.length && <tr><td className="px-3 py-4 text-center text-slate-600">No header fields available.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function buildLayers(p: PacketRecord, payload: string) {
  const type = String(p.type ?? '')
  return [
    { layer: 7, name: 'Application', inbound: `${type} message received · payload ${payload ? `"${String(payload).slice(0, 60)}"` : 'none'}`, outbound: `${type} application data presented for encapsulation` },
    { layer: 6, name: 'Presentation', inbound: 'Decode application encoding', outbound: 'Encode application payload' },
    { layer: 5, name: 'Session', inbound: p.srcPort ? `Session keyed by port ${p.srcPort} → ${p.dstPort}` : 'No session layer state', outbound: 'Open/continue application session' },
    { layer: 4, name: 'Transport', inbound: p.flags ? `TCP segment flags=${String(p.flags)} sport=${p.srcPort} dport=${p.dstPort}` : p.type === 'ICMP' ? 'ICMP message delivered to IP' : 'UDP datagram demultiplexed', outbound: p.flags ? `TCP segment sport=${p.srcPort} dport=${p.dstPort}` : 'Transport header attached' },
    { layer: 3, name: 'Network', inbound: `IPv4 packet from ${p.srcIp ?? '—'} to ${p.dstIp ?? '—'} · TTL ${p.ttl ?? '—'}`, outbound: `Route lookup for ${p.dstIp ?? '—'} · decrement TTL, new L2 header` },
    { layer: 2, name: 'Data Link', inbound: `Ethernet frame ${p.srcMac ?? '—'} → ${p.dstMac ?? '—'}${p.vlan ? ` (VLAN ${p.vlan})` : ''}`, outbound: 'Frame rebuilt with next-hop MAC address' },
    { layer: 1, name: 'Physical', inbound: `Signal received · ${p.size ?? 0} bytes`, outbound: 'Bits transmitted on the egress medium' },
  ]
}
