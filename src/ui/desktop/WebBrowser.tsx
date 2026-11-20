import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, Home, Lock, RefreshCw, Search, X } from 'lucide-react'
import type { Device } from '../../types'
import { useApp } from '../../store'
import type { AppResult } from '../../sim/engine'
import { HomeRouterAdmin } from './HomeRouterAdmin'
import { formatIpWithMask } from '../../lib/ip'

type Result = (AppResult & { targetIp?: string; host?: string; path?: string; resolvedFrom?: string; url?: string }) | null

export function WebBrowser({ device }: { device: Device }) {
  const sim = useApp((s) => s.sim)
  const [url, setUrl] = useState('')
  const [current, setCurrent] = useState('')
  const [result, setResult] = useState<Result>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const resolvedDevice = result?.data && (result.data as { homeRouter?: boolean; deviceId?: string }).homeRouter ? sim.device((result.data as { deviceId: string }).deviceId) : undefined
  const servers = sim.listDevices().filter((d) => d.kind === 'server' && d.interfaces.some((i) => i.ip))

  const navigate = async (raw: string, fromHistory = false) => {
    let target = raw.trim()
    if (!target) return
    if (!/^https?:\/\//i.test(target)) target = `http://${target}`
    setUrl(target)
    setCurrent(target)
    setLoading(true)
    setResult(null)
    if (!fromHistory) {
      const next = history.slice(0, histIdx + 1)
      next.push(target)
      setHistory(next)
      setHistIdx(next.length - 1)
    }
    try {
      const res = await sim.webRequest(device.id, target)
      setResult({ ...res, url: target })
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'Request failed' })
    } finally {
      setLoading(false)
    }
  }

  const attachLinks = () => {
    if (!result?.ok || !result.body || result.data) return
    try {
      const doc = iframeRef.current?.contentDocument
      doc?.querySelectorAll('a[href]').forEach((a) => {
        a.addEventListener('click', (e) => {
          e.preventDefault()
          const href = (a as HTMLAnchorElement).getAttribute('href') ?? ''
          if (!href) return
          if (href.startsWith('http')) void navigate(href)
          else {
            const u = new URL(result.url ?? current)
            u.pathname = href.startsWith('/') ? href : `${u.pathname.replace(/[^/]*$/, '')}${href}`
            void navigate(u.toString())
          }
        })
      })
    } catch {
      /* sandboxed */
    }
  }

  const goBack = () => {
    if (histIdx <= 0) return
    const idx = histIdx - 1
    setHistIdx(idx)
    void navigate(history[idx], true)
  }
  const goForward = () => {
    if (histIdx >= history.length - 1) return
    const idx = histIdx + 1
    setHistIdx(idx)
    void navigate(history[idx], true)
  }

  return (
    <div className="nf-palette-default flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#f8fafc]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-300 bg-slate-200 px-2 py-1.5">
        <button className="rounded p-1 text-slate-600 hover:bg-slate-300 disabled:opacity-30" onClick={goBack} disabled={histIdx <= 0}><ArrowLeft size={14} /></button>
        <button className="rounded p-1 text-slate-600 hover:bg-slate-300 disabled:opacity-30" onClick={goForward} disabled={histIdx >= history.length - 1}><ArrowRight size={14} /></button>
        <button className="rounded p-1 text-slate-600 hover:bg-slate-300" onClick={() => current && void navigate(current, true)}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
        <button className="rounded p-1 text-slate-600 hover:bg-slate-300" onClick={() => { setResult(null); setUrl(''); setCurrent('') }}><Home size={13} /></button>
        <div className="flex flex-1 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2 py-1">
          {current.startsWith('https://') ? <Lock size={11} className="text-emerald-600" /> : <Globe size={11} className="text-slate-400" />}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void navigate(url) }}
            placeholder="Enter URL, IP address or hostname"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-800 outline-none placeholder:text-slate-400"
            spellCheck={false}
          />
          {url && <button className="text-slate-400 hover:text-slate-600" onClick={() => setUrl('')}><X size={11} /></button>}
        </div>
        <button className="rounded bg-cyan-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-cyan-700" onClick={() => void navigate(url)}>Go</button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto bg-white">
        {!current && !result && (
          <div className="flex h-full flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-200 p-8">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 text-white shadow-lg">
              <Globe size={28} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">NetForge Browser</h2>
            <p className="mt-1 text-[11px] text-slate-500">Visit a server by IP address or DNS name.</p>
            <div className="mt-5 grid w-full max-w-md gap-2">
              <button className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-[11px] text-slate-700 hover:border-cyan-400" onClick={() => void navigate('www.netforge.lab')}>
                <Search size={13} className="text-cyan-600" /> <span className="font-medium">www.netforge.lab</span> <span className="ml-auto text-[10px] text-slate-400">requires DNS</span>
              </button>
              {servers.map((s) => {
                const iface = s.interfaces.find((i) => i.ip)
                const ip = iface?.ip
                return (
                  <button key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-[11px] text-slate-700 hover:border-cyan-400" onClick={() => void navigate(ip!)}>
                    <Globe size={13} className="text-slate-500" /> <span className="font-mono">{formatIpWithMask(ip, iface?.mask)}</span> <span className="ml-auto text-[10px] text-slate-400">{s.name}</span>
                  </button>
                )
              })}
              <button className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-[11px] text-slate-700 hover:border-cyan-400" onClick={() => void navigate('192.168.0.1')}>
                <Lock size={13} className="text-amber-500" /> <span className="font-mono">192.168.0.1</span> <span className="ml-auto text-[10px] text-slate-400">home router</span>
              </button>
            </div>
          </div>
        )}
        {loading && (
          <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
            <RefreshCw size={14} className="mr-2 animate-spin" /> Resolving {result?.host ?? url} and loading…
          </div>
        )}
        {!loading && result && !result.ok && (
          <div className="p-10">
            <h2 className="text-lg font-semibold text-slate-800">This site can’t be reached</h2>
            <p className="mt-2 text-[12px] text-slate-500">{result.error ?? 'The connection failed.'}</p>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[10px] text-slate-500">
              {current}
              {result.targetIp ? `\nresolved to ${result.targetIp}` : ''}
            </div>
          </div>
        )}
        {!loading && result?.ok && resolvedDevice && <div className="p-5"><HomeRouterAdmin device={resolvedDevice} /></div>}
        {!loading && result?.ok && !resolvedDevice && result.body && (
          <iframe
            key={result.url}
            ref={iframeRef}
            title="Simulated web content"
            sandbox="allow-same-origin"
            srcDoc={result.body}
            onLoad={attachLinks}
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-slate-300 bg-slate-100 px-2 py-1 text-[10px] text-slate-500">
        {result?.ok ? <span>HTTP {result.status ?? 200} · {result.targetIp ?? ''} · {result.resolvedFrom ?? 'direct'}</span> : <span>Ready</span>}
        <span className="ml-auto">{device.name}</span>
      </div>
    </div>
  )
}
