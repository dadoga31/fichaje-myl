import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CloudOff, Coffee, LogIn, LogOut, MapPin, Play } from 'lucide-react'
import type { EntryType, QueuedPunch, TimeEntry, WorkStatus } from '../lib/types'
import { ENTRY_LABEL } from '../lib/types'
import { computeDay, deriveStatus, formatDuration, formatTime } from '../lib/time'
import { useTicker } from '../hooks/useTicker'
import { MicroLabel, StatusPill, cx } from './ui'
import { PunchDial, PunchPill } from './PunchDial'
import { FlipClock } from './FlipClock'

/**
 * PANTALLA DE FICHAJE
 *
 * Una pantalla, una tarea, sin desplazamiento. Tres bloques de altura fija
 * —identidad, dato y acción— y un cuarto flexible en medio que absorbe lo que
 * sobre o falte. Quien ficha lo hace de pie, con prisa y a menudo con una sola
 * mano: cualquier cosa que obligue a desplazarse antes de poder pulsar es un
 * fallo de diseño, no un detalle.
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

  const { workedSeconds, breakSeconds } = useMemo(() => computeDay(entries, now), [entries, now])

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
    const timer = window.setTimeout(() => setHighlightId(null), 2400)
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
    <section className="flex h-full w-full flex-col gap-3">
      {/* --- Identidad y estado ------------------------------------------ */}
      <header className="surface flex shrink-0 items-center justify-between gap-3 rounded-[12px] px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-violet-700 text-[12px] font-semibold text-white">
            {personName
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')}
          </span>
          <div className="min-w-0">
            <MicroLabel>Jornada de hoy</MicroLabel>
            <p className="mt-1 truncate text-[14px] font-semibold tracking-tight text-ink">
              {personName}
            </p>
          </div>
        </div>
        <StatusPill status={status} pulse />
      </header>

      {/* --- Aviso: sin conexión o cola pendiente -------------------------- */}
      {hasWarnings && (
        <div className="shrink-0 rounded-[8px] border border-orange-200 bg-rest-soft px-3 py-2">
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-orange-800">
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

      {/* --- Dato y acción ------------------------------------------------
          Este bloque es el que cede espacio: `min-h-0` más `flex-1` permiten
          que el dial se encoja en pantallas bajas en lugar de empujar las
          acciones fuera de la vista. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 tall:gap-4">
        {/* Tiempo trabajado: el dato principal, y por eso va arriba y grande. */}
        <div className="rise shrink-0 text-center">
          <MicroLabel>Trabajado hoy</MicroLabel>
          <FlipClock
            seconds={workedSeconds}
            muted={status === 'off' && workedSeconds === 0}
            className="mt-1.5 block text-[clamp(1.75rem,9vw,3.1rem)] leading-none tall:text-[clamp(2.2rem,11vw,3.1rem)]"
          />
          <p className="mt-2 text-[12px] text-ink-soft">
            {status === 'off'
              ? entries.length === 0
                ? 'Aún no has fichado hoy'
                : 'Jornada cerrada'
              : remaining > 0
                ? `Quedan ${formatDuration(remaining)} de ${formatDuration(dailyTarget)}`
                : `${formatDuration(workedSeconds - dailyTarget)} por encima de tu jornada`}
          </p>
        </div>

        {/* El dial: círculo de acción con el anillo de progreso alrededor.
            Lo dimensiona la ALTURA disponible, no el ancho: fijarlo en `vw` y
            dejar que `aspect-square` reclamase la altura correspondiente hacía
            que en pantallas bajas el círculo se saliera de su caja. Aquí el
            contenedor se queda con el hueco que sobra y el dial se ajusta a
            él; `max-h` impide que en tabletas crezca hasta lo ridículo. */}
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <PunchDial
            onHoldComplete={() => handle(primary)}
            action={PRIMARY_LABEL[primary]}
            icon={<PrimaryIcon size={22} strokeWidth={2.2} />}
            dayProgress={progress}
            disabled={pending !== null}
            className="rise h-full max-h-[13.5rem] min-h-[5.5rem] w-auto"
          />
        </div>

        <p className="flex shrink-0 items-center justify-center gap-1.5 text-[11.5px] font-medium text-ink-soft">
          Mantén pulsado para confirmar
          {geoEnabled && (
            <>
              <span className="opacity-40">·</span>
              <MapPin size={11} /> con ubicación
            </>
          )}
        </p>

        {secondary && (
          <div className="rise shrink-0" style={{ animationDelay: '120ms' }}>
            <PunchPill
              onHoldComplete={() => handle(secondary)}
              disabled={pending !== null}
              label={secondary === 'break_start' ? 'Pausa' : 'Salir'}
              icon={
                secondary === 'break_start' ? (
                  <Coffee size={15} strokeWidth={2.2} />
                ) : (
                  <LogOut size={15} strokeWidth={2.2} />
                )
              }
            />
          </div>
        )}
      </div>

      {/* --- Error -------------------------------------------------------- */}
      {error && (
        <div
          role="alert"
          className="shrink-0 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800"
        >
          <span className="flex items-start gap-2 leading-relaxed">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            {error}
          </span>
        </div>
      )}

      {/* --- Movimientos del día ------------------------------------------
          Altura fija: nunca empuja a las acciones. Con muchos fichajes la
          tira se desplaza en horizontal, que es un gesto propio de una fila
          de fichas y no el desplazamiento vertical de la pantalla. */}
      <div className="shrink-0">
        <div className="mb-1.5 flex items-baseline justify-between">
          <MicroLabel>Movimientos</MicroLabel>
          <span className="tnum text-[11px] text-ink-faint">
            {now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            {breakSeconds > 0 && ` · pausas ${formatDuration(breakSeconds)}`}
          </span>
        </div>

        {entries.length === 0 ? (
          <p className="surface-flat rounded-[8px] px-3 py-2.5 text-center text-[12px] text-ink-faint">
            Tus fichajes de hoy aparecerán aquí
          </p>
        ) : (
          <ol
            className={cx(
              'flex gap-1.5 overflow-x-auto pb-0.5',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            )}
          >
            {entries.map((entry) => (
              <li key={entry.id} className="shrink-0">
                <span
                  className={cx(
                    'flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 transition-colors duration-500',
                    highlightId === entry.id
                      ? 'border-violet-300 bg-violet-50'
                      : 'border-[color:var(--color-hairline)] bg-surface',
                  )}
                >
                  <span
                    className={cx('h-1.5 w-1.5 shrink-0 rounded-full', DOT_TONE[entry.entry_type])}
                  />
                  <span className="tnum text-[12.5px] font-semibold text-ink">
                    {formatTime(entry.event_at)}
                  </span>
                  <span className="text-[11px] whitespace-nowrap text-ink-soft">
                    {ENTRY_LABEL[entry.entry_type]}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
