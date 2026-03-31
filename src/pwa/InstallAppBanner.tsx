import { useCallback, useEffect, useState } from 'react'

const DISMISS_KEY = 'cardroom-engine-install-banner-dismissed'

function isStandaloneDisplay(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** Chrome / Edge install prompt event (not in all TS lib versions). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallAppBanner({ visible }: { visible: boolean }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === '1',
  )
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    if (isStandaloneDisplay()) return
    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = useCallback(() => {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }, [])

  const runPrompt = useCallback(async () => {
    if (!deferred) return
    await deferred.prompt()
    try {
      await deferred.userChoice
    } catch {
      /* ignore */
    }
    setDeferred(null)
  }, [deferred])

  if (!visible || installed || dismissed || isStandaloneDisplay()) return null

  if (deferred) {
    return (
      <div className="install-app-banner" role="region" aria-label="Install app">
        <p className="install-app-banner__text">
          Install Seven Stud for quick access and offline play after your first visit.
        </p>
        <div className="install-app-banner__actions">
          <button type="button" className="btn accent" onClick={runPrompt}>
            Install app
          </button>
          <button type="button" className="btn tiny ghost" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    )
  }

  if (isIos()) {
    return (
      <div
        className="install-app-banner install-app-banner--hint"
        role="region"
        aria-label="Add to Home Screen tip"
      >
        <p className="install-app-banner__text">
          Tip: tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to install.
        </p>
        <button type="button" className="btn tiny ghost" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    )
  }

  return null
}
