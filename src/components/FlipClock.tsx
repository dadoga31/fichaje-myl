import { cx } from './ui'

/**
 * RELOJ DE DÍGITOS
 *
 * Cada cifra vive en una caja de ancho fijo y solo se anima la que cambia:
 * el segundo gira cada segundo, el minuto cada minuto. Así el reloj respira
 * sin convertirse en una feria de luces.
 *
 * El ancho fijo por dígito es además lo que garantiza que el reloj no baile
 * aunque la tipografía no traiga cifras tabulares.
 */

function Digit({ value, size }: { value: string; size: 'hero' | 'compact' }) {
  return (
    <span
      className={cx(
        'relative inline-block text-center [perspective:400px]',
        size === 'hero' ? 'w-[0.58em]' : 'w-[0.56em]',
      )}
    >
      {/* La `key` cambia con el dígito: React remonta el nodo y la animación
          se dispara sola, sin temporizadores ni estado adicional. */}
      <span key={value} className="digit-roll inline-block [transform-style:preserve-3d]">
        {value}
      </span>
    </span>
  )
}

export function FlipClock({
  seconds,
  size = 'hero',
  muted = false,
  className,
}: {
  seconds: number
  size?: 'hero' | 'compact'
  muted?: boolean
  className?: string
}) {
  const total = Math.max(0, Math.floor(seconds))
  const hh = String(Math.floor(total / 3600)).padStart(2, '0')
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')

  const separator = (
    <span className={cx('inline-block opacity-25', size === 'hero' ? 'w-[0.28em]' : 'w-[0.26em]')}>
      :
    </span>
  )

  return (
    <span
      className={cx(
        'font-display font-bold tracking-[-0.04em] tabular-nums',
        muted ? 'text-ink-faint' : 'text-ink',
        className,
      )}
      aria-label={`${hh} horas ${mm} minutos ${ss} segundos`}
      role="timer"
    >
      {[...hh].map((d, i) => (
        <Digit key={`h${i}`} value={d} size={size} />
      ))}
      {separator}
      {[...mm].map((d, i) => (
        <Digit key={`m${i}`} value={d} size={size} />
      ))}
      {separator}
      {/* Los segundos, algo más discretos: informan del pulso, no compiten. */}
      <span className={cx(size === 'hero' ? 'text-[0.62em]' : 'text-[0.8em]', 'opacity-45')}>
        {[...ss].map((d, i) => (
          <Digit key={`s${i}`} value={d} size={size} />
        ))}
      </span>
    </span>
  )
}
