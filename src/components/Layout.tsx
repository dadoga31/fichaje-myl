import { NavLink, useLocation } from 'react-router-dom'
import {
  CalendarDays,
  ClipboardCheck,
  FileSpreadsheet,
  Gavel,
  LayoutDashboard,
  LogOut,
  Settings,
  Timer,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useSession } from '../context/SessionContext'
import { ROLE_LABEL, type WorkStatus } from '../lib/types'
import { Aurora, Badge, cx } from './ui'
import { UpdatePrompt } from './UpdatePrompt'

interface NavItem {
  to: string
  label: string
  short: string
  icon: typeof Timer
  roles: Array<'employee' | 'manager' | 'admin' | 'inspector'>
}

const NAV: NavItem[] = [
  { to: '/', label: 'Fichar', short: 'Fichar', icon: Timer, roles: ['employee', 'manager', 'admin'] },
  { to: '/historial', label: 'Historial', short: 'Historial', icon: CalendarDays, roles: ['employee', 'manager', 'admin'] },
  { to: '/correcciones', label: 'Correcciones', short: 'Corregir', icon: ClipboardCheck, roles: ['employee', 'manager', 'admin'] },
  { to: '/equipo', label: 'Plantilla', short: 'Plantilla', icon: LayoutDashboard, roles: ['manager', 'admin'] },
  { to: '/aprobaciones', label: 'Aprobaciones', short: 'Aprobar', icon: Users, roles: ['manager', 'admin'] },
  { to: '/informes', label: 'Informes', short: 'Informes', icon: FileSpreadsheet, roles: ['manager', 'admin'] },
  { to: '/inspeccion', label: 'Inspección', short: 'Inspección', icon: Gavel, roles: ['admin', 'inspector'] },
  { to: '/ajustes', label: 'Ajustes', short: 'Ajustes', icon: Settings, roles: ['employee', 'manager', 'admin', 'inspector'] },
]

export function Layout({
  children,
  status,
}: {
  children: ReactNode
  /** Estado de jornada: tiñe la luz del fondo de toda la aplicación. */
  status?: WorkStatus
}) {
  const { session, logout, isDemo } = useSession()
  const location = useLocation()
  if (!session) return null

  const role = session.profile.role
  const items = NAV.filter((item) => item.roles.includes(role))
  const mobileItems = items.slice(0, 5)
  const isPunchScreen = location.pathname === '/'

  return (
    <div
      className={cx(
        'flex flex-col',
        isPunchScreen ? 'h-dvh overflow-hidden' : 'min-h-dvh',
      )}
    >
      <Aurora status={status} />

      {/* --- Barra superior de cristal ------------------------------------ */}
      <header className="sticky top-0 z-30 shrink-0">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span
              className={cx(
                'flex h-9 w-9 items-center justify-center rounded-[12px] text-white',
                'bg-[linear-gradient(140deg,var(--color-violet-500),var(--color-violet-700))]',
                'shadow-[0_6px_18px_-4px_rgb(124_58_237/0.55)]',
              )}
            >
              <Timer size={18} strokeWidth={2.5} />
            </span>
            <div className="leading-tight">
              <p className="font-display text-[15px] font-bold tracking-tight text-ink">
                Fichaje
              </p>
              <p className="hidden text-[10px] font-medium text-ink-soft sm:block">
                {session.company.name}
              </p>
            </div>
          </div>

          {/* Navegación de escritorio: cápsula de cristal con indicador que
              se desliza bajo la pestaña activa. */}
          <nav className="glass ml-4 hidden items-center gap-0.5 rounded-full p-1 lg:flex">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold',
                    'transition-all duration-300 ease-[var(--ease-out-soft)]',
                    isActive
                      ? 'text-white'
                      : 'text-ink-soft hover:bg-white/60 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute inset-0 rounded-full bg-[linear-gradient(135deg,var(--color-violet-600),var(--color-violet-500))] shadow-[0_4px_14px_-3px_rgb(124_58_237/0.6)]" />
                    )}
                    <item.icon size={14} className="relative" strokeWidth={2.4} />
                    <span className="relative">{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2.5">
            {isDemo && <Badge tone="warn">demo</Badge>}
            <div className="hidden text-right sm:block">
              <p className="text-[13px] font-bold text-ink">{session.profile.full_name}</p>
              <p className="text-[10px] text-ink-soft">{ROLE_LABEL[role]}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="glass flex h-9 w-9 items-center justify-center rounded-[12px] text-ink-soft transition-all duration-200 hover:-translate-y-px hover:text-violet-700"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <UpdatePrompt />

      {/* --- Contenido ---------------------------------------------------- */}
      <main
        key={location.pathname}
        className={cx(
          'page-enter mx-auto w-full max-w-7xl px-4 sm:px-6',
          isPunchScreen
            ? 'min-h-0 flex-1 pb-[5.5rem] lg:pb-6'
            : 'pt-2 pb-28 lg:pb-12',
        )}
      >
        {children}
      </main>

      {/* --- Dock flotante (móvil) ---------------------------------------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
        aria-label="Navegación principal"
      >
        <ul
          className="glass-strong mx-auto grid max-w-md rounded-[22px] p-1.5"
          style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }}
        >
          {mobileItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'relative flex flex-col items-center gap-1 rounded-[16px] py-2 text-[10px] font-bold',
                    'transition-all duration-300 ease-[var(--ease-out-soft)]',
                    isActive ? 'text-white' : 'text-ink-soft active:scale-95',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute inset-0 rounded-[16px] bg-[linear-gradient(140deg,var(--color-violet-600),var(--color-violet-500))] shadow-[0_6px_18px_-4px_rgb(124_58_237/0.55)]" />
                    )}
                    <item.icon
                      size={18}
                      strokeWidth={isActive ? 2.6 : 2.1}
                      className="relative"
                    />
                    <span className="relative">{item.short}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 pt-3">
      <div>
        <h1 className="font-display text-[26px] leading-tight font-bold tracking-[-0.03em] text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}
