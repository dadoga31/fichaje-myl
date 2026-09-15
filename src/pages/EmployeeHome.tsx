import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { useAmbient } from '../context/AmbientContext'
import { PunchPanel } from '../components/PunchPanel'
import { Button, Spinner } from '../components/ui'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useGeolocation } from '../hooks/useGeolocation'
import { getEntries, punch, subscribeToChanges } from '../lib/api'
import { enqueuePunch, flushQueue, subscribeQueue } from '../lib/offlineQueue'
import type { EntryType, QueuedPunch, TimeEntry } from '../lib/types'
import { deriveStatus, toISODate } from '../lib/time'

/**
 * Pantalla de fichaje: una sola pantalla, una sola tarea.
 *
 * Solo carga los fichajes de HOY. El resumen semanal, el calendario y las
 * solicitudes de corrección viven en sus propias secciones: aquí estorbarían
 * y obligarían a desplazarse justo cuando hay prisa.
 */
export function EmployeeHome() {
  const { session } = useSession()
  const online = useOnlineStatus()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [queued, setQueued] = useState<QueuedPunch[]>([])
  const [loading, setLoading] = useState(true)
  // Si la carga falla, hay que DECIRLO. Antes la promesa se rompía en
  // silencio, setLoading(false) no llegaba a ejecutarse y la pantalla se
  // quedaba girando indefinidamente: el peor fallo posible aquí, porque
  // quien tiene que fichar no sabe si debe esperar o si algo va mal.
  const [fallo, setFallo] = useState<string | null>(null)

  const profile = session!.profile
  const company = session!.company
  const geo = useGeolocation(company, profile)

  const today = useMemo(() => toISODate(new Date()), [])

  const load = useCallback(async () => {
    try {
      setEntries(await getEntries(profile.id, today, today))
      setFallo(null)
    } catch (error) {
      setFallo(error instanceof Error ? error.message : 'No se ha podido cargar su jornada.')
    } finally {
      setLoading(false)
    }
  }, [profile.id, today])

  useEffect(() => {
    void load()
    // Si se ficha desde otro dispositivo (o administración rectifica un
    // fichaje), esta pantalla se entera al momento en vez de quedarse
    // mostrando un estado que ya no es cierto.
    return subscribeToChanges(['time_entries'], () => void load())
  }, [load])

  useEffect(() => subscribeQueue(setQueued), [])

  // La luz del fondo de toda la aplicación sigue al estado de la jornada.
  const { setStatus } = useAmbient()
  useEffect(() => {
    setStatus(deriveStatus(entries.length > 0 ? entries[entries.length - 1] : null))
  }, [entries, setStatus])

  // Al recuperar la conexión se vacía la cola y se refresca el estado real.
  useEffect(() => {
    if (!online || queued.length === 0) return
    void (async () => {
      const result = await flushQueue(profile.id)
      if (result.sent > 0) await load()
    })()
  }, [online, queued.length, profile.id, load])

  const handlePunch = useCallback(
    async (type: EntryType): Promise<string | null> => {
      try {
        const geoPoint = await geo.capture()
        try {
          await punch(profile.id, type, geoPoint)
          await load()
          return null
        } catch (error) {
          // Fallo de red: no se pierde el fichaje, se encola con su hora real.
          const message = error instanceof Error ? error.message : String(error)
          const isNetwork =
            !navigator.onLine ||
            /failed to fetch|networkerror|sin conexión|timeout/i.test(message)

          if (isNetwork) {
            await enqueuePunch(type, geoPoint)
            return null
          }
          return message
        }
      } catch (error) {
        return error instanceof Error ? error.message : 'No se ha podido fichar.'
      }
    },
    [geo, profile.id, load],
  )

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
        <Spinner /> Cargando su jornada…
      </div>
    )
  }

  if (fallo) {
    return (
      <div className="flex h-full items-center justify-center px-5">
        <div className="surface w-full max-w-sm rounded-[12px] px-5 py-5 text-center">
          <AlertTriangle size={20} className="mx-auto text-amber-600" />
          <p className="mt-2.5 text-[14px] font-semibold text-ink">
            No se ha podido cargar su jornada
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{fallo}</p>
          <Button
            className="mt-4 w-full"
            variant="primary"
            onClick={() => {
              setLoading(true)
              void load()
            }}
          >
            Reintentar
          </Button>
        </div>
      </div>
    )
  }

  return (
    // Móvil: ocupa la pantalla entera. Escritorio: tarjeta de alto natural
    // centrada en el espacio disponible, para que el contenido no flote en
    // un panel estirado a 900 px de alto.
    <div className="mx-auto flex h-full w-full max-w-3xl lg:items-center">
      <PunchPanel
        personName={profile.full_name}
        entries={entries}
        contractHours={profile.contract_hours}
        online={online}
        queued={queued}
        geoEnabled={geo.enabled}
        onPunch={handlePunch}
      />
    </div>
  )
}
