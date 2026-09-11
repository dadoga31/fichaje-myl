import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Users } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { PageHeader } from '../components/Layout'
import {
  Button,
  MicroLabel,
  Notice,
  Panel,
  PanelHeader,
  Spinner,
  cx,
} from '../components/ui'
import { getDailySummaries, listProfiles, logAccess } from '../lib/api'
import type { PersonReport } from '../lib/exportPdf'
import type { Profile } from '../lib/types'
import { MONTHS_ES, formatDuration, toDecimalHours, toISODate } from '../lib/time'

export function ReportsPage() {
  const { session } = useSession()
  const actor = session!.profile
  const company = session!.company

  const [cursor, setCursor] = useState(() => new Date())
  const [people, setPeople] = useState<Profile[]>([])
  const [reports, setReports] = useState<PersonReport[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const range = useMemo(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    return { from: toISODate(from), to: toISODate(to) }
  }, [cursor])

  const load = useCallback(async () => {
    setLoading(true)
    const staff = (await listProfiles()).filter((p) => p.role !== 'inspector')
    setPeople(staff)

    const built = await Promise.all(
      staff.map(async (profile) => ({
        profile,
        summaries: await getDailySummaries(profile.id, range.from, range.to),
      })),
    )
    setReports(built)
    setSelected(new Set(staff.map((p) => p.id)))
    setLoading(false)
  }, [range.from, range.to])

  useEffect(() => {
    void load()
  }, [load])

  const chosen = reports.filter((r) => selected.has(r.profile.id))
  const totalSeconds = chosen.reduce(
    (acc, r) => acc + r.summaries.reduce((a, s) => a + s.worked_seconds, 0),
    0,
  )
  const withCorrections = chosen.filter((r) => r.summaries.some((s) => s.has_corrections)).length
  const withOpenDays = chosen.filter((r) => r.summaries.some((s) => s.is_open)).length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function exportAs(format: 'pdf' | 'xlsx') {
    if (chosen.length === 0) return
    setExporting(true)
    try {
      const payload = {
        company,
        people: chosen,
        year: cursor.getFullYear(),
        month: cursor.getMonth(),
        generatedBy: actor.full_name,
      }
      // Ambos generadores se cargan bajo demanda (ver nota en HistoryPage).
      if (format === 'pdf') {
        const { downloadMonthlyPdf } = await import('../lib/exportPdf')
        await downloadMonthlyPdf(payload)
      } else {
        const { downloadMonthlyExcel } = await import('../lib/exportExcel')
        downloadMonthlyExcel(payload)
      }

      // Queda constancia de quién ha exportado qué periodo y de quién.
      await logAccess({
        companyId: company.id,
        actorId: actor.id,
        actorRole: actor.role,
        action: format === 'pdf' ? 'export_pdf' : 'export_xlsx',
        subjectUserId: chosen.length === 1 ? chosen[0].profile.id : null,
        periodStart: range.from,
        periodEnd: range.to,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Informes mensuales"
        description="Genere el resumen oficial de jornada, individual o de toda la plantilla, listo para entregar a la persona trabajadora, a la RLT o a la Inspección."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Mes anterior"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
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
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              >
                <ChevronRight size={16} />
              </Button>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set(people.map((p) => p.id)))}
              >
                Seleccionar todo
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Ninguno
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 px-4 py-16 text-sm text-slate-500">
              <Spinner /> Calculando jornadas del mes…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="w-10 px-4 py-2.5">
                      <span className="sr-only">Incluir</span>
                    </th>
                    <th className="micro-label px-2 py-2.5">Persona</th>
                    <th className="micro-label px-2 py-2.5 text-right">Días</th>
                    <th className="micro-label px-2 py-2.5 text-right">Ordinarias</th>
                    <th className="micro-label px-2 py-2.5 text-right">Extra</th>
                    <th className="micro-label px-4 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => {
                    const total = report.summaries.reduce((a, s) => a + s.worked_seconds, 0)
                    const days = report.summaries.filter((s) => s.worked_seconds > 0).length
                    const reference = (report.profile.contract_hours / 5) * 3600 * days
                    const overtime = Math.max(0, total - reference)
                    const ordinary = Math.min(total, reference)
                    const isOn = selected.has(report.profile.id)

                    return (
                      <tr
                        key={report.profile.id}
                        className={cx(
                          'border-b border-slate-100 transition-colors last:border-b-0',
                          isOn ? 'bg-white' : 'bg-slate-50/60 text-slate-400',
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={isOn}
                            onChange={() => toggle(report.profile.id)}
                            aria-label={`Incluir a ${report.profile.full_name}`}
                            className="h-4 w-4 accent-violet-800"
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <p
                            className={cx(
                              'text-[13px] font-medium',
                              isOn ? 'text-slate-900' : 'text-slate-500',
                            )}
                          >
                            {report.profile.full_name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {report.profile.employee_number ?? '—'} ·{' '}
                            {report.profile.contract_hours} h/sem
                          </p>
                        </td>
                        <td className="tnum px-2 py-2.5 text-right text-[13px]">{days}</td>
                        <td className="tnum px-2 py-2.5 text-right text-[13px]">
                          {toDecimalHours(ordinary).toString().replace('.', ',')}
                        </td>
                        <td
                          className={cx(
                            'tnum px-2 py-2.5 text-right text-[13px]',
                            overtime > 0 && isOn && 'font-semibold text-violet-800',
                          )}
                        >
                          {overtime > 0
                            ? toDecimalHours(overtime).toString().replace('.', ',')
                            : '—'}
                        </td>
                        <td className="tnum px-4 py-2.5 text-right text-[13px] font-semibold">
                          {formatDuration(total)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* --- Panel de exportación -------------------------------------- */}
        <div className="flex flex-col gap-4">
          <Panel className="h-fit">
            <PanelHeader title="Exportar" hint={`${chosen.length} persona(s) seleccionada(s)`} />
            <div className="flex flex-col gap-3 px-4 py-4">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-slate-200 bg-slate-200">
                <div className="bg-white px-3 py-2.5">
                  <MicroLabel>Total del mes</MicroLabel>
                  <p className="tnum mt-1 text-lg font-semibold text-slate-900">
                    {formatDuration(totalSeconds)}
                  </p>
                </div>
                <div className="bg-white px-3 py-2.5">
                  <MicroLabel>Personas</MicroLabel>
                  <p className="tnum mt-1 text-lg font-semibold text-slate-900">
                    {chosen.length}
                  </p>
                </div>
              </div>

              <Button
                variant="primary"
                disabled={chosen.length === 0 || exporting}
                onClick={() => void exportAs('pdf')}
              >
                <FileDown size={15} />
                Descargar PDF normalizado
              </Button>

              <Button
                disabled={chosen.length === 0 || exporting}
                onClick={() => void exportAs('xlsx')}
              >
                <FileSpreadsheet size={15} />
                Descargar Excel (.xlsx)
              </Button>

              <p className="text-[11px] leading-relaxed text-slate-500">
                El PDF incluye una página por persona con el detalle diario, el total
                mensual y espacio para firma. El Excel añade una hoja de resumen y una
                hoja por trabajador.
              </p>
            </div>
          </Panel>

          {(withCorrections > 0 || withOpenDays > 0) && (
            <Notice tone="warn" icon={<Users size={15} />}>
              {withCorrections > 0 && (
                <>
                  {withCorrections} persona(s) con fichajes rectificados este mes; el informe
                  lo indica en la columna de incidencias.{' '}
                </>
              )}
              {withOpenDays > 0 && (
                <>{withOpenDays} persona(s) con jornadas sin fichaje de salida.</>
              )}
            </Notice>
          )}

          <Notice tone="info">
            Las descargas se generan en este dispositivo, sin enviar los datos de jornada a
            terceros. Cada exportación queda registrada con su autor y periodo.
          </Notice>
        </div>
      </div>
    </>
  )
}
