import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, Gavel, ShieldCheck } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { PageHeader } from '../components/Layout'
import {
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

  return (
    <>
      <PageHeader
        title="Vista de Inspección"
        description="Acceso de solo lectura al registro completo, incluidos los asientos sustituidos por una rectificación. Preparado para su presentación ante la Inspección de Trabajo o la representación legal de la plantilla."
      />

      {/* --- Garantía de inalterabilidad ---------------------------------
          Se afirma SOLO lo que el sistema puede sostener: que no existe
          ningún camino de escritura que modifique o borre un asiento, y que
          la hora de grabación la pone el servidor. No se habla de cadenas de
          verificación que esta base de datos no calcula. */}
      <div className="mb-4">
        <Notice tone="ok" icon={<ShieldCheck size={16} />}>
          <span className="font-medium">Registro inalterable.</span> En {company.name}{' '}
          ningún perfil —tampoco administración— puede modificar ni borrar un fichaje
          ya registrado: las reglas de seguridad del servidor no contemplan esa
          operación. La hora de grabación de cada asiento la sella el servidor, no el
          dispositivo. Las rectificaciones aparecen abajo, junto al asiento original
          que sustituyen.
        </Notice>
      </div>

      {/* --- Selector de sujeto y periodo -------------------------------- */}
      <Panel className="mb-4">
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_150px_150px_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="person" className="text-xs font-medium text-slate-700">
              Persona trabajadora
            </label>
            <select
              id="person"
              className={inputClass}
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} {p.employee_number ? `(${p.employee_number})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="from" className="text-xs font-medium text-slate-700">
              Desde
            </label>
            <input
              id="from"
              type="date"
              className={inputClass}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="to" className="text-xs font-medium text-slate-700">
              Hasta
            </label>
            <input
              id="to"
              type="date"
              className={inputClass}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          <Button
            variant="primary"
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
            <FileDown size={15} />
            Certificado PDF
          </Button>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* --- Libro de asientos ----------------------------------------- */}
        <Panel>
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
            <ul className="max-h-[640px] overflow-y-auto">
              {byDate.map(([date, entries]) => {
                const summary = summaries.find((s) => s.work_date === date)
                return (
                  <li key={date} className="border-b border-slate-100 last:border-b-0">
                    <div className="flex items-center justify-between gap-2 bg-slate-50 px-4 py-2">
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

                    <ul className="px-4 py-1">
                      {entries.map((entry) => {
                        const isSuperseded = supersededIds.has(entry.id)
                        return (
                          <li
                            key={entry.id}
                            className={cx(
                              'flex flex-wrap items-center gap-2 border-b border-slate-50 py-2 text-[13px] last:border-b-0',
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
        </Panel>

        {/* --- Rectificaciones del periodo -------------------------------- */}
        <Panel className="h-fit">
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
            <ul className="max-h-[560px] overflow-y-auto">
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
    </>
  )
}
