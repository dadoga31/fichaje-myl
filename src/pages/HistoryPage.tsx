import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileDown, History, Info } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { PageHeader } from '../components/Layout'
import {
  Badge,
  Button,
  EmptyState,
  MicroLabel,
  Notice,
  Panel,
  PanelHeader,
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
  const cells = useMemo(() => {
    const lead = mondayFirstDay(range.first)
    const total = lead + range.last.getDate()
    const rows = Math.ceil(total / 7) * 7
    return Array.from({ length: rows }, (_, i) => {
      const dayNumber = i - lead + 1
      if (dayNumber < 1 || dayNumber > range.last.getDate()) return null
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), dayNumber)
      return { date, iso: toISODate(date), dayNumber }
    })
  }, [range, cursor])

  const selectedEntries = selected ? (entriesByDate.get(selected) ?? []) : []
  const selectedSummary = selected ? byDate.get(selected) : undefined
  const selectedAudits = audits.filter(
    (a) => a.action !== 'create' && selectedEntries.some((e) => e.id === a.entry_id),
  )

  const isFuture = (iso: string) => iso > toISODate(new Date())

  async function handleExport() {
    // jsPDF pesa cientos de KB: solo se descarga cuando alguien exporta,
    // para no lastrar la pantalla de fichaje en un móvil.
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

  return (
    <>
      <PageHeader
        title="Mi historial"
        description="Consulte sus jornadas registradas. Un fichaje rectificado conserva su versión original: pulse sobre el día para ver el detalle."
        action={
          <Button size="sm" onClick={() => void handleExport()} disabled={summaries.length === 0}>
            <FileDown size={14} />
            Descargar mes en PDF
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          {/* --- Navegación de mes ---------------------------------------- */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Mes anterior"
                onClick={() =>
                  setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
                }
              >
                <ChevronLeft size={16} />
              </Button>
              <h2 className="min-w-[9.5rem] text-center text-[13px] font-semibold text-slate-900">
                {MONTHS_ES[cursor.getMonth()]} {cursor.getFullYear()}
              </h2>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Mes siguiente"
                onClick={() =>
                  setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
                }
              >
                <ChevronRight size={16} />
              </Button>
            </div>

            <div className="flex items-center gap-4 text-right">
              <div>
                <MicroLabel>Total</MicroLabel>
                <p className="tnum text-[15px] font-semibold text-slate-900">
                  {formatDuration(monthTotal)}
                </p>
              </div>
              <div>
                <MicroLabel>Días</MicroLabel>
                <p className="tnum text-[15px] font-semibold text-slate-900">{daysWorked}</p>
              </div>
            </div>
          </div>

          {/* --- Calendario ----------------------------------------------- */}
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-16 text-sm text-slate-500">
              <Spinner /> Cargando…
            </div>
          ) : (
            <div className="px-3 py-3 sm:px-4 sm:py-4">
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS_ES.map((d, i) => (
                  <div
                    key={`${d}-${i}`}
                    className="pb-1.5 text-center text-[10px] font-semibold tracking-wider text-slate-400 uppercase"
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
                        // Altura fija en lugar de aspect-square: en escritorio el
                        // calendario es ancho y las celdas cuadradas lo estiran
                        // hasta ocupar toda la pantalla.
                        'relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-[4px] border text-xs transition-colors sm:h-16',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600',
                        isSelected
                          ? 'border-brand-600 bg-brand-100 text-brand-900'
                          : summary
                            ? 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50'
                            : cx(
                                'border-transparent',
                                weekend ? 'bg-slate-50' : 'bg-white',
                                isFuture(cell.iso) ? 'text-slate-300' : 'text-slate-400',
                              ),
                      )}
                    >
                      <span
                        className={cx(
                          'text-[13px] leading-none font-medium',
                          isToday && !isSelected && 'text-brand-800',
                        )}
                      >
                        {cell.dayNumber}
                      </span>
                      {summary && (
                        <span className="tnum text-[10px] leading-none text-slate-500">
                          {formatDuration(worked)}
                        </span>
                      )}
                      {summary?.has_corrections && (
                        <span
                          className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500"
                          title="Contiene una rectificación"
                        />
                      )}
                      {summary?.is_open && (
                        <span
                          className="absolute top-1 left-1 h-1.5 w-1.5 rounded-full bg-emerald-500"
                          title="Jornada sin cerrar"
                        />
                      )}
                      {isToday && (
                        <span className="absolute inset-x-2 bottom-1 h-px bg-brand-700" />
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Con rectificación
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Jornada sin cerrar
                </span>
              </div>
            </div>
          )}
        </Panel>

        {/* --- Detalle del día ------------------------------------------- */}
        <Panel className="h-fit">
          <PanelHeader
            title={
              selected
                ? new Date(`${selected}T12:00:00`).toLocaleDateString('es-ES', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })
                : 'Detalle del día'
            }
            hint={selected ? undefined : 'Seleccione un día en el calendario'}
          />

          {!selected || !selectedSummary ? (
            <EmptyState
              icon={<History size={22} />}
              title="Ningún día seleccionado"
              description="Pulse sobre una jornada del calendario para ver sus fichajes, el total trabajado y cualquier rectificación registrada."
            />
          ) : (
            <div className="flex flex-col gap-4 px-4 py-4">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-slate-200 bg-slate-200">
                <div className="bg-white px-3 py-2.5">
                  <MicroLabel>Trabajado</MicroLabel>
                  <p className="tnum mt-1 text-lg font-semibold text-slate-900">
                    {formatDuration(selectedSummary.worked_seconds)}
                  </p>
                </div>
                <div className="bg-white px-3 py-2.5">
                  <MicroLabel>Pausas</MicroLabel>
                  <p className="tnum mt-1 text-lg font-semibold text-slate-900">
                    {formatDuration(selectedSummary.break_seconds)}
                  </p>
                </div>
              </div>

              <div>
                <MicroLabel>Fichajes</MicroLabel>
                <ol className="mt-2 flex flex-col">
                  {selectedEntries.map((entry, i) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-3 border-b border-slate-100 py-2 last:border-b-0"
                    >
                      <span className="tnum w-12 text-[13px] font-semibold text-slate-900">
                        {formatTime(entry.event_at)}
                      </span>
                      <span className="flex-1 text-[13px] text-slate-600">
                        {ENTRY_LABEL[entry.entry_type]}
                      </span>
                      {entry.origin === 'correction' && <Badge tone="warn">rectificado</Badge>}
                      {entry.origin === 'employee_offline' && (
                        <Badge tone="neutral">diferido</Badge>
                      )}
                      {i === selectedEntries.length - 1 && selectedSummary.is_open && (
                        <Badge tone="ok">abierta</Badge>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {selectedAudits.length > 0 && (
                <div>
                  <MicroLabel>Historial de rectificaciones</MicroLabel>
                  <div className="mt-2 flex flex-col gap-2">
                    {selectedAudits.map((audit) => (
                      <div
                        key={audit.id}
                        className="rounded-[4px] border border-amber-200 bg-amber-50 px-3 py-2.5"
                      >
                        <p className="text-[12px] font-medium text-amber-900">
                          {audit.old_event_at ? (
                            <>
                              Hora original{' '}
                              <span className="tnum">{formatTime(audit.old_event_at)}</span> →
                              rectificada a{' '}
                              <span className="tnum">{formatTime(audit.new_event_at)}</span>
                            </>
                          ) : (
                            <>
                              Fichaje añadido:{' '}
                              <span className="tnum">{formatTime(audit.new_event_at)}</span>
                            </>
                          )}
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                          {audit.reason}
                        </p>
                        <p className="mt-1.5 text-[10px] text-amber-700">
                          {audit.actor_name ?? 'Administración'} ·{' '}
                          {new Date(audit.created_at).toLocaleString('es-ES')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedSummary.is_open && (
                <Notice tone="warn" icon={<Info size={15} />}>
                  Esta jornada no tiene fichaje de salida. Solicite una corrección para
                  completarla.
                </Notice>
              )}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
