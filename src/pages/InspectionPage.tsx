import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, Gavel, ShieldCheck } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { PageHeader } from '../components/Layout'
import {
  Pager,
  Tabs,
  Badge,
  Button,
  MicroLabel,
  Notice,
  Panel,
  PanelHeader,
  Spinner,
  cx,
  inputClass,
} from '../components/ui'
import {
  getCorrectionAudits,
  getDailySummaries,
  getRawEntries,
  listProfiles,
  logAccess,
} from '../lib/api'
import { ENTRY_LABEL, type DailySummary, type Profile, type TimeEntry, type TimeEntryAudit } from '../lib/types'
import { formatDate, formatDuration, formatTime, toISODate } from '../lib/time'
import { paginarPorAltura, useBoxHeight } from '../hooks/useFitRows'

/**
 * VISTA DE INSPECCIÓN
 *
 * Pensada para resolver en un minuto la pregunta que hace un inspector o la
 * RLT: «enséñeme el registro de esta persona en este periodo, y dígame qué se
 * ha tocado». Muestra el libro COMPLETO —incluidos los asientos sustituidos—
 * y no solo la foto vigente.
 */
export function InspectionPage() {
  const { session } = useSession()
  const actor = session!.profile
  const company = session!.company

  const [people, setPeople] = useState<Profile[]>([])
  const [personId, setPersonId] = useState('')
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return toISODate(d)
  })
  const [to, setTo] = useState(() => toISODate(new Date()))

  const [raw, setRaw] = useState<TimeEntry[]>([])
  const [summaries, setSummaries] = useState<DailySummary[]>([])
  const [audits, setAudits] = useState<TimeEntryAudit[]>([])
  const [tab, setTab] = useState<'libro' | 'rect'>('libro')
  const [page, setPage] = useState(0)

  // Los días no miden todos lo mismo: uno con dos fichajes ocupa la mitad que
  // uno con ocho. Por eso se mide la caja y se empaquetan días hasta llenarla,
  // en vez de dividir por una altura media que recortaría los días largos.
  const [libroRef, altoLibro] = useBoxHeight<HTMLUListElement>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      const staff = (await listProfiles()).filter((p) => p.role !== 'inspector')
      setPeople(staff)
      if (staff.length > 0) setPersonId(staff[0].id)
      setAudits(await getCorrectionAudits())
    })()
  }, [company.id])

  const load = useCallback(async () => {
    if (!personId) return
    setLoading(true)
    const [entries, daily] = await Promise.all([
      getRawEntries(personId, from, to),
      getDailySummaries(personId, from, to),
    ])
    setRaw(entries)
    setSummaries(daily)
    setLoading(false)

    await logAccess({
      companyId: company.id,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'view_inspection',
      subjectUserId: personId,
      periodStart: from,
      periodEnd: to,
    })
  }, [personId, from, to, company.id, actor.id, actor.role])

  useEffect(() => {
    void load()
  }, [load])

  const supersededIds = useMemo(
    () => new Set(raw.map((e) => e.supersedes_id).filter(Boolean) as string[]),
    [raw],
  )

  const person = people.find((p) => p.id === personId)
  const total = summaries.reduce((acc, s) => acc + s.worked_seconds, 0)

  const byDate = useMemo(() => {
    const map = new Map<string, TimeEntry[]>()
    for (const entry of raw) {
      const list = map.get(entry.work_date) ?? []
      list.push(entry)
      map.set(entry.work_date, list)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [raw])

  // 30 px de cabecera del día más 30 por asiento. Ambas alturas están FIJADAS
  // en el marcado (`h-[30px]`) justamente para que esta cuenta sea exacta y no
  // una estimación: con filas de alto variable, el último día se recortaba.
  const libro = paginarPorAltura(
    byDate,
    ([, entries]) => 30 + entries.length * 30,
    altoLibro,
    page,
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Vista de Inspección"
        description="Acceso de solo lectura al registro completo, incluidos los asientos sustituidos por una rectificación. Preparado para su presentación ante la Inspección de Trabajo o la representación legal de la plantilla."
      />

      {/* --- Garantía de inalterabilidad ---------------------------------
          Se afirma SOLO lo que el sistema puede sostener: que no existe
          ningún camino de escritura que modifique o borre un asiento, y que
          la hora de grabación la pone el servidor. No se habla de cadenas de
          verificación que esta base de datos no calcula. */}
      <div className="mb-2.5 hidden shrink-0 lg:block">
        <Notice tone="ok" icon={<ShieldCheck size={16} />}>
          <span className="font-medium">Registro inalterable.</span> En {company.name}{' '}
          ningún perfil —tampoco administración— puede modificar ni borrar un fichaje ya
          registrado: las reglas del servidor no contemplan esa operación, y la hora de
          grabación la sella el servidor, no el dispositivo.
          <span className="hidden sm:inline">
            {' '}Las rectificaciones constan junto al asiento original que sustituyen.
          </span>
        </Notice>
      </div>

      {/* --- Selector de sujeto y periodo --------------------------------
          Una sola fila, sin etiquetas sobre cada campo: en móvil los cuatro
          controles apilados con su etiqueta ocupaban 250 px y dejaban el
          libro sin espacio. El `aria-label` mantiene la accesibilidad. */}
      <Panel className="mb-2.5 shrink-0">
        <div className="grid gap-2 px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_140px_140px_auto] sm:items-center">
          <select
            id="person"
            aria-label="Persona trabajadora"
            className={cx(inputClass, 'h-9 text-[12.5px]')}
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} {p.employee_number ? `(${p.employee_number})` : ''}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-2 sm:contents">
            <input
              id="from"
              type="date"
              aria-label="Desde"
              className={cx(inputClass, 'h-9 text-[12.5px]')}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              id="to"
              type="date"
              aria-label="Hasta"
              className={cx(inputClass, 'h-9 text-[12.5px]')}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            disabled={!person || summaries.length === 0}
            onClick={() => {
              if (!person) return
              void (async () => {
                const { downloadMonthlyPdf } = await import('../lib/exportPdf')
                await downloadMonthlyPdf({
                  company,
                  people: [{ profile: person, summaries }],
                  year: new Date(from).getFullYear(),
                  month: new Date(from).getMonth(),
                  generatedBy: `${actor.full_name} (${actor.role === 'inspector' ? 'Inspección' : 'Administración'})`,
                })
              })()
            }}
          >
            <FileDown size={14} />
            Certificado PDF
          </Button>
        </div>
      </Panel>

      <Tabs
        tabs={[
          { id: 'libro' as const, label: 'Libro de fichajes' },
          { id: 'rect' as const, label: 'Rectificaciones', count: audits.length },
        ]}
        active={tab}
        onChange={setTab}
        className="surface mb-2.5 rounded-[10px] border-b-0 lg:hidden"
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* --- Libro de asientos ----------------------------------------- */}
        <Panel
          className={cx(
            'flex min-h-0 flex-col overflow-hidden lg:flex',
            tab !== 'libro' && 'hidden',
          )}
        >
          <PanelHeader
            title="Libro de fichajes"
            hint={
              person
                ? `${person.full_name} · ${formatDate(from)} — ${formatDate(to)} · ${formatDuration(total)} trabajadas`
                : undefined
            }
          />

          {loading ? (
            <div className="flex items-center gap-2 px-4 py-16 text-sm text-slate-500">
              <Spinner /> Recuperando asientos…
            </div>
          ) : byDate.length === 0 ? (
            <div className="px-4 py-12">
              <p className="text-sm text-slate-600">
                No hay fichajes registrados en el periodo seleccionado.
              </p>
            </div>
          ) : (
            <ul ref={libroRef} className="min-h-0 flex-1 overflow-hidden">
              {libro.slice.map(([date, entries]) => {
                const summary = summaries.find((s) => s.work_date === date)
                return (
                  <li key={date} className="border-b border-slate-100 last:border-b-0">
                    <div className="flex h-[30px] items-center justify-between gap-2 bg-slate-50 px-3">
                      <span className="text-[12px] font-semibold text-slate-800">
                        {new Date(`${date}T12:00:00`).toLocaleDateString('es-ES', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </span>
                      <span className="tnum text-[12px] font-medium text-slate-600">
                        {summary ? formatDuration(summary.worked_seconds) : '—'}
                      </span>
                    </div>

                    <ul className="px-3">
                      {entries.map((entry) => {
                        const isSuperseded = supersededIds.has(entry.id)
                        return (
                          <li
                            key={entry.id}
                            className={cx(
                              'flex h-[30px] items-center gap-2 border-b border-slate-50 text-[12.5px] last:border-b-0',
                              (isSuperseded || entry.is_annulment) && 'opacity-60',
                            )}
                          >
                            <span
                              className={cx(
                                'tnum w-12 font-semibold',
                                isSuperseded || entry.is_annulment
                                  ? 'text-slate-500 line-through'
                                  : 'text-slate-900',
                              )}
                            >
                              {formatTime(entry.event_at)}
                            </span>
                            <span className="text-slate-600">
                              {ENTRY_LABEL[entry.entry_type]}
                            </span>

                            {isSuperseded && <Badge tone="neutral">sustituido</Badge>}
                            {entry.is_annulment && <Badge tone="danger">anulado</Badge>}
                            {entry.origin === 'correction' && <Badge tone="warn">rectificación</Badge>}
                            {entry.origin === 'employee_offline' && (
                              <Badge tone="neutral">diferido</Badge>
                            )}

                            {/* Identificador del asiento: permite citar una
                                linea concreta en un requerimiento. Antes aqui
                                se imprimia el hash de la cadena SHA-256, que
                                en Firestore ya no existe y se renderizaba
                                como unos puntos suspensivos sueltos. */}
                            <span
                              className="ml-auto font-mono text-[10px] text-slate-400"
                              title={`Identificador del asiento: ${entry.id}`}
                            >
                              {entry.id.slice(0, 10)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="shrink-0 border-t border-[color:var(--color-hairline)] px-3 py-2">
            <Pager
              page={libro.page}
              pages={libro.pages}
              total={byDate.length}
              onPage={setPage}
              unit="días"
            />
          </div>
        </Panel>

        {/* --- Rectificaciones del periodo -------------------------------- */}
        <Panel
          className={cx(
            'flex min-h-0 flex-col overflow-hidden lg:flex',
            tab !== 'rect' && 'hidden',
          )}
        >
          <PanelHeader
            title="Rectificaciones"
            hint="Con hora original, hora nueva, motivo y autor"
          />
          {audits.length === 0 ? (
            <div className="px-4 py-8">
              <p className="flex items-center gap-2 text-[13px] text-slate-600">
                <Gavel size={15} className="text-slate-400" />
                No consta ninguna rectificación en el registro de esta empresa.
              </p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {audits.map((audit) => (
                <li key={audit.id} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={audit.action === 'annul' ? 'danger' : 'warn'}>
                      {audit.action === 'annul' ? 'Anulación' : 'Rectificación'}
                    </Badge>
                    <span className="text-[10px] text-slate-400">
                      {new Date(audit.created_at).toLocaleString('es-ES')}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <div>
                      <MicroLabel>Original</MicroLabel>
                      <p className="tnum text-[13px] text-slate-500 line-through">
                        {audit.old_event_at ? formatTime(audit.old_event_at) : '—'}
                      </p>
                    </div>
                    <span className="text-slate-300">→</span>
                    <div>
                      <MicroLabel>Registrada</MicroLabel>
                      <p className="tnum text-[13px] font-semibold text-slate-900">
                        {formatTime(audit.new_event_at)}
                      </p>
                    </div>
                  </div>

                  {audit.reason && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
                      {audit.reason}
                    </p>
                  )}
                  <p className="mt-1.5 text-[10px] text-slate-400">
                    Autorizado por {audit.actor_name ?? '—'} ({audit.actor_role})
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
