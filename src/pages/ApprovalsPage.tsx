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
  Pager,
  Panel,
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
import { paginar, useFitRows } from '../hooks/useFitRows'

type Pestana = 'pending' | 'resolved' | 'audit'

const PESTANAS: Array<{ id: Pestana; label: string }> = [
  { id: 'pending', label: 'Pendientes' },
  { id: 'resolved', label: 'Resueltas' },
  { id: 'audit', label: 'Auditoría' },
]

export function ApprovalsPage() {
  const { session } = useSession()
  const reviewer = session!.profile

  const [requests, setRequests] = useState<CorrectionRequest[]>([])
  const [audits, setAudits] = useState<TimeEntryAudit[]>([])
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Pestana>('pending')
  const [page, setPage] = useState(0)

  // Una solicitud pendiente es una tarjeta alta (datos + motivo + acciones);
  // una resuelta o un asiento de auditoría es una fila. De ahí dos medidas.
  const [cajaRef, filasAltas] = useFitRows(268)
  const [filaRef, filasBajas] = useFitRows(66)
  const [auditRef, filasAudit] = useFitRows(78)

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

  const pendientes = paginar(pending, page, filasAltas)
  const resueltas = paginar(resolved, page, filasBajas)
  const auditoria = paginar(audits, page, filasAudit)

  useEffect(() => {
    setPage(0)
  }, [tab])

  /* --- Bandeja de pendientes ----------------------------------------- */
  const vistaPendientes = (
    <div ref={cajaRef} className="min-h-0 flex-1 overflow-hidden">
      {loading ? (
        <div className="flex h-full items-center justify-center gap-2 text-[13px] text-ink-soft">
          <Spinner /> Cargando…
        </div>
      ) : pending.length === 0 ? (
        <EmptyState
          icon={<Inbox size={18} />}
          title="Bandeja vacía"
          description="No hay solicitudes de corrección esperando revisión."
        />
      ) : (
        <ul>
          {pendientes.slice.map((request) => {
            const isOwn = request.user_id === reviewer.id
            return (
              <li
                key={request.id}
                className="border-b border-[color:var(--color-hairline)] px-3.5 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-ink">
                      {request.user_name ?? 'Persona trabajadora'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-soft">
                      Solicitado el {formatDate(request.created_at)}
                    </p>
                  </div>
                  <Badge tone={request.target_entry_id ? 'warn' : 'brand'}>
                    {request.target_entry_id ? 'Rectificar' : 'Añadir'}
                  </Badge>
                </div>

                <div className="mt-2 rounded-[6px] border border-[color:var(--color-hairline)] bg-slate-50 px-2.5 py-2">
                  <MicroLabel>Cambio solicitado</MicroLabel>
                  <p className="mt-0.5 text-[12.5px] text-ink">
                    {ENTRY_LABEL[request.requested_type]} del {formatDate(request.work_date)} a las{' '}
                    <span className="tnum font-semibold">
                      {formatTime(request.requested_event_at)}
                    </span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-soft">
                    <span className="font-medium text-ink">Motivo:</span> {request.reason}
                  </p>
                </div>

                {isOwn ? (
                  <div className="mt-2">
                    <Notice tone="warn" icon={<ShieldAlert size={14} />}>
                      Es su propia solicitud. Debe resolverla otra persona con permisos de
                      administración.
                    </Notice>
                  </div>
                ) : (
                  <>
                    <textarea
                      className={cx(textareaClass, 'mt-2 min-h-[46px] text-[12.5px]')}
                      placeholder="Nota de administración (opcional)."
                      value={notes[request.id] ?? ''}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [request.id]: e.target.value }))
                      }
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busyId === request.id}
                        onClick={() => void resolve(request, true)}
                      >
                        <Check size={13} />
                        Aprobar
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busyId === request.id}
                        onClick={() => void resolve(request, false)}
                      >
                        <X size={13} />
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
    </div>
  )

  /* --- Resueltas ------------------------------------------------------ */
  const vistaResueltas = (
    <div ref={filaRef} className="min-h-0 flex-1 overflow-hidden">
      {resolved.length === 0 ? (
        <EmptyState title="Nada resuelto todavía" />
      ) : (
        <ul>
          {resueltas.slice.map((request) => (
            <li
              key={request.id}
              className="flex h-[66px] flex-col justify-center gap-1 border-b border-[color:var(--color-hairline)] px-3.5 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <Badge tone={request.status === 'approved' ? 'ok' : 'danger'}>
                  {request.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                </Badge>
                <span className="truncate text-[12.5px] font-medium text-ink">
                  {request.user_name}
                </span>
                <span className="tnum ml-auto shrink-0 text-[10.5px] text-ink-faint">
                  {request.reviewed_at ? formatDate(request.reviewed_at) : ''}
                </span>
              </div>
              <p className="truncate text-[11.5px] text-ink-soft">
                {ENTRY_LABEL[request.requested_type]} · {formatDate(request.work_date)}{' '}
                <span className="tnum">{formatTime(request.requested_event_at)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  /* --- Registro de auditoría ------------------------------------------ */
  const vistaAuditoria = (
    <div ref={auditRef} className="min-h-0 flex-1 overflow-hidden">
      {audits.length === 0 ? (
        <EmptyState
          title="Sin rectificaciones"
          description="Ningún fichaje ha sido modificado. Cuando ocurra, constará aquí la hora original, la nueva, el motivo y el autor."
        />
      ) : (
        <ul>
          {auditoria.slice.map((audit) => (
            <li
              key={audit.id}
              className="flex h-[78px] flex-col justify-center border-b border-[color:var(--color-hairline)] px-3.5 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <Badge tone={audit.action === 'annul' ? 'danger' : 'warn'}>
                  {audit.action === 'annul' ? 'Anulación' : 'Rectificación'}
                </Badge>
                <span className="tnum ml-auto text-[10px] text-ink-faint">
                  {new Date(audit.created_at).toLocaleDateString('es-ES')}
                </span>
              </div>
              <p className="tnum mt-1 text-[12px] text-ink">
                {audit.old_event_at ? (
                  <>
                    {formatTime(audit.old_event_at)} → {formatTime(audit.new_event_at)}
                  </>
                ) : (
                  <>Añadido: {formatTime(audit.new_event_at)}</>
                )}
                <span className="ml-2 text-[10.5px] text-ink-faint">
                  por {audit.actor_name ?? '—'}
                </span>
              </p>
              {audit.reason && (
                <p className="mt-0.5 truncate text-[11px] text-ink-soft">{audit.reason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const activa =
    tab === 'pending' ? pendientes : tab === 'resolved' ? resueltas : auditoria
  const totalActiva =
    tab === 'pending' ? pending.length : tab === 'resolved' ? resolved.length : audits.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Aprobaciones"
        description="Aprobar no modifica el fichaje original: genera un asiento nuevo."
      />

      {error && (
        <div className="mb-2 shrink-0">
          <Notice tone="error" icon={<ShieldAlert size={14} />}>
            {error}
          </Notice>
        </div>
      )}

      {/* Pestañas en móvil: tres paneles apilados no caben en una pantalla,
          y apilarlos obligaba a desplazarse para llegar a la auditoría. */}
      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden lg:hidden">
        <div className="flex shrink-0 gap-1 border-b border-[color:var(--color-hairline)] px-2 py-1.5">
          {PESTANAS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cx(
                'flex-1 rounded-[6px] px-2 py-1.5 text-[12px] font-medium transition-colors',
                tab === t.id ? 'bg-violet-700 text-white' : 'text-ink-soft hover:bg-slate-100',
              )}
            >
              {t.label}
              {t.id === 'pending' && pending.length > 0 && (
                <span className="ml-1 tnum">({pending.length})</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'pending' ? vistaPendientes : tab === 'resolved' ? vistaResueltas : vistaAuditoria}

        <div className="shrink-0 border-t border-[color:var(--color-hairline)] px-3 py-2">
          <Pager
            page={activa.page}
            pages={activa.pages}
            total={totalActiva}
            onPage={setPage}
            unit={tab === 'audit' ? 'asientos' : 'solicitudes'}
          />
        </div>
      </Panel>

      {/* Escritorio: hay sitio para la bandeja y la auditoría a la vez. */}
      <div className="hidden min-h-0 flex-1 gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 gap-1 border-b border-[color:var(--color-hairline)] px-2 py-1.5">
            {PESTANAS.filter((t) => t.id !== 'audit').map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cx(
                  'rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors',
                  tab === t.id ? 'bg-violet-700 text-white' : 'text-ink-soft hover:bg-slate-100',
                )}
              >
                {t.label}
                {t.id === 'pending' && pending.length > 0 && (
                  <span className="ml-1 tnum">({pending.length})</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'resolved' ? vistaResueltas : vistaPendientes}

          <div className="shrink-0 border-t border-[color:var(--color-hairline)] px-3 py-2">
            <Pager
              page={tab === 'resolved' ? resueltas.page : pendientes.page}
              pages={tab === 'resolved' ? resueltas.pages : pendientes.pages}
              total={tab === 'resolved' ? resolved.length : pending.length}
              onPage={setPage}
              unit="solicitudes"
            />
          </div>
        </Panel>

        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-[color:var(--color-hairline)] px-4 py-2.5">
            <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">
              Registro de auditoría
            </h2>
            <p className="mt-0.5 text-[11.5px] text-ink-soft">
              Todas las rectificaciones practicadas
            </p>
          </div>
          {vistaAuditoria}
          <div className="shrink-0 border-t border-[color:var(--color-hairline)] px-3 py-2">
            <Pager
              page={auditoria.page}
              pages={auditoria.pages}
              total={audits.length}
              onPage={setPage}
              unit="asientos"
            />
          </div>
        </Panel>
      </div>
    </div>
  )
}
