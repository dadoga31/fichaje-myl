import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CloudOff,
  Coffee,
  LogIn,
  LogOut,
  MapPin,
  Play,
} from 'lucide-react'
import type { EntryType, QueuedPunch, TimeEntry, WorkStatus } from '../lib/types'
import { ENTRY_LABEL } from '../lib/types'
import { computeDay, deriveStatus, formatDuration, formatTime } from '../lib/time'
import { useTicker } from '../hooks/useTicker'
import { Badge, MicroLabel, StatusPill, cx } from './ui'
import { HoldButton } from './HoldButton'
import { FlipClock } from './FlipClock'
import { ProgressRing } from './ProgressRing'

/**
 * PANTALLA DE FICHAJE
 *
 * Una pantalla, una tarea. El anillo es el centro de gravedad: dice de un
 * vistazo cuánto llevas de jornada, y su color —igual que la luz del fondo—
 * dice en qué estado estás antes de leer una sola palabra.
 */

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

const PRIMARY_ACTION: Record<WorkStatus, EntryType> = {
  off: 'clock_in',
  working: 'clock_out',
  break: 'break_end',
}

const PRIMARY_LABEL: Record<EntryType, string> = {
  clock_in: 'Entrar',
  clock_out: 'Salir',
  break_end: 'Reanudar',
  break_start: 'Pausa',
}

const ACTION_ICON: Record<EntryType, typeof LogIn> = {
  clock_in: LogIn,
  break_start: Coffee,
  break_end: Play,
  clock_out: LogOut,
}

