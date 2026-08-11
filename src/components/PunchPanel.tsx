import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CloudOff,
  Coffee,
  LogIn,
  LogOut,
  MapPin,
  Play,
  ShieldCheck,
} from 'lucide-react'
import type { EntryType, QueuedPunch, TimeEntry, WorkStatus } from '../lib/types'
import { ENTRY_LABEL } from '../lib/types'
import { computeDay, deriveStatus, formatClock, formatDuration, formatTime } from '../lib/time'
import { useTicker } from '../hooks/useTicker'
import { Badge, MicroLabel, Notice, Panel, StatusPill, cx } from './ui'

interface PunchPanelProps {
  personName: string
  entries: TimeEntry[]
  contractHours: number
  online: boolean
  queued: QueuedPunch[]
  geoEnabled: boolean
  /** Devuelve el mensaje de error, o null si el fichaje se registró bien. */
  onPunch: (type: EntryType) => Promise<string | null>
}

/** Acción principal según el estado: una sola decisión evidente en pantalla. */
const PRIMARY_ACTION: Record<WorkStatus, EntryType> = {
  off: 'clock_in',
  working: 'clock_out',
  break: 'break_end',
}

const ACTION_ICON: Record<EntryType, typeof LogIn> = {
  clock_in: LogIn,
  break_start: Coffee,
  break_end: Play,
  clock_out: LogOut,
}

