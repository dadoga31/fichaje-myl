import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarRange, TrendingUp } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { PunchPanel } from '../components/PunchPanel'
import { PageHeader } from '../components/Layout'
import { MicroLabel, Panel, PanelHeader, Spinner, cx } from '../components/ui'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useGeolocation } from '../hooks/useGeolocation'
import { getDailySummaries, getEntries, punch } from '../lib/api'
import { enqueuePunch, flushQueue, subscribeQueue } from '../lib/offlineQueue'
import type { DailySummary, EntryType, QueuedPunch, TimeEntry } from '../lib/types'
import { formatDuration, toISODate } from '../lib/time'

export function EmployeeHome() {
  const { session } = useSession()
  const online = useOnlineStatus()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [week, setWeek] = useState<DailySummary[]>([])
  const [queued, setQueued] = useState<QueuedPunch[]>([])
  const [loading, setLoading] = useState(true)

  const profile = session!.profile
  const company = session!.company
  const geo = useGeolocation(company, profile)

  const today = useMemo(() => toISODate(new Date()), [])

  const weekRange = useMemo(() => {
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    return { from: toISODate(monday), to: toISODate(now) }
  }, [])

  const load = useCallback(async () => {
    const [dayEntries, summaries] = await Promise.all([
      getEntries(profile.id, today, today),
      getDailySummaries(profile.id, weekRange.from, weekRange.to),
    ])
    setEntries(dayEntries)
    setWeek(summaries)
    setLoading(false)
  }, [profile.id, today, weekRange.from, weekRange.to])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => subscribeQueue(setQueued), [])

  // Al recuperar la conexión, se vacía la cola y se refresca el estado real.
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

  const weekTotal = week.reduce((acc, day) => acc + day.worked_seconds, 0)
  const weekTarget = profile.contract_hours * 3600
  const balance = weekTotal - (profile.contract_hours / 5) * 3600 * week.length

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
        <Spinner /> Cargando su jornada…
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title={`Hola, ${profile.full_name.split(' ')[0]}`}
        description="Registre su entrada, sus pausas y su salida. Cada fichaje queda sellado en el momento en que lo realiza."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <PunchPanel
          personName={profile.full_name}
          entries={entries}
          contractHours={profile.contract_hours}
          online={online}
          queued={queued}
          geoEnabled={geo.enabled}
          onPunch={handlePunch}
        />

        {/* --- Columna lateral: semana en curso -------------------------- */}
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="Esta semana" hint="De lunes a hoy" />
            <div className="px-4 py-4">
              <div className="flex items-baseline gap-2">
                <span className="tnum text-3xl font-semibold tracking-tight text-slate-900">
                  {formatDuration(weekTotal)}
                </span>
                <span className="text-xs text-slate-500">
                  de {profile.contract_hours} h semanales
                </span>
              </div>

              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-brand-800 transition-[width] duration-700"
                  style={{ width: `${Math.min(100, (weekTotal / weekTarget) * 100)}%` }}
                />
              </div>

              <p
                className={cx(
                  'mt-3 flex items-center gap-1.5 text-[13px]',
                  balance >= 0 ? 'text-emerald-700' : 'text-slate-600',
                )}
              >
                <TrendingUp size={14} />
                {balance >= 0
                  ? `${formatDuration(balance)} por encima de lo previsto`
                  : `${formatDuration(-balance)} por debajo de lo previsto`}
              </p>
            </div>

            <ul className="border-t border-slate-200">
              {week.length === 0 && (
                <li className="px-4 py-3 text-[13px] text-slate-500">
                  Sin jornadas registradas esta semana.
                </li>
              )}
              {week.map((day) => (
                <li
                  key={day.work_date}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0"
                >
                  <span className="text-[13px] text-slate-700">
                    {new Date(`${day.work_date}T12:00:00`).toLocaleDateString('es-ES', {
                      weekday: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <span className="flex items-center gap-2">
                    {day.is_open && (
                      <span className="text-[10px] font-medium text-emerald-600">en curso</span>
                    )}
                    <span className="tnum text-[13px] font-medium text-slate-900">
                      {formatDuration(day.worked_seconds)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <div className="px-4 py-4">
              <MicroLabel>¿Olvidó fichar?</MicroLabel>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
                No puede editar un fichaje ya registrado, pero sí solicitar su
                rectificación. Quedará documentada con su motivo y la resolverá
                administración.
              </p>
              <Link
                to="/correcciones"
                className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-800 hover:text-brand-600"
              >
                Solicitar una corrección
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </Panel>

          <Link
            to="/historial"
            className="flex items-center justify-between gap-3 rounded-[6px] border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            <span className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
              <CalendarRange size={15} className="text-slate-400" />
              Ver mi historial completo
            </span>
            <ArrowUpRight size={14} className="text-slate-400" />
          </Link>
        </div>
      </div>
    </>
  )
}