const DOT_TONE: Record<EntryType, string> = {
  clock_in: 'bg-live',
  break_start: 'bg-rest',
  break_end: 'bg-violet-500',
  clock_out: 'bg-idle',
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
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const seenIds = useRef<Set<string> | null>(null)

  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null
  const status = deriveStatus(lastEntry)

  const { workedSeconds, breakSeconds } = useMemo(
    () => computeDay(entries, now),
    [entries, now],
  )

  const dailyTarget = (contractHours / 5) * 3600
  const progress = dailyTarget > 0 ? workedSeconds / dailyTarget : 0
  const remaining = Math.max(0, dailyTarget - workedSeconds)

  // Confirmación del fichaje: se resalta el asiento recién incorporado, que
  // dice lo mismo que un aviso —qué y a qué hora— sin tapar nada.
  useEffect(() => {
    const ids = new Set(entries.map((e) => e.id))
    if (seenIds.current === null) {
      seenIds.current = ids
      return
    }
    const added = entries.find((e) => !seenIds.current!.has(e.id))
    seenIds.current = ids
    if (!added) return
    setHighlightId(added.id)
    const timer = window.setTimeout(() => setHighlightId(null), 2200)
    return () => window.clearTimeout(timer)
  }, [entries])

  useEffect(() => {
    if (!error) return
    const id = window.setTimeout(() => setError(null), 7000)
    return () => window.clearTimeout(id)
  }, [error])

  const handle = useCallback(
    async (type: EntryType): Promise<boolean> => {
      if (pending) return false
      setPending(type)
      setError(null)
      const message = await onPunch(type)
      setPending(null)
      if (message) {
        setError(message)
        return false
      }
      return true
    },
    [onPunch, pending],
  )

  const primary = PRIMARY_ACTION[status]
  const PrimaryIcon = ACTION_ICON[primary]
  const secondary: EntryType | null =
    status === 'working' ? 'break_start' : status === 'break' ? 'clock_out' : null

  const hasWarnings = !online || queued.length > 0

  return (
    <section className="flex h-full w-full flex-col lg:h-auto">
      {/* --- Identidad y estado ----------------------------------------- */}
      <header className="rise glass-strong flex shrink-0 items-center justify-between gap-3 rounded-[20px] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cx(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] text-[13px] font-bold text-white',
              'bg-[linear-gradient(140deg,var(--color-violet-500),var(--color-violet-700))]',
              'shadow-[0_6px_16px_-4px_rgb(124_58_237/0.5)]',
            )}
          >
            {personName
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')}
          </span>
          <div className="min-w-0">
            <MicroLabel>Jornada de hoy</MicroLabel>
            <p className="mt-1 truncate text-[15px] font-bold tracking-tight text-ink">
              {personName}
            </p>
          </div>
        </div>
        <StatusPill status={status} pulse />
      </header>

      {/* --- Aviso previo (sin conexión / cola pendiente) ----------------- */}
      {hasWarnings && (
        <div className="mt-2.5 shrink-0 rounded-[12px] border border-[#e07a1b]/25 bg-rest-soft/70 px-3.5 py-2 backdrop-blur-md">
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[#8a4708]">
            <CloudOff size={14} className="mt-px shrink-0" />
            <span>
              {!online &&
                'Sin conexión: el fichaje se guarda con su hora real y se enviará al recuperar la red. '}
              {queued.length > 0 &&
                (queued.length === 1
                  ? '1 fichaje pendiente de sincronizar.'
                  : `${queued.length} fichajes pendientes de sincronizar.`)}
            </span>
          </p>
        </div>
      )}

      {/* --- El anillo: centro de gravedad de la pantalla ------------------ */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-3 tall:gap-5 tall:py-5">
        <div
          className="rise relative w-[min(72vw,15rem)] max-w-full tall:w-[min(76vw,17rem)]"
          style={{ animationDelay: '80ms' }}
        >
          <ProgressRing
            progress={progress}
            status={status}
            overtime={progress > 1}
            className="aspect-square w-full"
          >
            <MicroLabel>Trabajado hoy</MicroLabel>
            <FlipClock
              seconds={workedSeconds}
              muted={status === 'off' && workedSeconds === 0}
              className="mt-2 text-[clamp(2.1rem,10.5vw,3rem)]"
            />
            <p className="mt-1.5 max-w-[10rem] text-center text-[12px] leading-snug text-ink-soft">
              {status === 'off'
                ? entries.length === 0
                  ? 'Aún no has fichado'
                  : 'Jornada cerrada'
                : remaining > 0
                  ? `Quedan ${formatDuration(remaining)}`
                  : `+${formatDuration(workedSeconds - dailyTarget)} sobre tu jornada`}
            </p>
          </ProgressRing>
        </div>

        {/* Cifras de apoyo: discretas, en una sola línea. */}
        <div
          className="rise flex items-center gap-4 text-[12px] text-ink-soft"
          style={{ animationDelay: '160ms' }}
        >
          <span>
            Pausas <span className="tnum font-bold text-ink">{formatDuration(breakSeconds)}</span>
          </span>
          <span className="h-3 w-px bg-[color:var(--color-hairline)]" />
          <span>
            Objetivo <span className="tnum font-bold text-ink">{formatDuration(dailyTarget)}</span>
          </span>
          <span className="h-3 w-px bg-[color:var(--color-hairline)]" />
          <span className="tnum">
            {now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* --- Línea de tiempo del día ------------------------------------ */}
        <div className="rise w-full" style={{ animationDelay: '220ms' }}>
        {entries.length === 0 ? (
          <p className="px-1 pb-2.5 text-center text-[12px] text-ink-faint">
            Tus fichajes de hoy aparecerán aquí
          </p>
        ) : (
          <ol
            className={cx(
              'flex snap-x gap-2 overflow-x-auto px-4 pb-2.5',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              '[&>li:first-child]:ml-auto [&>li:last-child]:mr-auto',
              '[mask-image:linear-gradient(90deg,transparent,#000_1.25rem,#000_calc(100%-1.25rem),transparent)]',
            )}
          >
            {entries.map((entry) => (
              <li key={entry.id} className="snap-start">
                <span
                  className={cx(
                    'glass flex items-center gap-2 rounded-[12px] px-3 py-2 transition-all duration-500',
                    highlightId === entry.id &&
                      'ring-2 ring-violet-400 ring-offset-2 ring-offset-transparent',
                  )}
                >
                  <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', DOT_TONE[entry.entry_type])} />
                  <span className="tnum text-[13px] font-bold text-ink">
                    {formatTime(entry.event_at)}
                  </span>
                  <span className="text-[11px] whitespace-nowrap text-ink-soft">
                    {ENTRY_LABEL[entry.entry_type]}
                  </span>
                  {entry.origin === 'correction' && <Badge tone="warn">rectificado</Badge>}
                  {entry.origin === 'employee_offline' && <Badge tone="neutral">diferido</Badge>}
                </span>
              </li>
            ))}
          </ol>
        )}
        </div>
      </div>

      {/* --- Acciones ----------------------------------------------------- */}
      <footer className="rise relative shrink-0" style={{ animationDelay: '280ms' }}>
        {error && (
          <div
            role="alert"
            className="punch-toast absolute inset-x-0 bottom-full mb-2 flex items-start gap-2 rounded-[12px] border border-red-200 bg-red-50/90 px-3.5 py-2.5 text-[13px] text-red-800 backdrop-blur-md"
          >
            <AlertTriangle size={15} className="mt-px shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <div className={cx('grid gap-2.5', secondary ? 'grid-cols-[1.9fr_1fr]' : '')}>
          <HoldButton
            onHoldComplete={() => handle(primary)}
            disabled={pending !== null}
            tone="dark"
            label={PRIMARY_LABEL[primary]}
            icon={<PrimaryIcon size={20} strokeWidth={2.4} />}
            className={cx(
              'h-[3.75rem] rounded-[18px] px-4 text-[16px] tall:h-[4.25rem]',
              primary === 'clock_out'
                ? 'bg-[linear-gradient(135deg,#3b1d64,#1b0a33)] shadow-[0_10px_30px_-8px_rgb(27_10_51/0.55)]'
                : 'bg-[linear-gradient(135deg,var(--color-violet-600),var(--color-violet-500))] shadow-[0_10px_30px_-8px_rgb(124_58_237/0.6)]',
            )}
          >
            {PRIMARY_LABEL[primary]}
          </HoldButton>

          {secondary && (
            <HoldButton
              onHoldComplete={() => handle(secondary)}
              disabled={pending !== null}
              tone="light"
              label={secondary === 'break_start' ? 'Iniciar pausa' : 'Fichar salida'}
              icon={
                secondary === 'break_start' ? (
                  <Coffee size={18} strokeWidth={2.4} />
                ) : (
                  <LogOut size={18} strokeWidth={2.4} />
                )
              }
              className={cx(
                'glass h-[3.75rem] rounded-[18px] px-3 text-sm tall:h-[4.25rem]',
                secondary === 'break_start' ? 'text-[#8a4708]' : 'text-ink',
              )}
            >
              {secondary === 'break_start' ? 'Pausa' : 'Salir'}
            </HoldButton>
          )}
        </div>

        <p className="mt-2.5 mb-1 flex items-center justify-center gap-1.5 text-[11px] font-medium text-ink-soft">
          Mantén pulsado para confirmar
          {geoEnabled && (
            <>
              <span className="opacity-40">·</span>
              <MapPin size={11} /> con ubicación
            </>
          )}
        </p>
      </footer>
    </section>
  )
}
