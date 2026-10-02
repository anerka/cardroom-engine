const UPDATE_INTERVAL_MS = 60_000

let watching = false

/**
 * Installed phone apps keep the last service worker until something asks
 * for an update. Check on launch, when the app is opened again, and while
 * it stays in the foreground so a GitHub Pages deploy replaces the installed copy.
 */
export function watchForAppUpdates(
  swUrl: string,
  registration: ServiceWorkerRegistration | undefined,
): void {
  if (watching || !registration) return
  watching = true

  const hadController = Boolean(navigator.serviceWorker.controller)
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    if (!installing) return
    installing.addEventListener('statechange', () => {
      if (installing.state === 'activated' && hadController) {
        window.location.reload()
      }
    })
  })

  const check = () => {
    if (registration.installing || !navigator.onLine) return
    void fetch(swUrl, {
      cache: 'no-store',
      headers: {
        cache: 'no-store',
        'cache-control': 'no-cache',
      },
    })
      .then((resp) => {
        if (resp.ok) return registration.update()
      })
      .catch(() => {
        /* Offline, or Pages is briefly unreachable. Try again on the next open. */
      })
  }

  check()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.addEventListener('pageshow', check)
  window.setInterval(() => {
    if (document.visibilityState === 'visible') check()
  }, UPDATE_INTERVAL_MS)
}
