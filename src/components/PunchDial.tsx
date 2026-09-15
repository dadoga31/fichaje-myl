import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cx } from './ui'

/**
 * DIAL DE FICHAJE
 *
 * Un círculo con un anillo alrededor. El anillo hace dos trabajos distintos
 * según el momento, y ese es el truco que permite que una sola pieza ocupe el
 * centro de la pantalla en vez de tres:
 *
 *   · En reposo muestra el PROGRESO DE LA JORNADA con un trazo fino y claro.
 *   · Mientras se mantiene el dedo, un trazo grueso y oscuro lo recorre de
 *     cero a completo. Al soltar antes de tiempo retrocede de golpe.
 *
 * No hay ambigüedad entre ambos porque el segundo solo existe mientras hay un
 * dedo encima: aparece al pulsar y desaparece al soltar.
 *
 * Por qué mantener pulsado y no un toque: un fichaje es un asiento inalterable.
 * Una vez registrado no se deshace, solo se rectifica dejando rastro. Un toque
 * accidental con el móvil en el bolsillo no puede costar una rectificación
 * firmada por administración.
 */

export const HOLD_DURATION_MS = 1000
const REWIND_MS = 260

type Phase = 'idle' | 'holding' | 'running' | 'done'

interface PunchDialProps {
  /** Se ejecuta al completar. `true` = registrado (acuse de recibo). */
  onHoldComplete: () => Promise<boolean>
  /** Etiqueta visible en el centro: «Entrar», «Salir», «Reanudar». */
  action: string
  icon: ReactNode
  /** Progreso de la jornada, 0 a 1. Dibuja el trazo fino en reposo. */
  dayProgress: number
  disabled?: boolean
  className?: string
}

/* Geometría del SVG. El radio se elige para que el trazo grueso del progreso
   no se salga del viewBox ni siquiera con el extremo redondeado. */
const R = 54
const CIRCUMFERENCE = 2 * Math.PI * R

