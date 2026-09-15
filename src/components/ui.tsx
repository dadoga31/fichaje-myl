import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { WorkStatus } from '../lib/types'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------
// Superficie. Blanco sólido, hairline y sombra corta.
//
// Antes era cristal esmerilado con `backdrop-filter`. Sobre un fondo claro
// el efecto apenas se percibe, cuesta rendimiento en móviles modestos y
// degrada la legibilidad del texto pequeño encima. Una tarjeta blanca con un
// borde de un píxel se lee mejor y parece un documento, no una calcomanía.
// ---------------------------------------------------------------------
export function Panel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cx('surface rounded-[12px]', className)} {...rest}>
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
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--color-hairline)] px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-[11.5px] text-ink-soft">{hint}</p>}
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

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  const base =
    'relative inline-flex items-center justify-center gap-1.5 rounded-[8px] font-semibold ' +
    'transition-colors duration-150 ease-[var(--ease-out-soft)] ' +
    'disabled:opacity-40 disabled:cursor-not-allowed ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600'

  const sizes = {
    sm: 'h-8 px-2.5 text-[12px]',
    md: 'h-9 px-3.5 text-[13px]',
  }

  // Un solo color plano por variante. Los degradados y los desplazamientos al
  // pasar el cursor que había antes hacían que cada botón pidiera atención.
  const variants = {
    primary: 'bg-violet-700 text-white hover:bg-violet-800 active:bg-violet-900',
    secondary:
      'bg-surface text-ink border border-[color:var(--color-hairline-strong)] hover:bg-slate-50',
    ghost: 'text-ink-soft hover:bg-slate-100 hover:text-ink',
    danger: 'bg-surface text-red-700 border border-red-200 hover:bg-red-50',
  }

  return <button className={cx(base, sizes[size], variants[variant], className)} {...rest} />
}

// ---------------------------------------------------------------------
// Indicador de estado de jornada
//
// El color nunca va solo: siempre lo acompañan el punto y el texto. Un
// indicador que solo se distingue por el tono deja fuera a quien no
// diferencia verde de ámbar, que es cerca de uno de cada doce hombres.
// ---------------------------------------------------------------------
const STATUS_STYLES: Record<WorkStatus, { dot: string; chip: string; label: string }> = {
  working: { dot: 'bg-live', chip: 'bg-live-soft text-emerald-800 border-emerald-200', label: 'En jornada' },
  break: { dot: 'bg-rest', chip: 'bg-rest-soft text-orange-800 border-orange-200', label: 'En pausa' },
  off: { dot: 'bg-idle', chip: 'bg-idle-soft text-slate-700 border-slate-200', label: 'Fuera de jornada' },
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
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold',
        s.chip,
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {pulse && status !== 'off' && (
          <span className={cx('pulse-dot absolute inline-flex h-full w-full rounded-full', s.dot)} />
        )}
        <span className={cx('relative inline-flex h-1.5 w-1.5 rounded-full', s.dot)} />
      </span>
      {s.label}
    </span>
  )
}

export function statusAccent(status: WorkStatus): string {
  return status === 'working' ? 'text-live' : status === 'break' ? 'text-rest' : 'text-ink-soft'
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
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    brand: 'bg-violet-50 text-violet-800 border-violet-200',
    warn: 'bg-rest-soft text-orange-800 border-orange-200',
    ok: 'bg-live-soft text-emerald-800 border-emerald-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-px text-[10px] font-semibold',
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
    info: 'border-violet-200 bg-violet-50 text-violet-900',
    warn: 'border-orange-200 bg-rest-soft text-orange-800',
    error: 'border-red-200 bg-red-50 text-red-800',
    ok: 'border-emerald-200 bg-live-soft text-emerald-800',
  }
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex gap-2 rounded-[8px] border px-3 py-2 text-[12.5px]', tones[tone])}
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
    <div className="flex flex-col items-center gap-1.5 px-5 py-8 text-center">
      {icon && (
        <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-[8px] bg-violet-50 text-violet-600">
          {icon}
        </div>
      )}
      <p className="text-[13.5px] font-semibold tracking-tight text-ink">{title}</p>
      {description && (
        <p className="max-w-xs text-[12px] leading-relaxed text-ink-soft">{description}</p>
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
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[11.5px] font-semibold text-ink">
        {label}
        {required && <span className="ml-0.5 text-violet-600">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-ink-soft">{hint}</p>}
    </div>
  )
}

export const inputClass =
  'h-10 w-full rounded-[8px] border border-[color:var(--color-hairline-strong)] bg-surface px-3 ' +
  'text-[13.5px] text-ink transition-colors duration-150 placeholder:text-ink-faint ' +
  'focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 ' +
  'disabled:bg-slate-50 disabled:text-ink-soft'

export const textareaClass =
  'w-full rounded-[8px] border border-[color:var(--color-hairline-strong)] bg-surface px-3 py-2 ' +
  'text-[13.5px] text-ink transition-colors duration-150 placeholder:text-ink-faint ' +
  'resize-none min-h-[64px] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={cx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-violet-600',
        className,
      )}
    />
  )
}

// ---------------------------------------------------------------------
// Paginador
//
// La pieza que permite cumplir «todo cabe en pantalla» con listas que, por
// naturaleza, no tienen final: una plantilla de cuarenta personas o un libro
// de fichajes de cuatro años. En vez de un área que se desplaza, se muestra
// exactamente lo que cabe y se cambia de página. Es además como se consulta
// un registro: por páginas, no deslizando.
// ---------------------------------------------------------------------
export function Pager({
  page,
  pages,
  total,
  onPage,
  unit = 'registros',
}: {
  page: number
  pages: number
  total: number
  onPage: (next: number) => void
  unit?: string
}) {
  if (pages <= 1) {
    return (
      <p className="px-1 text-[11px] text-ink-faint">
        {total} {unit}
      </p>
    )
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] text-ink-faint">
        {total} {unit}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          aria-label="Página anterior"
          className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[color:var(--color-hairline-strong)] bg-surface text-ink-soft disabled:opacity-30"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="tnum min-w-[3.5rem] text-center text-[11.5px] font-medium text-ink-soft">
          {page + 1} / {pages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages - 1}
          aria-label="Página siguiente"
          className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[color:var(--color-hairline-strong)] bg-surface text-ink-soft disabled:opacity-30"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

/** Fondo de la aplicación. Se monta una sola vez, en el armazón. */
export function AppBackground() {
  return <div className="app-bg" aria-hidden="true" />
}

// ---------------------------------------------------------------------
// Pestañas
//
// El recurso que permite que secciones con varios paneles quepan en una
// pantalla. Apilarlos verticalmente —como estaban— obliga a desplazarse para
// llegar al último, que es justo lo que se quiere evitar; y en escritorio,
// donde sí hay sitio, los paneles siguen mostrándose en columnas.
// ---------------------------------------------------------------------
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>
  active: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cx(
        'flex shrink-0 gap-1 border-b border-[color:var(--color-hairline)] px-2 py-1.5',
        className,
      )}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'flex-1 rounded-[6px] px-2 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors',
            active === t.id ? 'bg-violet-700 text-white' : 'text-ink-soft hover:bg-slate-100',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="tnum ml-1">({t.count})</span>}
        </button>
      ))}
    </div>
  )
}
