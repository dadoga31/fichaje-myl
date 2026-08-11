import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw } from 'lucide-react'
import { Button } from './ui'

/**
 * Aviso de nueva versión. La actualización nunca se fuerza a mitad de sesión:
 * recargar mientras alguien está fichando sería el peor momento posible, así
 * que se ofrece y la persona decide.
 *
 * No se avisa de "ya funciona sin conexión": no es accionable y robaba una
 * franja de la pantalla de fichaje, que es exactamente donde no sobra sitio.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="mx-auto w-full max-w-7xl shrink-0 px-4 pt-3 sm:px-6">
      <div className="flex items-center justify-between gap-3 rounded-[4px] border border-brand-200 bg-brand-50 py-1.5 pr-1.5 pl-3">
        <p className="flex items-center gap-2 text-[12px] text-brand-900">
          <RefreshCw size={13} className="shrink-0" />
          Hay una versión nueva disponible.
        </p>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="primary" onClick={() => void updateServiceWorker(true)}>
            Actualizar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
            Ahora no
          </Button>
        </div>
      </div>
    </div>
  )
}
