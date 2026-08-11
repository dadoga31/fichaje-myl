import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Check, RefreshCw } from 'lucide-react'
import { Button } from './ui'

/**
 * Aviso de nueva versión. La actualización nunca se fuerza a mitad de sesión:
 * recargar mientras alguien está fichando sería el peor momento posible, así
 * que se ofrece y la persona decide.
 *
 * El aviso de "ya funciona sin conexión" es informativo y se retira solo: no
 * merece robar espacio permanente en la pantalla de fichaje.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    if (!offlineReady) return
    const id = window.setTimeout(() => setOfflineReady(false), 5000)
    return () => window.clearTimeout(id)
  }, [offlineReady, setOfflineReady])

  if (!needRefresh && !offlineReady) return null

  return (
    <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6">
      <div className="flex items-center justify-between gap-3 rounded-[4px] border border-brand-200 bg-brand-50 py-1.5 pr-1.5 pl-3">
        <p className="flex items-center gap-2 text-[12px] text-brand-900">
          {needRefresh ? <RefreshCw size={13} /> : <Check size={13} />}
          {needRefresh
            ? 'Hay una versión nueva disponible.'
            : 'La aplicación ya funciona sin conexión.'}
        </p>
        <div className="flex shrink-0 gap-1">
          {needRefresh && (
            <Button size="sm" variant="primary" onClick={() => void updateServiceWorker(true)}>
              Actualizar
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setNeedRefresh(false)
              setOfflineReady(false)
            }}
          >
            {needRefresh ? 'Ahora no' : 'Vale'}
          </Button>
        </div>
      </div>
    </div>
  )
}
