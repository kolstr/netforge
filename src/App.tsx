import { useEffect } from 'react'
import { MenuBar } from './ui/MenuBar'
import { TopToolbar } from './ui/TopToolbar'
import { Palette } from './ui/Palette'
import { Workspace } from './ui/workspace/Workspace'
import { Inspector } from './ui/Inspector'
import { SimulationPanel } from './ui/SimulationPanel'
import { StatusBar } from './ui/StatusBar'
import { DeviceDialog } from './ui/modals/DeviceDialog'
import { PreferencesDialog } from './ui/modals/PreferencesDialog'
import { AboutDialog, WelcomeDialog } from './ui/modals/WelcomeDialog'
import { ComplexPduDialog } from './ui/modals/ComplexPduDialog'
import { PduInfoDialog } from './ui/modals/PduInfoDialog'
import { ActivityWizard, AssessmentDialog } from './ui/modals/ActivityWizard'
import { useApp } from './store'

export default function App() {
  const dialog = useApp((s) => s.dialog)
  const setDialog = useApp((s) => s.setDialog)

  useEffect(() => {
    const seen = localStorage.getItem('netforge.seen')
    if (!seen && !useApp.getState().sim.listDevices().length) {
      setDialog({ type: 'welcome' })
    }
  }, [setDialog])

  useEffect(() => {
    if (dialog?.type === 'welcome') localStorage.setItem('netforge.seen', '1')
  }, [dialog])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable
      const s = useApp.getState()
      if (e.key === 'Escape') {
        s.clearPalette()
        if (s.dialog && s.dialog.type !== 'device') s.setDialog(null)
        return
      }
      if (typing) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        s.deleteSelection()
        return
      }
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') {
          e.preventDefault()
          if (e.shiftKey) s.redo()
          else s.undo()
        } else if (k === 'y') {
          e.preventDefault()
          s.redo()
        } else if (k === 's') {
          e.preventDefault()
          s.saveLocal()
          s.setStatus('Workspace saved locally')
        } else if (k === 'a') {
          e.preventDefault()
          s.select(s.sim.listDevices().map((d) => d.id))
        } else if (k === 'd') {
          e.preventDefault()
          s.duplicateSelection()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-950">
      <MenuBar />
      <TopToolbar />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <main className="flex min-w-0 flex-1 flex-col">
          <Workspace />
        </main>
        <Inspector />
      </div>
      <SimulationPanel />
      <StatusBar />

      {dialog?.type === 'device' && <DeviceDialog />}
      {dialog?.type === 'preferences' && <PreferencesDialog />}
      {dialog?.type === 'welcome' && <WelcomeDialog />}
      {dialog?.type === 'about' && <AboutDialog />}
      {dialog?.type === 'complex-pdu' && <ComplexPduDialog />}
      {dialog?.type === 'pdu-info' && <PduInfoDialog />}
      {dialog?.type === 'activity' && <ActivityWizard />}
      {dialog?.type === 'assessment' && <AssessmentDialog result={dialog.result} />}
    </div>
  )
}
