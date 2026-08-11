import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import type { WorkStatus } from '../lib/types'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------
// Superficie base. Bordes finos, radio contenido, sin sombras difusas.
// ---------------------------------------------------------------------
export function Panel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={cx('border border-slate-200 bg-white rounded-[6px]', className)}
      {...rest}
    >
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
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold text-slate-900">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
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
    'inline-flex items-center justify-center gap-2 rounded-[4px] font-medium ' +
    'transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-10 px-4 text-sm',
  }

  const variants = {
    primary:
      'bg-brand-800 text-white hover:bg-brand-700 active:bg-brand-900 ' +
      'shadow-[0_1px_0_0_rgba(88,28,135,0.35)]',
    secondary:
      'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 ' +
      'hover:border-slate-400 active:bg-slate-100',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200',
    danger:
      'border border-red-300 bg-white text-red-700 hover:bg-red-50 active:bg-red-100',
  }

  return <button className={cx(base, sizes[size], variants[variant], className)} {...rest} />
}

// ---------------------------------------------------------------------
// Indicador de estado de jornada
// ---------------------------------------------------------------------
const STATUS_STYLES: Record<WorkStatus, { dot: string; chip: string; label: string }> = {
  working: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    label: 'En jornada',
  },
  break: {
    dot: 'bg-orange-500',
    chip: 'bg-orange-50 text-orange-800 border-orange-200',
    label: 'En pausa',
  },
  off: {
    dot: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-700 border-slate-300',
    label: 'Fuera de jornada',
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
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium',
        s.chip,
        className,
      )}
    >
      <span className="relative flex h-2 w-2">
        {pulse && status !== 'off' && (
          <span
            className={cx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', s.dot)}
          />
        )}
        <span className={cx('relative inline-flex h-2 w-2 rounded-full', s.dot)} />
      </span>
      {s.label}
    </span>
  )
}

export function statusAccent(status: WorkStatus): string {
  return status === 'working'
    ? 'text-emerald-600'
    : status === 'break'
      ? 'text-orange-600'
      : 'text-slate-500'
}

// ---------------------------------------------------------------------
// Etiquetas y avisos
// ---------------------------------------------------------------------
export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('micro-label', className)}>{children}</span>
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'warn' | 'ok' | 'danger'
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    brand: 'bg-brand-50 text-brand-800 border-brand-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[11px] font-medium',
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
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex gap-2.5 rounded-[4px] border px-3 py-2.5 text-[13px]', tones[tone])}
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
    <div className="flex flex-col items-start gap-2 px-4 py-10 sm:px-6">
      {icon && <div className="text-slate-300">{icon}</div>}
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description && <p className="max-w-prose text-[13px] text-slate-500">{description}</p>}
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
      <label htmlFor={htmlFor} className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-brand-700">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  )
}

export const inputClass =
  'h-10 w-full rounded-[4px] border border-slate-300 bg-white px-3 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 ' +
  'focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500'

export const textareaClass =
  'w-full rounded-[4px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 ' +
  'focus:ring-brand-100 resize-y min-h-[88px]'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={cx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700',
        className,
      )}
    />
  )
}
