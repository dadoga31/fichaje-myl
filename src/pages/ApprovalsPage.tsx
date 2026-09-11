import { useCallback, useEffect, useState } from 'react'
import { Check, Inbox, ShieldAlert, X } from 'lucide-react'
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
  textareaClass,
} from '../components/ui'
import {
  getCorrectionAudits,
  getRequests,
  reviewRequest,
  subscribeToChanges,
} from '../lib/api'
import { ENTRY_LABEL, type CorrectionRequest, type TimeEntryAudit } from '../lib/types'
import { formatDate, formatTime } from '../lib/time'

export function ApprovalsPage() {
  const { session } = useSession()
  const reviewer = session!.profile

  const [requests, setRequests] = useState<CorrectionRequest[]>([])
  const [audits, setAudits] = useState<TimeEntryAudit[]>([])
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [reqs, auditList] = await Promise.all([
      getRequests({ companyWide: true }),
      getCorrectionAudits(),
    ])
    setRequests(reqs)
    setAudits(auditList)
    setLoading(false)
  }, [])

  // Una solicitud nueva aparece en la bandeja sin recargar.
  useEffect(() => {
    void load()
    return subscribeToChanges(['correction_requests', 'time_entries'], () => void load())
  }, [load])

  async function resolve(request: CorrectionRequest, approve: boolean) {
    setBusyId(request.id)
    setError(null)
    try {
      await reviewRequest(reviewer.id, request.id, approve, notes[request.id]?.trim() || undefined)
      setNotes((prev) => ({ ...prev, [request.id]: '' }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido resolver la solicitud.')
    } finally {
      setBusyId(null)
    }
  }

  const pending = requests.filter((r) => r.status === 'pending')
  const resolved = requests.filter((r) => r.status !== 'pending')

  return (
    <>
      <PageHeader
        title="Aprobaciones y auditoría"
        description="Revise las solicitudes de rectificación de la plantilla. Aprobar no modifica el fichaje original: genera un asiento nuevo y deja constancia de quién, cuándo y por qué."
      />

      {error && (
        <div className="mb-4">
          <Notice tone="error" icon={<ShieldAlert size={15} />}>
            {error}
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          {/* --- Bandeja de pendientes ---------------------------------- */}
          <Panel>
            <PanelHeader
              title="Pendientes de resolver"
              hint={pending.length === 0 ? 'Nada pendiente' : `${pending.length} solicitud(es)`}
            />

            {loading ? (
              <div className="flex items-center gap-2 px-4 py-12 text-sm text-slate-500">
                <Spinner /> Cargando…
              </div>
            ) : pending.length === 0 ? (
              <EmptyState
                icon={<Inbox size={22} />}
                title="Bandeja vacía"
                description="No hay solicitudes de corrección esperando revisión."
              />
            ) : (
              <ul>
                {pending.map((request) => {
                  const isOwn = request.user_id === reviewer.id
                  return (
                    <li
                      key={request.id}
                      className="border-b border-slate-100 px-4 py-4 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-900">
                            {request.user_name ?? 'Persona trabajadora'}
                          </p>
                          <p className="mt-0.5 text-[12px] text-slate-500">
                            Solicitado el {formatDate(request.created_at)}
                          </p>
                        </div>
                        <Badge tone={request.target_entry_id ? 'warn' : 'brand'}>
                          {request.target_entry_id ? 'Rectificar fichaje' : 'Añadir fichaje'}
                        </Badge>
                      </div>

                      <div className="mt-3 rounded-[4px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <MicroLabel>Cambio solicitado</MicroLabel>
                        <p className="mt-1 text-[13px] text-slate-800">
                          {ENTRY_LABEL[request.requested_type]} del{' '}
                          {formatDate(request.work_date)} a las{' '}
                          <span className="tnum font-semibold">
                            {formatTime(request.requested_event_at)}
                          </span>
                        </p>
                        <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
                          <span className="font-medium text-slate-700">Motivo alegado:</span>{' '}
                          {request.reason}
                        </p>
                      </div>

                      {isOwn ? (
                        <div className="mt-3">
                          <Notice tone="warn" icon={<ShieldAlert size={15} />}>
                            Es su propia solicitud. Debe resolverla otra persona con permisos
                            de administración.
                          </Notice>
                        </div>
                      ) : (
                        <>
                          <textarea
                            className={cx(textareaClass, 'mt-3 min-h-[62px] text-[13px]')}
                            placeholder="Nota de administración (opcional): en qué se ha basado la decisión."
                            value={notes[request.id] ?? ''}
                            onChange={(e) =>
                              setNotes((prev) => ({ ...prev, [request.id]: e.target.value }))
                            }
                          />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={busyId === request.id}
                              onClick={() => void resolve(request, true)}
                            >
                              <Check size={14} />
                              Aprobar y rectificar
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={busyId === request.id}
                              onClick={() => void resolve(request, false)}
                            >
                              <X size={14} />
                              Rechazar
                            </Button>
                          </div>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          {/* --- Resueltas ---------------------------------------------- */}
          {resolved.length > 0 && (
            <Panel>
              <PanelHeader title="Resueltas" hint={`${resolved.length} solicitud(es)`} />
              <ul>
                {resolved.slice(0, 20).map((request) => (
                  <li
                    key={request.id}
                    className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-[13px] last:border-b-0"
                  >
                    <Badge tone={request.status === 'approved' ? 'ok' : 'danger'}>
                      {request.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                    </Badge>
                    <span className="font-medium text-slate-900">{request.user_name}</span>
                    <span className="text-slate-500">
                      {ENTRY_LABEL[request.requested_type]} · {formatDate(request.work_date)}{' '}
                      <span className="tnum">{formatTime(request.requested_event_at)}</span>
                    </span>
                    <span className="ml-auto text-[11px] text-slate-400">
                      {request.reviewed_at ? formatDate(request.reviewed_at) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        {/* --- Registro de auditoría ------------------------------------ */}
        <Panel className="h-fit">
          <PanelHeader
            title="Registro de auditoría"
            hint="Todas las rectificaciones practicadas"
          />
          {audits.length === 0 ? (
            <EmptyState
              title="Sin rectificaciones"
              description="Ningún fichaje ha sido modificado. Cuando ocurra, aquí constará la hora original, la nueva, el motivo y el autor."
            />
          ) : (
            <ul className="max-h-[560px] overflow-y-auto">
              {audits.map((audit) => (
                <li
                  key={audit.id}
                  className="border-b border-slate-100 px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={audit.action === 'annul' ? 'danger' : 'warn'}>
                      {audit.action === 'annul' ? 'Anulación' : 'Rectificación'}
                    </Badge>
                    <span className="ml-auto text-[10px] text-slate-400">
                      {new Date(audit.created_at).toLocaleString('es-ES')}
                    </span>
                  </div>

                  <p className="tnum mt-1.5 text-[12px] text-slate-800">
                    {audit.old_event_at ? (
                      <>
                        {formatTime(audit.old_event_at)} → {formatTime(audit.new_event_at)}
                      </>
                    ) : (
                      <>Fichaje añadido: {formatTime(audit.new_event_at)}</>
                    )}
                  </p>

                  {audit.reason && (
                    <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-slate-500">
                      {audit.reason}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-slate-400">
                    Autorizado por {audit.actor_name ?? '—'}
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
