import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import type { WorkStatus } from '../lib/types'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------
// Superficie de cristal. Radio de TARJETA (16px); las superficies héroe
// usan 28px y los controles 10px: la jerarquía se lee también en la curva.
// ---------------------------------------------------------------------
export function Panel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cx('glass rounded-[16px]', className)} {...rest}>
      {children}
    </div>
  )
}

export function PanelHeader({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--color-hairline)] px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-[14px] font-bold tracking-tight text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-soft">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonProps) {
  const base =
    'relative inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold ' +
    'transition-all duration-200 ease-[var(--ease-out-soft)] ' +
    'disabled:opacity-40 disabled:cursor-not-allowed ' +
    'active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-violet-600'

  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-10 px-4 text-sm',
  }

  const variants = {
    // El degradado va de violeta a iris: da profundidad sin parecer plástico.
    primary:
      'text-white bg-[linear-gradient(135deg,var(--color-violet-600),var(--color-violet-500))] ' +
      'shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_8px_20px_-6px_rgb(124_58_237/0.5)] ' +
      'hover:shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_12px_28px_-6px_rgb(124_58_237/0.6)] ' +
      'hover:-translate-y-px',
    secondary:
      'bg-white/70 text-ink border border-white/80 backdrop-blur-md ' +
      'shadow-[var(--shadow-lift)] hover:bg-white/90 hover:-translate-y-px',
    ghost: 'text-ink-soft hover:bg-violet-50 hover:text-violet-800',
    danger:
      'bg-white/70 text-red-700 border border-red-200/80 backdrop-blur-md ' +
      'hover:bg-red-50 hover:border-red-300',
  }

  return <button className={cx(base, sizes[size], variants[variant], className)} {...rest} />
}

// ---------------------------------------------------------------------
// Indicador de estado de jornada
// ---------------------------------------------------------------------
const STATUS_STYLES: Record<
  WorkStatus,
  { dot: string; chip: string; label: string; glow: string }
> = {
  working: {
    dot: 'bg-live',
    chip: 'bg-live-soft/80 text-[#07694a] border-[#0d9f6e]/25',
    label: 'En jornada',
    glow: 'shadow-[0_0_0_3px_rgb(13_159_110/0.12)]',
  },
  break: {
    dot: 'bg-rest',
    chip: 'bg-rest-soft/80 text-[#8a4708] border-[#e07a1b]/25',
    label: 'En pausa',
    glow: 'shadow-[0_0_0_3px_rgb(224_122_27/0.12)]',
  },
  off: {
    dot: 'bg-idle',
    chip: 'bg-idle-soft/80 text-[#4b4160] border-[#8b7fa3]/25',
    label: 'Fuera de jornada',
    glow: '',
  },
}

export function StatusPill({
  status,
  pulse = false,
  className,
}: {
  status: WorkStatus
  pulse?: boolean
  className?: string
}) {
  const s = STATUS_STYLES[status]
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold',
        'backdrop-blur-md transition-all duration-300',
        s.chip,
        s.glow,
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {pulse && status !== 'off' && (
          <span className={cx('pulse-ring absolute inline-flex h-full w-full rounded-full', s.dot)} />
        )}
        <span className={cx('relative inline-flex h-1.5 w-1.5 rounded-full', s.dot)} />
      </span>
      {s.label}
    </span>
  )
}

export function statusAccent(status: WorkStatus): string {
  return status === 'working'
    ? 'text-live'
    : status === 'break'
      ? 'text-rest'
      : 'text-ink-soft'
}

// ---------------------------------------------------------------------
// Etiquetas y avisos
// ---------------------------------------------------------------------
export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('eyebrow', className)}>{children}</span>
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'warn' | 'ok' | 'danger'
}) {
  const tones = {
    neutral: 'bg-idle-soft/70 text-[#4b4160] border-[#8b7fa3]/20',
    brand: 'bg-violet-100/70 text-violet-800 border-violet-300/40',
    warn: 'bg-rest-soft/70 text-[#8a4708] border-[#e07a1b]/25',
    ok: 'bg-live-soft/70 text-[#07694a] border-[#0d9f6e]/25',
    danger: 'bg-red-50/80 text-red-700 border-red-200',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

export function Notice({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'ok'
  icon?: ReactNode
  children: ReactNode
}) {
  const tones = {
    info: 'border-violet-200/60 bg-violet-50/70 text-violet-900',
    warn: 'border-[#e07a1b]/25 bg-rest-soft/70 text-[#8a4708]',
    error: 'border-red-200 bg-red-50/80 text-red-800',
    ok: 'border-[#0d9f6e]/25 bg-live-soft/70 text-[#07694a]',
  }
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[13px] backdrop-blur-md',
        tones[tone],
      )}
    >
      {icon && <span className="mt-px shrink-0">{icon}</span>}
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-2.5 px-5 py-12">
      {icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-[14px] bg-violet-100/60 text-violet-500">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-bold tracking-tight text-ink">{title}</p>
      {description && (
        <p className="max-w-prose text-[13px] leading-relaxed text-ink-soft">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  required,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: ReactNode
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-bold tracking-wide text-ink">
        {label}
        {required && <span className="ml-0.5 text-violet-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-ink-soft">{hint}</p>}
    </div>
  )
}

export const inputClass =
  'h-11 w-full rounded-[10px] border border-white/80 bg-white/70 px-3.5 text-sm text-ink ' +
  'backdrop-blur-md transition-all duration-200 placeholder:text-ink-faint ' +
  'shadow-[var(--shadow-lift)] ' +
  'focus:border-violet-400 focus:bg-white focus:outline-none ' +
  'focus:shadow-[0_0_0_4px_rgb(168_85_247/0.15)] ' +
  'disabled:bg-white/40 disabled:text-ink-soft'

export const textareaClass =
  'w-full rounded-[10px] border border-white/80 bg-white/70 px-3.5 py-2.5 text-sm text-ink ' +
  'backdrop-blur-md transition-all duration-200 placeholder:text-ink-faint resize-y min-h-[88px] ' +
  'shadow-[var(--shadow-lift)] ' +
  'focus:border-violet-400 focus:bg-white focus:outline-none ' +
  'focus:shadow-[0_0_0_4px_rgb(168_85_247/0.15)]'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={cx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600',
        className,
      )}
    />
  )
}

/** Fondo de aurora. Se monta una sola vez, en el armazón de la aplicación. */
export function Aurora({ status }: { status?: WorkStatus }) {
  return (
    <div className="aurora" data-estado={status ?? 'off'} aria-hidden="true">
      <div className="aurora-spark" />
    </div>
  )
}
