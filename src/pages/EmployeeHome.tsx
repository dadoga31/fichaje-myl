import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../context/SessionContext'
import { PunchPanel } from '../components/PunchPanel'
import { Spinner } from '../components/ui'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useGeolocation } from '../hooks/useGeolocation'
import { getEntries, punch, subscribeToChanges } from '../lib/api'
import { enqueuePunch, flushQueue, subscribeQueue } from '../lib/offlineQueue'
import type { EntryType, QueuedPunch, TimeEntry } from '../lib/types'
import { toISODate } from '../lib/time'

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

  const profile = session!.profile
  const company = session!.company
  const geo = useGeolocation(company, profile)

  const today = useMemo(() => toISODate(new Date()), [])

  const load = useCallback(async () => {
    setEntries(await getEntries(profile.id, today, today))
    setLoading(false)
  }, [profile.id, today])

  useEffect(() => {
    void load()
    // Si se ficha desde otro dispositivo (o administración rectifica un
    // fichaje), esta pantalla se entera al momento en vez de quedarse
    // mostrando un estado que ya no es cierto.
    return subscribeToChanges(['time_entries'], () => void load())
  }, [load])

  useEffect(() => subscribeQueue(setQueued), [])

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
