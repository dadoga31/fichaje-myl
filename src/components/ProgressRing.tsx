import type { ReactNode } from 'react'
import type { WorkStatus } from '../lib/types'
import { cx } from './ui'

/**
 * ANILLO DE JORNADA
 *
 * Lee a la vez como reloj y como barra de progreso, que es justo lo que es:
 * cuánto llevas de tu jornada. El trazo se colorea según el estado, con la
 * misma lógica que la luz del fondo.
 *
 * Se dibuja en SVG y no con `conic-gradient` porque el SVG permite extremos
 * redondeados y una transición limpia del progreso.
 */

const TONES: Record<WorkStatus, { from: string; to: string }> = {
  working: { from: '#0d9f6e', to: '#7c3aed' },
  break: { from: '#e07a1b', to: '#a855f7' },
  off: { from: '#c4a6fc', to: '#7c3aed' },
}

export function ProgressRing({
  progress,
  status,
  overtime = false,
  children,
  className,
}: {
  /** 0 a 1. Por encima de 1 se satura y se marca como jornada superada. */
  progress: number
  status: WorkStatus
  overtime?: boolean
  children?: ReactNode
  className?: string
}) {
  const p = Math.max(0, Math.min(1, progress))
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const tone = TONES[status]
  const id = `ring-${status}`

  return (
    <div className={cx('relative', className)}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={tone.from} />
            <stop offset="100%" stopColor={tone.to} />
          </linearGradient>
          <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Carril: apenas visible, solo para dar cuerpo al anillo. */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          className="text-violet-200/70"
        />

        {/* Progreso. */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={overtime ? 8 : 6.5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - p)}
          filter={p > 0.02 ? `url(#${id}-glow)` : undefined}
          style={{
            transition: 'stroke-dashoffset 900ms var(--ease-out-soft), stroke-width 400ms',
          }}
        />
      </svg>

      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
      )}
    </div>
  )
}