export function PunchPanel({
  personName,
  entries,
  contractHours,
  online,
  queued,
  geoEnabled,
  onPunch,
}: PunchPanelProps) {
  const now = useTicker(1000)
  const [pending, setPending] = useState<EntryType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null
  const status = deriveStatus(lastEntry)

  const { workedSeconds, breakSeconds } = useMemo(
    () => computeDay(entries, now),
    [entries, now],
  )

  const dailyTarget = (contractHours / 5) * 3600
  const progress = dailyTarget > 0 ? Math.min(1, workedSeconds / dailyTarget) : 0
  const remaining = Math.max(0, dailyTarget - workedSeconds)

  useEffect(() => {
    if (!flash) return
    const id = window.setTimeout(() => setFlash(null), 4000)
    return () => window.clearTimeout(id)
  }, [flash])

  const handle = useCallback(
    async (type: EntryType) => {
      if (pending) return
      setPending(type)
      setError(null)
      const message = await onPunch(type)
      setPending(null)
      if (message) setError(message)
      else setFlash(`${ENTRY_LABEL[type]} registrada a las ${formatTime(new Date().toISOString())}`)
    },
    [onPunch, pending],
  )

  const primary = PRIMARY_ACTION[status]
  const PrimaryIcon = ACTION_ICON[primary]
  // Desde "en jornada" y "en pausa" hay una segunda salida posible.
  const secondary: EntryType | null =
    status === 'working' ? 'break_start' : status === 'break' ? 'clock_out' : null

  return (
    <Panel className="overflow-hidden">
      {/* --- Cabecera: identidad y estado ------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <MicroLabel>Jornada de hoy</MicroLabel>
          <p className="mt-1 truncate text-sm font-semibold text-slate-900">{personName}</p>
        </div>
        <StatusPill status={status} pulse />
      </div>

      {/* --- Reloj y contador ------------------------------------------- */}
      <div className="grid-backdrop border-b border-slate-200 px-4 py-6 sm:px-5 sm:py-7">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <MicroLabel>Tiempo trabajado</MicroLabel>
            <p
              className={cx(
                'tnum mt-2 text-[3.25rem] leading-none font-semibold tracking-tight sm:text-6xl',
                status === 'off' ? 'text-slate-400' : 'text-slate-900',
              )}
            >
              {formatClock(workedSeconds)}
            </p>
            <p className="mt-2 text-[13px] text-slate-600">
              {status === 'off'
                ? entries.length === 0
                  ? 'Sin fichajes registrados hoy.'
                  : 'Jornada cerrada.'
                : remaining > 0
                  ? `Quedan ${formatDuration(remaining)} para completar la jornada de referencia.`
                  : `Jornada de referencia superada en ${formatDuration(workedSeconds - dailyTarget)}.`}
            </p>
          </div>

          <div className="text-left sm:text-right">
            <MicroLabel>Hora actual</MicroLabel>
            <p className="tnum mt-2 text-3xl font-medium tracking-tight text-slate-700">
              {now.toLocaleTimeString('es-ES', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {now.toLocaleDateString('es-ES', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
          </div>
        </div>

        {/* Progreso: barra plana, sin gradientes ni brillos. */}
        <div className="mt-6">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="Progreso de la jornada"
          >
            <div
              className={cx(
                'h-full rounded-full transition-[width] duration-700 ease-out',
                workedSeconds > dailyTarget ? 'bg-brand-600' : 'bg-brand-800',
              )}
              style={{ width: `${Math.max(progress * 100, workedSeconds > 0 ? 2 : 0)}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-500">
            <span>
              Pausas hoy:{' '}
              <span className="tnum font-medium text-slate-700">
                {formatDuration(breakSeconds)}
              </span>
            </span>
            <span className="tnum">
              {formatDuration(workedSeconds)} / {formatDuration(dailyTarget)}
            </span>
          </div>
        </div>
      </div>

      {/* --- Avisos ------------------------------------------------------ */}
      {(error || flash || !online || queued.length > 0) && (
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
          {error && (
            <Notice tone="error" icon={<AlertTriangle size={15} />}>
              {error}
            </Notice>
          )}
          {flash && !error && (
            <Notice tone="ok" icon={<ShieldCheck size={15} />}>
              {flash}
            </Notice>
          )}
          {!online && (
            <Notice tone="warn" icon={<CloudOff size={15} />}>
              Sin conexión. Puede fichar igualmente: se guarda con la hora real en este
              dispositivo y se envía al servidor en cuanto vuelva la red.
            </Notice>
          )}
          {queued.length > 0 && (
            <Notice tone="warn" icon={<CloudOff size={15} />}>
              {queued.length === 1
                ? '1 fichaje pendiente de sincronizar.'
                : `${queued.length} fichajes pendientes de sincronizar.`}{' '}
              Se enviarán automáticamente al recuperar la conexión.
            </Notice>
          )}
        </div>
      )}

      {/* --- Acciones ---------------------------------------------------- */}
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <div className={cx('grid gap-2.5', secondary ? 'sm:grid-cols-[2fr_1fr]' : '')}>
          <button
            type="button"
            onClick={() => void handle(primary)}
            disabled={pending !== null}
            className={cx(
              'group relative flex h-16 items-center justify-center gap-3 rounded-[6px] px-6',
              'text-base font-semibold text-white transition-all duration-150',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
              'disabled:cursor-not-allowed disabled:opacity-60',
              primary === 'clock_out'
                ? 'bg-slate-900 hover:bg-slate-800 active:bg-black'
                : 'bg-brand-800 hover:bg-brand-700 active:bg-brand-900',
              'shadow-[0_1px_0_0_rgba(15,23,42,0.12)] active:translate-y-px',
            )}
          >
            {pending === primary ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <PrimaryIcon size={20} strokeWidth={2.2} />
            )}
            <span>
              {primary === 'clock_in' && 'Fichar entrada'}
              {primary === 'clock_out' && 'Fichar salida'}
              {primary === 'break_end' && 'Reanudar jornada'}
            </span>
          </button>

          {secondary && (
            <button
              type="button"
              onClick={() => void handle(secondary)}
              disabled={pending !== null}
              className={cx(
                'flex h-16 items-center justify-center gap-2.5 rounded-[6px] border px-5',
                'text-sm font-semibold transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
                'disabled:cursor-not-allowed disabled:opacity-60',
                secondary === 'break_start'
                  ? 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100 active:bg-orange-200'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 active:bg-slate-100',
              )}
            >
              {pending === secondary ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
              ) : secondary === 'break_start' ? (
                <Coffee size={18} strokeWidth={2.2} />
              ) : (
                <LogOut size={18} strokeWidth={2.2} />
              )}
              {secondary === 'break_start' ? 'Pausa' : 'Salida'}
            </button>
          )}
        </div>

        {geoEnabled && (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
            <MapPin size={12} />
            Su empresa registra la ubicación al fichar y usted lo ha autorizado.
          </p>
        )}
      </div>

      {/* --- Fichajes del día -------------------------------------------- */}
      <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3 sm:px-5">
        <MicroLabel>Fichajes de hoy</MicroLabel>
        {entries.length === 0 ? (
          <p className="mt-2 text-[13px] text-slate-500">
            Todavía no ha registrado ningún fichaje hoy.
          </p>
        ) : (
          <ol className="mt-2.5 flex flex-wrap gap-1.5">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-[4px] border bg-white px-2 py-1 text-xs',
                    entry.entry_type === 'clock_in' && 'border-emerald-200 text-emerald-800',
                    entry.entry_type === 'clock_out' && 'border-slate-300 text-slate-700',
                    entry.entry_type === 'break_start' && 'border-orange-200 text-orange-800',
                    entry.entry_type === 'break_end' && 'border-brand-200 text-brand-800',
                  )}
                >
                  <span className="tnum font-semibold">{formatTime(entry.event_at)}</span>
                  <span className="text-slate-500">{ENTRY_LABEL[entry.entry_type]}</span>
                  {entry.origin === 'correction' && <Badge tone="warn">rectificado</Badge>}
                  {entry.origin === 'employee_offline' && <Badge tone="neutral">diferido</Badge>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  )
}
