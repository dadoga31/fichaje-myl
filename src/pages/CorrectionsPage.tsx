import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, ClipboardCheck, Clock, Lock, X } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { PageHeader } from '../components/Layout'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Notice,
  Panel,
  PanelHeader,
  Spinner,
  inputClass,
  textareaClass,
} from '../components/ui'
import { createRequest, getEntries, getRequests } from '../lib/api'
import { ENTRY_LABEL, type CorrectionRequest, type EntryType, type TimeEntry } from '../lib/types'
import { formatDate, formatTime, toISODate } from '../lib/time'

const STATUS_META: Record<
  CorrectionRequest['status'],
  { label: string; tone: 'neutral' | 'warn' | 'ok' | 'danger' }
> = {
  pending: { label: 'Pendiente', tone: 'warn' },
  approved: { label: 'Aprobada', tone: 'ok' },
  rejected: { label: 'Rechazada', tone: 'danger' },
  cancelled: { label: 'Retirada', tone: 'neutral' },
}

export function CorrectionsPage() {
  const { session } = useSession()
  const profile = session!.profile
  const company = session!.company

  const [requests, setRequests] = useState<CorrectionRequest[]>([])
  const [recent, setRecent] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const [mode, setMode] = useState<'add' | 'fix'>('add')
  const [targetId, setTargetId] = useState('')
  const [entryType, setEntryType] = useState<EntryType>('clock_in')
  const [date, setDate] = useState(() => toISODate(new Date()))
  const [time, setTime] = useState('09:00')
  const [reason, setReason] = useState('')

  const range = useMemo(() => {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - 45)
    return { from: toISODate(from), to: toISODate(to) }
  }, [])

  const load = useCallback(async () => {
    const [reqs, entries] = await Promise.all([
      getRequests({ userId: profile.id }),
      getEntries(profile.id, range.from, range.to),
    ])
    setRequests(reqs)
    setRecent(entries.reverse())
    setLoading(false)
  }, [profile.id, range.from, range.to])

  useEffect(() => {
    void load()
  }, [load])

  // Al elegir un fichaje concreto, el formulario se rellena con sus valores:
  // la persona solo tiene que ajustar la hora que estuvo mal.
  useEffect(() => {
    if (mode !== 'fix' || !targetId) return
    const entry = recent.find((e) => e.id === targetId)
    if (!entry) return
    const at = new Date(entry.event_at)
    setEntryType(entry.entry_type)
    setDate(entry.work_date)
    setTime(`${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`)
  }, [mode, targetId, recent])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (reason.trim().length < 10) {
        throw new Error('Explique el motivo con algo más de detalle (mínimo 10 caracteres).')
      }
      const eventAt = new Date(`${date}T${time}:00`)
      if (Number.isNaN(eventAt.getTime())) throw new Error('La fecha y la hora no son válidas.')
      if (eventAt.getTime() > Date.now() + 60_000) {
        throw new Error('No puede solicitar un fichaje en el futuro.')
      }

      await createRequest(
        profile.id,
        {
          target_entry_id: mode === 'fix' && targetId ? targetId : null,
          requested_type: entryType,
          requested_event_at: eventAt.toISOString(),
          work_date: date,
          reason: reason.trim(),
        },
        company.id,
      )

      setReason('')
      setTargetId('')
      setDone(true)
      await load()
      window.setTimeout(() => setDone(false), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido enviar la solicitud.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Solicitudes de corrección"
        description="Los fichajes no se pueden editar ni borrar. Si hay un error, solicite su rectificación: administración la revisará y quedará registrada con su motivo."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* --- Formulario ------------------------------------------------ */}
        <Panel className="h-fit">
          <PanelHeader title="Nueva solicitud" />

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 py-4">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-slate-200 bg-slate-200">
              {(
                [
                  ['add', 'Falta un fichaje'],
                  ['fix', 'Corregir uno existente'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMode(value)
                    setTargetId('')
                  }}
                  className={
                    'px-3 py-2 text-[13px] font-medium transition-colors ' +
                    (mode === value
                      ? 'bg-violet-800 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50')
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === 'fix' && (
              <Field
                label="Fichaje a rectificar"
                htmlFor="target"
                required
                hint="Solo se muestran sus fichajes de los últimos 45 días."
              >
                <select
                  id="target"
                  required
                  className={inputClass}
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">Seleccione un fichaje…</option>
                  {recent.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {formatDate(entry.work_date)} · {formatTime(entry.event_at)} ·{' '}
                      {ENTRY_LABEL[entry.entry_type]}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Tipo de fichaje" htmlFor="type" required>
              <select
                id="type"
                className={inputClass}
                value={entryType}
                onChange={(e) => setEntryType(e.target.value as EntryType)}
              >
                {(Object.keys(ENTRY_LABEL) as EntryType[]).map((type) => (
                  <option key={type} value={type}>
                    {ENTRY_LABEL[type]}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha" htmlFor="date" required>
                <input
                  id="date"
                  type="date"
                  required
                  max={toISODate(new Date())}
                  className={inputClass}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Hora real" htmlFor="time" required>
                <input
                  id="time"
                  type="time"
                  required
                  className={inputClass}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </Field>
            </div>

            <Field
              label="Motivo"
              htmlFor="reason"
              required
              hint="Este texto se conserva junto al fichaje rectificado como justificación permanente."
            >
              <textarea
                id="reason"
                required
                minLength={10}
                className={textareaClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej.: olvidé fichar la salida porque me avisaron de una incidencia al terminar; salí a las 17:30."
              />
            </Field>

            {error && <Notice tone="error">{error}</Notice>}
            {done && (
              <Notice tone="ok" icon={<Check size={15} />}>
                Solicitud enviada. Administración la revisará y recibirá el resultado aquí.
              </Notice>
            )}

            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Enviando…' : 'Enviar solicitud'}
            </Button>

            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
              <Lock size={13} className="mt-px shrink-0 text-slate-400" />
              El fichaje original nunca se borra. Si se aprueba, se añade un asiento
              nuevo que lo sustituye y ambos quedan almacenados.
            </p>
          </form>
        </Panel>

        {/* --- Historial de solicitudes ---------------------------------- */}
        <Panel>
          <PanelHeader title="Mis solicitudes" hint={`${requests.length} en total`} />

          {loading ? (
            <div className="flex items-center gap-2 px-4 py-12 text-sm text-slate-500">
              <Spinner /> Cargando…
            </div>
          ) : requests.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={22} />}
              title="Sin solicitudes"
              description="Cuando pida una corrección, aparecerá aquí con su estado de aprobación."
            />
          ) : (
            <ul>
              {requests.map((request) => {
                const meta = STATUS_META[request.status]
                return (
                  <li
                    key={request.id}
                    className="border-b border-slate-100 px-4 py-3.5 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="text-[13px] font-medium text-slate-900">
                        {ENTRY_LABEL[request.requested_type]} ·{' '}
                        {formatDate(request.work_date)} a las{' '}
                        <span className="tnum">{formatTime(request.requested_event_at)}</span>
                      </span>
                      <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
                        <Clock size={11} />
                        {formatDate(request.created_at)}
                      </span>
                    </div>

                    <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
                      {request.reason}
                    </p>

                    {request.review_note && (
                      <p className="mt-2 rounded-[3px] border-l-2 border-slate-300 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600">
                        <span className="font-medium text-slate-700">
                          Respuesta de administración:
                        </span>{' '}
                        {request.review_note}
                      </p>
                    )}

                    {request.status === 'rejected' && !request.review_note && (
                      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-red-700">
                        <X size={12} /> Solicitud rechazada.
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
