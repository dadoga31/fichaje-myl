import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './ui'

/**
 * BOTÓN DE MANTENER PULSADO
 *
 * Un fichaje es un asiento inalterable: una vez registrado no se puede
 * deshacer, solo rectificar dejando rastro. Un simple toque es demasiado fácil
 * de dar sin querer con el móvil en la mano, así que la acción exige mantener
 * el dedo pulsado hasta completar la barra.
 *
 * El progreso avanza con requestAnimationFrame y, si se suelta antes de
 * tiempo, retrocede de golpe: ese retroceso es lo que hace evidente que la
 * pulsación NO ha contado, sin necesidad de ningún mensaje.
 *
 * Accesible con teclado: Espacio o Intro mantenidos hacen exactamente lo mismo.
 */

export const HOLD_DURATION_MS = 900
const REWIND_MS = 220

type Phase = 'idle' | 'holding' | 'running' | 'done'

interface HoldButtonProps {
  /** Se ejecuta al completar la pulsación. `true` = éxito (latido de acuse). */
  onHoldComplete: () => Promise<boolean>
  children: ReactNode
  icon: ReactNode
  /** 'dark' para fondos sólidos; 'light' para fondos claros con borde. */
  tone?: 'dark' | 'light'
  className?: string
  disabled?: boolean
  /** Texto para lectores de pantalla; se le añade el aviso de mantener pulsado. */
  label: string
}

export function HoldButton({
  onHoldComplete,
  children,
  icon,
  tone = 'dark',
  className,
  disabled,
  label,
}: HoldButtonProps) {
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')

  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const progressRef = useRef(0)
  const phaseRef = useRef<Phase>('idle')
  const holdingKeyRef = useRef(false)

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

  const buzz = (pattern: number | number[]) => {
    // Vibración solo donde exista: en iOS no está y no debe romper nada.
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
    buzz([18, 40, 18])

    const ok = await onHoldComplete()

    if (ok) {
      // Celebración deliberadamente breve y SIN texto propio: en cuanto el
      // fichaje entra, el rótulo pasa a ser el de la acción siguiente
      // ("Fichar salida"), así que una marca de visto junto a él afirmaría
      // algo falso. Quien confirma es el aviso verde y el indicador de estado.
      setPhaseBoth('done')
      window.setTimeout(() => {
        setPhaseBoth('idle')
        setProgressBoth(0)
      }, 460)
    } else {
      setPhaseBoth('idle')
      setProgressBoth(0)
    }
  }, [onHoldComplete, setPhaseBoth, setProgressBoth, stopRaf])

  const tick = useCallback(
    (now: number) => {
      const elapsed = now - startRef.current
      const value = Math.min(1, elapsed / HOLD_DURATION_MS)
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
    // Se descuenta el progreso ya acumulado para que reanudar tras un rebote
    // del puntero no reinicie la cuenta de forma brusca.
    startRef.current = performance.now() - progressRef.current * HOLD_DURATION_MS
    rafRef.current = requestAnimationFrame(tick)
  }, [disabled, setPhaseBoth, stopRaf, tick])

  const cancelHold = useCallback(() => {
    if (phaseRef.current !== 'holding') return
    stopRaf()
    setPhaseBoth('idle')

    // Retroceso rápido: la señal de que la pulsación no ha contado.
    const from = progressRef.current
    const started = performance.now()
    const rewind = (now: number) => {
      const t = Math.min(1, (now - started) / REWIND_MS)
      // Aceleración cúbica: sale despacio y cae de golpe.
      setProgressBoth(from * (1 - t * t * t))
      if (t < 1) rafRef.current = requestAnimationFrame(rewind)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(rewind)
  }, [setPhaseBoth, setProgressBoth, stopRaf])

  const isBusy = phase === 'running' || phase === 'done'
  const isHolding = phase === 'holding'
  const pct = Math.round(progress * 100)

  return (
    <button
      type="button"
      disabled={disabled || isBusy}
      aria-label={`${label}. Mantenga pulsado para confirmar.`}
      aria-busy={phase === 'running'}
      onPointerDown={(e) => {
        // Solo botón principal del ratón; el táctil no reporta botones.
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        startHold()
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onLostPointerCapture={cancelHold}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !holdingKeyRef.current) {
          e.preventDefault()
          holdingKeyRef.current = true
          startHold()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          holdingKeyRef.current = false
          cancelHold()
        }
      }}
      onBlur={() => {
        holdingKeyRef.current = false
        cancelHold()
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cx(
        'group relative isolate flex items-center justify-center gap-3 overflow-hidden',
        'rounded-[6px] font-semibold select-none',
        'transition-[transform,background-color] duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        // La atenuación de "desactivado" solo cuando lo está de verdad: mientras
        // se registra el fichaje el botón debe seguir vivo, no volverse gris.
        disabled && 'cursor-not-allowed opacity-60',
        phase === 'done' && 'hold-complete',
        tone === 'dark' ? 'text-white' : '',
        className,
      )}
      style={{
        // El navegador no debe interpretar el mantenimiento como scroll,
        // ni ofrecer el menú contextual de pulsación larga en iOS.
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Relleno de progreso: barre de izquierda a derecha bajo el contenido. */}
      <span
        aria-hidden="true"
        className={cx(
          'absolute inset-y-0 left-0 -z-10',
          tone === 'dark' ? 'bg-white/22' : 'bg-current/12',
        )}
        style={{ width: `${pct}%` }}
      />

      {/* Filo luminoso en la cabeza del relleno: da sensación de avance. */}
      {progress > 0 && progress < 1 && (
        <span
          aria-hidden="true"
          className={cx(
            'absolute inset-y-0 -z-10 w-px',
            tone === 'dark' ? 'bg-white/70' : 'bg-current/40',
          )}
          style={{ left: `${pct}%` }}
        />
      )}

      {/* Barra fina inferior: lectura precisa del progreso. */}
      <span
        aria-hidden="true"
        className={cx(
          'absolute inset-x-0 bottom-0 h-[3px] origin-left',
          tone === 'dark' ? 'bg-white' : 'bg-current',
          phase === 'done' && 'opacity-0 transition-opacity duration-500',
        )}
        style={{ transform: `scaleX(${progress})` }}
      />

      {/* Destello al completar. */}
      {phase === 'done' && (
        <span
          aria-hidden="true"
          className={cx(
            'hold-flash absolute inset-0 -z-10',
            tone === 'dark' ? 'bg-white' : 'bg-current',
          )}
        />
      )}

      <span
        className={cx(
          'flex items-center gap-3 transition-transform duration-150',
          isHolding && 'scale-[0.97]',
        )}
      >
        {phase === 'running' ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
        ) : (
          icon
        )}
        {children}
      </span>
    </button>
  )
}
