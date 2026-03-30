import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

/**
 * Older deploys used `/seven-stud/` as the Vite `base` while the site is hosted at
 * `/cardroom-engine/`, so precached `index.html` could reference missing JS/CSS.
 * Unregister those service workers once so the page can load current assets.
 */
async function unregisterLegacyServiceWorkers(): Promise<boolean> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return false
  const regs = await navigator.serviceWorker.getRegistrations()
  const stale = regs.filter((r) => {
    const url =
      r.active?.scriptURL ?? r.waiting?.scriptURL ?? r.installing?.scriptURL ?? ''
    return url.includes('/seven-stud/sw.js')
  })
  if (stale.length === 0) return false
  await Promise.all(stale.map((r) => r.unregister()))
  return true
}

void unregisterLegacyServiceWorkers()
  .catch(() => false)
  .then((didUnregister) => {
    if (didUnregister) {
      window.location.reload()
      return
    }
    registerSW({ immediate: true })
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
