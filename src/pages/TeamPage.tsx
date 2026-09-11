import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, RefreshCw, Search, Users } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import {
  Button,
  EmptyState,
  MicroLabel,
  Panel,
  PanelHeader,
  Spinner,
  StatusPill,
  cx,
  inputClass,
} from '../components/ui'
import { getStaffLive, subscribeToChanges } from '../lib/api'
import { ENTRY_LABEL, type StaffLiveStatus, type WorkStatus } from '../lib/types'
import { formatTime } from '../lib/time'
import { useTicker } from '../hooks/useTicker'

const FILTERS: Array<{ value: WorkStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Toda la plantilla' },
  { value: 'working', label: 'En jornada' },
  { value: 'break', label: 'En pausa' },
  { value: 'off', label: 'Fuera de jornada' },
]

export function TeamPage() {
  const [staff, setStaff] = useState<StaffLiveStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<WorkStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const now = useTicker(60_000)

  const load = useCallback(async () => {
    setStaff(await getStaffLive())
    setLoading(false)
  }, [])

  // Vista en vivo de verdad: cada fichaje de la plantilla llega empujado por
  // el servidor, así que el panel cambia en el mismo instante.
  useEffect(() => {
    void load()
    return subscribeToChanges(['time_entries'], () => void load())
  }, [load])

  // Red de seguridad: si el WebSocket se cae (túnel, móvil que se duerme),
  // el reloj de 60 s vuelve a traer el estado sin que nadie tenga que recargar.
  useEffect(() => {
    void load()
  }, [now, load])

  const counts = useMemo(
    () => ({
      working: staff.filter((s) => s.status === 'working').length,
      break: staff.filter((s) => s.status === 'break').length,
      off: staff.filter((s) => s.status === 'off').length,
    }),
    [staff],
  )

  const visible = useMemo(
    () =>
      staff.filter((person) => {
        if (filter !== 'all' && person.status !== filter) return false
        if (!query.trim()) return true
        const q = query.trim().toLowerCase()
        return (
          person.full_name.toLowerCase().includes(q) ||
          (person.employee_number ?? '').toLowerCase().includes(q)
        )
      }),
    [staff, filter, query],
  )

  return (
    <>
      <PageHeader
        title="Estado de la plantilla"
        description="Quién está trabajando ahora mismo, quién está en pausa y quién no ha iniciado jornada. Se actualiza automáticamente."
        action={
          <Button size="sm" onClick={() => void load()}>
            <RefreshCw size={14} />
            Actualizar
          </Button>
        }
      />

      {/* --- Contadores por estado --------------------------------------- */}
      <div className="mb-4 grid gap-px overflow-hidden rounded-[6px] border border-slate-200 bg-slate-200 sm:grid-cols-3">
        {(
          [
            ['working', 'En jornada', counts.working, 'text-emerald-600'],
            ['break', 'En pausa', counts.break, 'text-orange-600'],
            ['off', 'Fuera de jornada', counts.off, 'text-slate-500'],
          ] as const
        ).map(([key, label, value, tone]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(filter === key ? 'all' : key)}
            className={cx(
              'bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50',
              filter === key && 'bg-brand-50 hover:bg-brand-50',
            )}
          >
            <MicroLabel>{label}</MicroLabel>
            <p className={cx('tnum mt-1 text-2xl font-semibold tracking-tight', tone)}>
              {value}
            </p>
          </button>
        ))}
      </div>

      <Panel>
        <PanelHeader
          title="Personas"
          hint={`${visible.length} de ${staff.length}`}
          action={
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                placeholder="Buscar…"
                aria-label="Buscar en la plantilla"
                className={cx(inputClass, 'h-8 w-40 pl-8 text-[13px] sm:w-56')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          }
        />

        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 py-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cx(
                'shrink-0 rounded-[4px] px-2.5 py-1 text-xs font-medium transition-colors',
                filter === f.value
                  ? 'bg-brand-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-12 text-sm text-slate-500">
            <Spinner /> Cargando plantilla…
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title="Sin resultados"
            description="Ninguna persona coincide con el filtro aplicado."
          />
        ) : (
          <ul>
            {visible.map((person) => (
              <li
                key={person.user_id}
                className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50/70"
              >
                <span
                  className={cx(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    person.status === 'working'
                      ? 'bg-emerald-50 text-emerald-700'
                      : person.status === 'break'
                        ? 'bg-orange-50 text-orange-700'
                        : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {person.full_name
                    .split(' ')
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join('')}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-900">
                    {person.full_name}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {person.employee_number ?? '—'} · {person.contract_hours} h/semana
                  </p>
                </div>

                <div className="hidden text-right sm:block">
                  <MicroLabel>Último fichaje</MicroLabel>
                  <p className="tnum mt-0.5 text-[12px] text-slate-700">
                    {person.last_action_at
                      ? `${formatTime(person.last_action_at)} · ${ENTRY_LABEL[person.last_action!]}`
                      : 'Sin fichajes'}
                  </p>
                </div>

                <StatusPill status={person.status} pulse />
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-slate-200 px-4 py-3">
          <Link
            to="/informes"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-800 hover:text-brand-600"
          >
            Generar informes mensuales de la plantilla
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </Panel>
    </>
  )
}
