import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileDown, History, Info, X } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { PageHeader } from '../components/Layout'
import {
  Badge,
  Button,
  EmptyState,
  MicroLabel,
  Notice,
  Panel,
  Spinner,
  cx,
} from '../components/ui'
import { getAudits, getEntries, getDailySummaries, logAccess } from '../lib/api'
import type { DailySummary, TimeEntry, TimeEntryAudit } from '../lib/types'
import { ENTRY_LABEL } from '../lib/types'
import {
  MONTHS_ES,
  WEEKDAYS_ES,
  formatDuration,
  formatTime,
  mondayFirstDay,
  toISODate,
} from '../lib/time'

/**
 * HISTORIAL
 *
 * El calendario ocupa exactamente el hueco disponible: la rejilla reparte su
 * altura entre las semanas del mes con `1fr`, así que ni sobra espacio ni se
 * sale por abajo, tenga el mes cinco o seis semanas.
 *
 * El detalle del día vivía antes apilado debajo, lo que en un móvil obligaba a
 * desplazarse para ver aquello sobre lo que se acababa de pulsar. Ahora es un
 * panel inferior en móvil y una columna fija en escritorio.
 */
export function HistoryPage() {
  const { session } = useSession()
  const profile = session!.profile
  const company = session!.company

  const [cursor, setCursor] = useState(() => new Date())
  const [summaries, setSummaries] = useState<DailySummary[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [audits, setAudits] = useState<TimeEntryAudit[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const range = useMemo(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    return { from: toISODate(from), to: toISODate(to), first: from, last: to }
  }, [cursor])

  const load = useCallback(async () => {
    setLoading(true)
    const [s, e] = await Promise.all([
      getDailySummaries(profile.id, range.from, range.to),
      getEntries(profile.id, range.from, range.to),
    ])
    setSummaries(s)
    setEntries(e)
    setAudits(await getAudits({ entryIds: e.map((x) => x.id) }))
    setLoading(false)
  }, [profile.id, range.from, range.to])

  useEffect(() => {
    void load()
  }, [load])

  const byDate = useMemo(() => {
    const map = new Map<string, DailySummary>()
    for (const s of summaries) map.set(s.work_date, s)
    return map
  }, [summaries])

  const entriesByDate = useMemo(() => {
    const map = new Map<string, TimeEntry[]>()
    for (const e of entries) {
      const list = map.get(e.work_date) ?? []
      list.push(e)
      map.set(e.work_date, list)
    }
    return map
  }, [entries])

  const monthTotal = summaries.reduce((acc, s) => acc + s.worked_seconds, 0)
  const daysWorked = summaries.filter((s) => s.worked_seconds > 0).length

  // Rejilla del calendario: se rellena desde el lunes anterior al día 1.
  const { cells, weeks } = useMemo(() => {
    const lead = mondayFirstDay(range.first)
    const total = lead + range.last.getDate()
    const semanas = Math.ceil(total / 7)
    return {
      weeks: semanas,
      cells: Array.from({ length: semanas * 7 }, (_, i) => {
        const dayNumber = i - lead + 1
        if (dayNumber < 1 || dayNumber > range.last.getDate()) return null
        const date = new Date(cursor.getFullYear(), cursor.getMonth(), dayNumber)
        return { date, iso: toISODate(date), dayNumber }
      }),
    }
  }, [range, cursor])

  const selectedEntries = selected ? (entriesByDate.get(selected) ?? []) : []
  const selectedSummary = selected ? byDate.get(selected) : undefined
  const selectedAudits = audits.filter(
    (a) => a.action !== 'create' && selectedEntries.some((e) => e.id === a.entry_id),
  )

  const isFuture = (iso: string) => iso > toISODate(new Date())

  async function handleExport() {
    // jsPDF pesa cientos de KB: solo se descarga cuando alguien exporta, para
    // no lastrar la pantalla de fichaje en un móvil.
    const { downloadMonthlyPdf } = await import('../lib/exportPdf')
    await downloadMonthlyPdf({
      company,
      people: [{ profile, summaries }],
      year: cursor.getFullYear(),
      month: cursor.getMonth(),
      generatedBy: profile.full_name,
    })
    await logAccess({
      companyId: company.id,
      actorId: profile.id,
      actorRole: profile.role,
      action: 'export_pdf_self',
      subjectUserId: profile.id,
      periodStart: range.from,
      periodEnd: range.to,
    })
  }

  const detalle = (
    <>
      {!selected || !selectedSummary ? (
        <EmptyState
          icon={<History size={18} />}
          title="Ningún día seleccionado"
          description="Pulse sobre una jornada del calendario para ver sus fichajes y sus rectificaciones."
        />
      ) : (
        <div className="flex flex-col gap-3 px-3.5 py-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-[color:var(--color-hairline)] bg-[color:var(--color-hairline)]">
            <div className="bg-surface px-3 py-2">
              <MicroLabel>Trabajado</MicroLabel>
              <p className="tnum mt-0.5 text-[16px] font-semibold text-ink">
                {formatDuration(selectedSummary.worked_seconds)}
              </p>
            </div>
            <div className="bg-surface px-3 py-2">
              <MicroLabel>Pausas</MicroLabel>
              <p className="tnum mt-0.5 text-[16px] font-semibold text-ink">
                {formatDuration(selectedSummary.break_seconds)}
              </p>
            </div>
          </div>

          <div>
            <MicroLabel>Fichajes</MicroLabel>
            <ol className="mt-1.5 flex flex-col">
              {selectedEntries.map((entry, i) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2.5 border-b border-[color:var(--color-hairline)] py-1.5 last:border-b-0"
                >
                  <span className="tnum w-11 text-[12.5px] font-semibold text-ink">
                    {formatTime(entry.event_at)}
                  </span>
                  <span className="flex-1 text-[12.5px] text-ink-soft">
                    {ENTRY_LABEL[entry.entry_type]}
                  </span>
                  {entry.origin === 'correction' && <Badge tone="warn">rectificado</Badge>}
                  {entry.origin === 'employee_offline' && <Badge tone="neutral">diferido</Badge>}
                  {i === selectedEntries.length - 1 && selectedSummary.is_open && (
                    <Badge tone="ok">abierta</Badge>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {selectedAudits.length > 0 && (
            <div>
              <MicroLabel>Rectificaciones</MicroLabel>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {selectedAudits.map((audit) => (
                  <div
                    key={audit.id}
                    className="rounded-[6px] border border-orange-200 bg-rest-soft px-3 py-2"
                  >
                    <p className="text-[11.5px] font-medium text-orange-900">
                      {audit.old_event_at ? (
                        <>
                          Original <span className="tnum">{formatTime(audit.old_event_at)}</span> →{' '}
                          <span className="tnum">{formatTime(audit.new_event_at)}</span>
                        </>
                      ) : (
                        <>
                          Añadido:{' '}
                          <span className="tnum">{formatTime(audit.new_event_at)}</span>
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-orange-800">
                      {audit.reason}
                    </p>
                    <p className="mt-1 text-[10px] text-orange-700">
                      {audit.actor_name ?? 'Administración'} ·{' '}
                      {new Date(audit.created_at).toLocaleDateString('es-ES')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedSummary.is_open && (
            <Notice tone="warn" icon={<Info size={14} />}>
              Esta jornada no tiene fichaje de salida. Solicite una corrección para
              completarla.
            </Notice>
          )}
        </div>
      )}
    </>
  )

  const tituloDetalle = selected
    ? new Date(`${selected}T12:00:00`).toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : 'Detalle del día'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Mi historial"
        description="Un fichaje rectificado conserva su versión original."
        action={
          <Button size="sm" onClick={() => void handleExport()} disabled={summaries.length === 0}>
            <FileDown size={14} />
            <span className="hidden sm:inline">Descargar mes en PDF</span>
            <span className="sm:hidden">PDF</span>
          </Button>
        }
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* --- Calendario ---------------------------------------------- */}
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--color-hairline)] px-3 py-2">
            <div className="flex items-center gap-0.5">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Mes anterior"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              >
                <ChevronLeft size={15} />
              </Button>
              <h2 className="min-w-[8.5rem] text-center text-[12.5px] font-semibold text-ink">
                {MONTHS_ES[cursor.getMonth()]} {cursor.getFullYear()}
              </h2>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Mes siguiente"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              >
                <ChevronRight size={15} />
              </Button>
            </div>

            <div className="flex items-center gap-3 text-right">
              <div>
                <MicroLabel>Total</MicroLabel>
                <p className="tnum text-[13.5px] font-semibold text-ink">
                  {formatDuration(monthTotal)}
                </p>
              </div>
              <div>
                <MicroLabel>Días</MicroLabel>
                <p className="tnum text-[13.5px] font-semibold text-ink">{daysWorked}</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-soft">
              <Spinner /> Cargando…
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col p-2">
              {/* La rejilla reparte SU altura entre las semanas: `1fr` por
                  fila es lo que hace que el mes ocupe justo el hueco, tenga
                  cinco semanas o seis, sin desbordar ni dejar un vacío. */}
              <div
                className="grid min-h-0 flex-1 grid-cols-7 gap-0.5"
                style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(0, 1fr))` }}
              >
                {WEEKDAYS_ES.map((d, i) => (
                  <div
                    key={`${d}-${i}`}
                    className="pb-1 text-center text-[9.5px] font-semibold tracking-wider text-ink-faint uppercase"
                  >
                    {d}
                  </div>
                ))}

                {cells.map((cell, index) => {
                  if (!cell) return <div key={`empty-${index}`} />
                  const summary = byDate.get(cell.iso)
                  const isSelected = selected === cell.iso
                  const isToday = cell.iso === toISODate(new Date())
                  const weekend = cell.date.getDay() === 0 || cell.date.getDay() === 6
                  const worked = summary?.worked_seconds ?? 0

                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => setSelected(isSelected ? null : cell.iso)}
                      disabled={!summary}
                      aria-pressed={isSelected}
                      className={cx(
                        'relative flex min-h-0 flex-col items-center justify-center gap-0.5 rounded-[4px] border text-xs transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-600',
                        isSelected
                          ? 'border-violet-600 bg-violet-100 text-violet-900'
                          : summary
                            ? 'border-[color:var(--color-hairline)] bg-surface hover:border-violet-300 hover:bg-violet-50'
                            : cx(
                                'border-transparent',
                                weekend ? 'bg-slate-50' : 'bg-surface',
                                isFuture(cell.iso) ? 'text-slate-300' : 'text-ink-faint',
                              ),
                      )}
                    >
                      <span
                        className={cx(
                          'text-[12.5px] leading-none font-medium',
                          isToday && !isSelected && 'text-violet-800',
                        )}
                      >
                        {cell.dayNumber}
                      </span>
                      {summary && (
                        <span className="tnum text-[9.5px] leading-none text-ink-soft">
                          {formatDuration(worked)}
                        </span>
                      )}
                      {summary?.has_corrections && (
                        <span
                          className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-orange-500"
                          title="Contiene una rectificación"
                        />
                      )}
                      {summary?.is_open && (
                        <span
                          className="absolute top-1 left-1 h-1.5 w-1.5 rounded-full bg-emerald-500"
                          title="Jornada sin cerrar"
                        />
                      )}
                      {isToday && <span className="absolute inset-x-2 bottom-1 h-px bg-violet-700" />}
                    </button>
                  )
                })}
              </div>

              <div className="mt-1.5 flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t border-[color:var(--color-hairline)] pt-1.5 text-[10.5px] text-ink-soft">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> Con rectificación
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Sin cerrar
                </span>
              </div>
            </div>
          )}
        </Panel>

        {/* --- Detalle: columna en escritorio --------------------------- */}
        <Panel className="hidden min-h-0 flex-col overflow-hidden lg:flex">
          <div className="shrink-0 border-b border-[color:var(--color-hairline)] px-4 py-2.5">
            <h2 className="text-[13.5px] font-semibold tracking-tight text-ink first-letter:uppercase">
              {tituloDetalle}
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{detalle}</div>
        </Panel>
      </div>

      {/* --- Detalle: panel inferior en móvil --------------------------- */}
      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden" role="dialog" aria-modal="false">
          <div className="mx-auto max-w-md px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <div className="surface max-h-[62vh] overflow-y-auto rounded-[12px] shadow-[var(--shadow-hero)]">
              <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-[color:var(--color-hairline)] bg-surface px-3.5 py-2.5">
                <h2 className="truncate text-[13.5px] font-semibold tracking-tight text-ink first-letter:uppercase">
                  {tituloDetalle}
                </h2>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Cerrar detalle"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-soft hover:bg-slate-100"
                >
                  <X size={15} />
                </button>
              </div>
              {detalle}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
