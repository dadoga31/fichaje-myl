import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  CloudOff,
  Coffee,
  Hand,
  LogIn,
  LogOut,
  MapPin,
  Play,
} from 'lucide-react'
import type { EntryType, QueuedPunch, TimeEntry, WorkStatus } from '../lib/types'
import { ENTRY_LABEL } from '../lib/types'
import { computeDay, deriveStatus, formatClock, formatDuration, formatTime } from '../lib/time'
import { useTicker } from '../hooks/useTicker'
import { Badge, MicroLabel, StatusPill, cx } from './ui'
import { HoldButton } from './HoldButton'

/**
 * PANTALLA DE FICHAJE
 *
 * Ocupa el alto disponible y no scrollea: quien va a fichar suele tener el
 * móvil en una mano y prisa. Todo lo que no sea fichar (historial, semana,
 * correcciones) vive en sus propias secciones.
 *
 * El reparto vertical es deliberado: el estado arriba, el contador en el
 * centro óptico y los botones anclados abajo, al alcance del pulgar.
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

/** Acción principal según el estado: una sola decisión evidente en pantalla. */
const PRIMARY_ACTION: Record<WorkStatus, EntryType> = {
  off: 'clock_in',
  working: 'clock_out',
  break: 'break_end',
}

/** Rótulo de la acción principal en cada estado. */
const PRIMARY_LABEL: Record<EntryType, string> = {
  clock_in: 'Fichar entrada',
  clock_out: 'Fichar salida',
  break_end: 'Reanudar jornada',
  break_start: 'Iniciar pausa',
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
  // Id del fichaje recién añadido, para destacarlo un instante en la lista.
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const seenIds = useRef<Set<string> | null>(null)

  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null
  const status = deriveStatus(lastEntry)

  const { workedSeconds, breakSeconds } = useMemo(
    () => computeDay(entries, now),
    [entries, now],
  )

  const dailyTarget = (contractHours / 5) * 3600
  const progress = dailyTarget > 0 ? Math.min(1, workedSeconds / dailyTarget) : 0
  const remaining = Math.max(0, dailyTarget - workedSeconds)

  // Confirmación del fichaje: en vez de un aviso que tape la lista, se
  // resalta el asiento recién incorporado. Dice lo mismo —qué y a qué hora—
  // señalando además dónde ha quedado registrado.
  useEffect(() => {
    const ids = new Set(entries.map((e) => e.id))
    if (seenIds.current === null) {
      seenIds.current = ids // primera carga: nada que celebrar
      return
    }
    const added = entries.find((e) => !seenIds.current!.has(e.id))
    seenIds.current = ids
    if (!added) return

    setHighlightId(added.id)
    const timer = window.setTimeout(() => setHighlightId(null), 2000)
    return () => window.clearTimeout(timer)
  }, [entries])

  useEffect(() => {
    if (!error) return
    const id = window.setTimeout(() => setError(null), 7000)
    return () => window.clearTimeout(id)
  }, [error])

  // El botón gestiona su propio estado de pulsación; aquí solo se marca que
  // hay una operación en curso, para desactivar la acción secundaria.
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
  // Desde "en jornada" y "en pausa" hay una segunda salida posible.
  const secondary: EntryType | null =
    status === 'working' ? 'break_start' : status === 'break' ? 'clock_out' : null

  const hasWarnings = !online || queued.length > 0

  return (
    <section className="flex h-full w-full flex-col overflow-hidden rounded-[6px] border border-slate-200 bg-white lg:h-auto">
      {/* --- Identidad y estado ----------------------------------------- */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 sm:px-5 tall:py-3">
        <div className="min-w-0">
          <MicroLabel>Jornada de hoy</MicroLabel>
          <p className="mt-1 truncate text-sm font-semibold text-slate-900">{personName}</p>
        </div>
        <StatusPill status={status} pulse />
      </header>

      {/* --- Condiciones que conviene saber ANTES de fichar --------------- */}
      {hasWarnings && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 sm:px-5">
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-amber-900">
            <CloudOff size={14} className="mt-px shrink-0" />
            <span>
              {!online && 'Sin conexión: el fichaje se guarda con su hora real y se enviará al recuperar la red. '}
              {queued.length > 0 &&
                (queued.length === 1
                  ? '1 fichaje pendiente de sincronizar.'
                  : `${queued.length} fichajes pendientes de sincronizar.`)}
            </span>
          </p>
        </div>
      )}

      {/* --- Cuerpo: contador y fichajes del día -------------------------- */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* El contador se queda con el espacio sobrante y se centra en él. */}
        <div
          className={cx(
            // El grupo se centra y el aire sobrante queda FUERA: repartirlo
            // entre los bloques (justify-between) abría dos huecos internos
            // que rompían la lectura de contador → progreso → reloj.
            'flex min-h-0 flex-1 flex-col justify-center px-4 sm:px-6',
            // overflow-y-auto es la red de seguridad: en una pantalla muy baja
            // el contenido se recorta y scrollea aquí dentro, en vez de
            // desbordar por encima de la cabecera y de los botones.
            'gap-3 overflow-y-auto py-4 tall:gap-5 tall:py-6',
          )}
        >
          <div>
            <MicroLabel>Tiempo trabajado hoy</MicroLabel>
            <p
              className={cx(
                'tnum mt-1.5 leading-[0.92] font-semibold tracking-tight',
                // Se escala con el lado MENOR disponible: en un móvil alto el
                // ancho manda; en uno bajo, la altura evita que desborde.
                'text-[clamp(2.5rem,min(20vw,11vh),5.5rem)]',
                status === 'off' ? 'text-slate-400' : 'text-slate-900',
              )}
            >
              {formatClock(workedSeconds)}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
              {status === 'off'
                ? entries.length === 0
                  ? 'Sin fichajes registrados hoy.'
                  : 'Jornada cerrada.'
                : remaining > 0
                  ? `Quedan ${formatDuration(remaining)} para completar la jornada de referencia.`
                  : `Jornada de referencia superada en ${formatDuration(workedSeconds - dailyTarget)}.`}
            </p>
          </div>

          {/* Progreso de la jornada: barra plana, sin brillos. */}
          <div>
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
                Pausas:{' '}
                <span className="tnum font-medium text-slate-700">
                  {formatDuration(breakSeconds)}
                </span>
              </span>
              <span className="tnum">
                {formatDuration(workedSeconds)} / {formatDuration(dailyTarget)}
              </span>
            </div>
          </div>

          {/* Reloj actual: la referencia con la que se contrasta el fichaje. */}
          <p className="flex items-baseline gap-2 border-t border-slate-200/70 pt-2.5 tall:pt-4">
            <Clock size={14} className="shrink-0 self-center text-slate-400" />
            <span className="tnum text-base font-medium tracking-tight text-slate-700 tall:text-lg">
              {now.toLocaleTimeString('es-ES', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            <span className="truncate text-[12px] text-slate-500">
              {now.toLocaleDateString('es-ES', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </span>
          </p>
        </div>

        {/* Fichajes del día. Vacío ocupa una sola línea: no merece un bloque. */}
        <aside className="shrink-0 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 sm:px-6">
          {entries.length === 0 ? (
            <p className="flex items-center gap-2 truncate text-[12px] text-slate-500">
              <MicroLabel className="shrink-0">Hoy</MicroLabel>
              Todavía no ha fichado.
            </p>
          ) : (
            <>
              <MicroLabel>Fichajes de hoy</MicroLabel>
              <ol className="mt-1.5 flex max-h-[4.5rem] flex-wrap gap-1.5 overflow-y-auto">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <span
                      className={cx(
                        'inline-flex items-center gap-1.5 rounded-[4px] border bg-white px-2 py-1 text-xs',
                        highlightId === entry.id && 'chip-nuevo',
                        entry.entry_type === 'clock_in' && 'border-emerald-200 text-emerald-800',
                        entry.entry_type === 'clock_out' && 'border-slate-300 text-slate-700',
                        entry.entry_type === 'break_start' && 'border-orange-200 text-orange-800',
                        entry.entry_type === 'break_end' && 'border-brand-200 text-brand-800',
                      )}
                    >
                      <span className="tnum font-semibold">{formatTime(entry.event_at)}</span>
                      <span className="text-slate-500">{ENTRY_LABEL[entry.entry_type]}</span>
                      {entry.origin === 'correction' && <Badge tone="warn">rectificado</Badge>}
                      {entry.origin === 'employee_offline' && (
                        <Badge tone="neutral">diferido</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
      </div>

      {/* --- Acciones, ancladas abajo ------------------------------------- */}
      <footer className="relative shrink-0 border-t border-slate-200 px-4 py-3 sm:px-5 tall:py-4">
        {/* El resultado flota SOBRE el contenido: si empujara el diseño,
            movería el botón bajo el dedo justo al completar la pulsación. */}
        {error && (
          <div
            role="alert"
            className={cx(
              'punch-toast absolute inset-x-4 bottom-full z-10 mb-2 flex items-start gap-2 sm:inset-x-5',
              'rounded-[4px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 shadow-sm',
            )}
          >
            <AlertTriangle size={15} className="mt-px shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <div className={cx('grid gap-2.5', secondary ? 'grid-cols-[2fr_1fr]' : '')}>
          <HoldButton
            onHoldComplete={() => handle(primary)}
            disabled={pending !== null}
            tone="dark"
            label={PRIMARY_LABEL[primary]}
            icon={<PrimaryIcon size={20} strokeWidth={2.2} />}
            className={cx(
              'h-14 px-4 text-[15px] sm:px-6 sm:text-base tall:h-16',
              primary === 'clock_out'
                ? 'bg-slate-900 hover:bg-slate-800'
                : 'bg-brand-800 hover:bg-brand-700',
              'shadow-[0_1px_0_0_rgba(15,23,42,0.12)]',
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
                  <Coffee size={18} strokeWidth={2.2} />
                ) : (
                  <LogOut size={18} strokeWidth={2.2} />
                )
              }
              className={cx(
                'h-14 border px-3 text-sm sm:px-5 tall:h-16',
                secondary === 'break_start'
                  ? 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
              )}
            >
              {secondary === 'break_start' ? 'Pausa' : 'Salida'}
            </HoldButton>
          )}
        </div>

        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
          <Hand size={12} className="mt-0.5 shrink-0" />
          <span>
            Mantenga pulsado hasta completar la barra.
            <span className="hidden tall:inline">
              {' '}
              Un fichaje registrado no se puede deshacer, solo rectificar.
            </span>
            {geoEnabled && (
              <>
                {' '}
                <MapPin size={12} className="inline shrink-0 align-[-2px]" /> Se registra
                su ubicación, como usted autorizó.
              </>
            )}
          </span>
        </p>
      </footer>
    </section>
  )
}
