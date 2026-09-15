import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, RefreshCw, Search, Users } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import {
  Button,
  EmptyState,
  MicroLabel,
  Panel,
  Spinner,
  StatusPill,
  cx,
  inputClass,
} from '../components/ui'
import { Pager } from '../components/ui'
import { paginar, useFitRows } from '../hooks/useFitRows'
import { getStaffLive, subscribeToChanges } from '../lib/api'
import { ENTRY_LABEL, type StaffLiveStatus, type WorkStatus } from '../lib/types'
import { formatTime } from '../lib/time'
import { useTicker } from '../hooks/useTicker'

const FILTERS: Array<{ value: WorkStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'working', label: 'En jornada' },
  { value: 'break', label: 'En pausa' },
  { value: 'off', label: 'Fuera' },
]

export function TeamPage() {
  const [staff, setStaff] = useState<StaffLiveStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<WorkStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const now = useTicker(60_000)

  // Altura real de una fila de persona. Si cambia el diseño de la fila, este
  // número debe cambiar con él: es lo que decide cuántas caben sin desbordar.
  const [listaRef, filasPorPagina] = useFitRows(57)

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

  const pagina = paginar(visible, page, filasPorPagina)

  useEffect(() => {
    setPage(0)
  }, [filter, query])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Estado de la plantilla"
        description="Quién trabaja ahora, quién está en pausa y quién no ha iniciado jornada."
        action={
          <Button size="sm" onClick={() => void load()}>
            <RefreshCw size={14} />
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
        }
      />

      {/* --- Contadores por estado, que además son los filtros ------------
          Cifras planas sobre superficie blanca. Las tarjetas anteriores
          llevaban cristal, una barra en degradado y un desplazamiento al
          pasar el cursor: tres efectos para mostrar tres números. */}
      <div className="mb-2.5 grid shrink-0 grid-cols-3 gap-2">
        {(
          [
            ['working', 'En jornada', counts.working, 'text-live'],
            ['break', 'En pausa', counts.break, 'text-rest'],
            ['off', 'Fuera', counts.off, 'text-ink-soft'],
          ] as const
        ).map(([key, label, value, tone]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(filter === key ? 'all' : key)}
            className={cx(
              'surface rounded-[10px] px-3 py-2 text-left transition-colors',
              filter === key ? 'border-violet-400 bg-violet-50' : 'hover:bg-slate-50',
            )}
          >
            <MicroLabel>{label}</MicroLabel>
            <p className={cx('tnum mt-1 text-[22px] leading-none font-semibold', tone)}>{value}</p>
          </button>
        ))}
      </div>

      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--color-hairline)] px-3 py-2">
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cx(
                  'shrink-0 rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                  filter === f.value
                    ? 'bg-violet-700 text-white'
                    : 'text-ink-soft hover:bg-slate-100',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative hidden sm:block">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
            />
            <input
              type="search"
              placeholder="Buscar…"
              aria-label="Buscar en la plantilla"
              className={cx(inputClass, 'h-8 w-44 pl-8 text-[12.5px]')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* La lista mide su propia caja y muestra solo las filas que caben. */}
        <div ref={listaRef} className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-[13px] text-ink-soft">
              <Spinner /> Cargando plantilla…
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<Users size={18} />}
              title="Sin resultados"
              description="Ninguna persona coincide con el filtro aplicado."
            />
          ) : (
            <ul>
              {pagina.slice.map((person) => (
                <li
                  key={person.user_id}
                  className="flex h-[57px] items-center gap-2.5 border-b border-[color:var(--color-hairline)] px-3 last:border-b-0"
                >
                  <span
                    className={cx(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                      person.status === 'working'
                        ? 'bg-live-soft text-emerald-800'
                        : person.status === 'break'
                          ? 'bg-rest-soft text-orange-800'
                          : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {person.full_name
                      .split(' ')
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join('')}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">
                      {person.full_name}
                    </p>
                    <p className="truncate text-[11px] text-ink-soft">
                      {person.employee_number ?? '—'} · {person.contract_hours} h/semana
                    </p>
                  </div>

                  <div className="hidden text-right sm:block">
                    <p className="tnum text-[11.5px] text-ink-soft">
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
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--color-hairline)] px-3 py-2">
          <Pager
            page={pagina.page}
            pages={pagina.pages}
            total={visible.length}
            onPage={setPage}
            unit="personas"
          />
          <Link
            to="/informes"
            className="hidden shrink-0 items-center gap-1 text-[12px] font-medium text-violet-800 hover:text-violet-600 sm:inline-flex"
          >
            Informes mensuales
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </Panel>
    </div>
  )
}