export function PunchDial({
  onHoldComplete,
  action,
  icon,
  dayProgress,
  disabled,
  className,
}: PunchDialProps) {
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')

  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const progressRef = useRef(0)
  const phaseRef = useRef<Phase>('idle')
  const keyHeldRef = useRef(false)

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const setProgressBoth = useCallback((value: number) => {
    progressRef.current = value
    setProgress(value)
  }, [])

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  useEffect(() => stopRaf, [stopRaf])

  /** Vibración solo donde exista: en iOS no está y no debe romper nada. */
  const buzz = (pattern: number | number[]) => {
    try {
      navigator.vibrate?.(pattern)
    } catch {
      /* sin retorno háptico */
    }
  }

  const complete = useCallback(async () => {
    stopRaf()
    setProgressBoth(1)
    setPhaseBoth('running')
    buzz([16, 36, 16])

    const ok = await onHoldComplete()

    if (ok) {
      setPhaseBoth('done')
      window.setTimeout(() => {
        setPhaseBoth('idle')
        setProgressBoth(0)
      }, 900)
    } else {
      setPhaseBoth('idle')
      setProgressBoth(0)
    }
  }, [onHoldComplete, setPhaseBoth, setProgressBoth, stopRaf])

  const tick = useCallback(
    (now: number) => {
      const value = Math.min(1, (now - startRef.current) / HOLD_DURATION_MS)
      setProgressBoth(value)
      if (value >= 1) {
        void complete()
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [complete, setProgressBoth],
  )

  const startHold = useCallback(() => {
    if (disabled || phaseRef.current === 'running' || phaseRef.current === 'done') return
    stopRaf()
    setPhaseBoth('holding')
    buzz(8)
    // Se descuenta lo ya acumulado: reanudar tras un rebote del puntero no
    // debe reiniciar la cuenta de forma brusca.
    startRef.current = performance.now() - progressRef.current * HOLD_DURATION_MS
    rafRef.current = requestAnimationFrame(tick)
  }, [disabled, setPhaseBoth, stopRaf, tick])

  const cancelHold = useCallback(() => {
    if (phaseRef.current !== 'holding') return
    stopRaf()
    setPhaseBoth('idle')

    // Retroceso acelerado: es la señal de que la pulsación NO ha contado.
    const from = progressRef.current
    const started = performance.now()
    const rewind = (now: number) => {
      const t = Math.min(1, (now - started) / REWIND_MS)
      setProgressBoth(from * (1 - t * t * t))
      if (t < 1) rafRef.current = requestAnimationFrame(rewind)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(rewind)
  }, [setPhaseBoth, setProgressBoth, stopRaf])

  const holding = phase === 'holding'
  const running = phase === 'running'
  const done = phase === 'done'
  const day = Math.max(0, Math.min(1, dayProgress))

  return (
    <div className={cx('relative aspect-square', className)}>
      {/* --- Anillos ---------------------------------------------------- */}
      <svg
        viewBox="0 0 120 120"
        className={cx('h-full w-full -rotate-90', done && 'ring-confirm')}
        aria-hidden="true"
      >
        {/* Carril */}
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-hairline)" strokeWidth="3" />

        {/* Progreso de la JORNADA: fino y claro. Se aparta visualmente en
            cuanto empieza la pulsación para no competir con ella. */}
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--color-violet-400)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - day)}
          opacity={progress > 0 ? 0.35 : 1}
          style={{ transition: 'stroke-dashoffset 700ms var(--ease-out-soft), opacity 200ms' }}
        />

        {/* Progreso de la PULSACIÓN: grueso y de marca. Solo existe mientras
            hay un dedo encima, así que no compite con el anterior. */}
        {progress > 0 && (
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="var(--color-violet-700)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          />
        )}
      </svg>

      {/* --- Cara del botón --------------------------------------------- */}
      <button
        type="button"
        disabled={disabled || running || done}
        aria-label={`${action}. Mantenga pulsado para confirmar.`}
        aria-busy={running}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          startHold()
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onLostPointerCapture={cancelHold}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !keyHeldRef.current) {
            e.preventDefault()
            keyHeldRef.current = true
            startHold()
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            keyHeldRef.current = false
            cancelHold()
          }
        }}
        onBlur={() => {
          keyHeldRef.current = false
          cancelHold()
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={cx(
          'absolute inset-[11%] flex flex-col items-center justify-center gap-1.5 rounded-full',
          'select-none transition-[transform,background-color,box-shadow] duration-200',
          'ease-[var(--ease-out-soft)] focus-visible:outline-2 focus-visible:outline-offset-4',
          'focus-visible:outline-violet-600',
          done
            ? 'bg-live text-white shadow-[0_6px_20px_-6px_rgb(15_122_85/0.5)]'
            : 'bg-[linear-gradient(180deg,var(--color-violet-600),var(--color-violet-700))] text-white shadow-[0_8px_24px_-8px_rgb(107_33_168/0.55),inset_0_1px_0_0_rgb(255_255_255/0.18)]',
          holding && 'scale-[0.965]',
          disabled && 'cursor-not-allowed opacity-45',
        )}
        style={{
          // El navegador no debe interpretar el mantenimiento como scroll ni
          // ofrecer el menú contextual de pulsación larga en iOS.
          touchAction: 'none',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {running ? (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : done ? (
          <Check size={30} strokeWidth={2.6} />
        ) : (
          <>
            <span className="opacity-90">{icon}</span>
            <span className="text-[clamp(0.95rem,4.4vw,1.15rem)] leading-none font-semibold tracking-tight">
              {action}
            </span>
          </>
        )}
      </button>
    </div>
  )
}

/**
 * Acción secundaria (pausa, o salida durante la pausa).
 *
 * Mantiene la misma exigencia de pulsación sostenida que el dial —es otro
 * asiento igual de inalterable—, pero en una pastilla discreta: si compitiera
 * en tamaño con el dial, la pantalla dejaría de tener una acción principal
 * evidente, que es justo lo que se busca cuando alguien ficha con prisa.
 */
export function PunchPill({
  onHoldComplete,
  label,
  icon,
  disabled,
}: {
  onHoldComplete: () => Promise<boolean>
  label: string
  icon: ReactNode
  disabled?: boolean
}) {
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const progressRef = useRef(0)
  const holdingRef = useRef(false)
  const keyHeldRef = useRef(false)

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  useEffect(() => stop, [stop])

  const set = (v: number) => {
    progressRef.current = v
    setProgress(v)
  }

  const tick = useCallback(
    (now: number) => {
      const v = Math.min(1, (now - startRef.current) / HOLD_DURATION_MS)
      set(v)
      if (v >= 1) {
        stop()
        holdingRef.current = false
        setBusy(true)
        void onHoldComplete().then(() => {
          setBusy(false)
          set(0)
        })
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [onHoldComplete, stop],
  )

  const start = useCallback(() => {
    if (disabled || busy) return
    stop()
    holdingRef.current = true
    try {
      navigator.vibrate?.(8)
    } catch {
      /* sin retorno háptico */
    }
    startRef.current = performance.now() - progressRef.current * HOLD_DURATION_MS
    rafRef.current = requestAnimationFrame(tick)
  }, [busy, disabled, stop, tick])

  const cancel = useCallback(() => {
    if (!holdingRef.current) return
    holdingRef.current = false
    stop()
    const from = progressRef.current
    const t0 = performance.now()
    const rewind = (now: number) => {
      const t = Math.min(1, (now - t0) / REWIND_MS)
      set(from * (1 - t * t * t))
      if (t < 1) rafRef.current = requestAnimationFrame(rewind)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(rewind)
  }, [stop])

  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-label={`${label}. Mantenga pulsado para confirmar.`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        start()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !keyHeldRef.current) {
          e.preventDefault()
          keyHeldRef.current = true
          start()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          keyHeldRef.current = false
          cancel()
        }
      }}
      onBlur={() => {
        keyHeldRef.current = false
        cancel()
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cx(
        'surface relative flex h-11 items-center justify-center gap-2 overflow-hidden rounded-full',
        'px-5 text-[13.5px] font-semibold text-ink transition-transform duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600',
        progress > 0 && 'scale-[0.985]',
        (disabled || busy) && 'cursor-not-allowed opacity-50',
      )}
      style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
    >
      {/* Relleno de progreso bajo el contenido. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-violet-100"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative flex items-center gap-2">
        {icon}
        {label}
      </span>
    </button>
  )
}
