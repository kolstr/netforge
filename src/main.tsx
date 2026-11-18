import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { fitWorkspace, layoutItems } from './lib/fitView'
import { useApp } from './store'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Fit the restored workspace to the viewport once the layout has settled.
setTimeout(() => {
  if (useApp.getState().sim.listDevices().length) fitWorkspace((v) => useApp.setState({ view: v }), layoutItems(useApp.getState().sim))
}, 400)
