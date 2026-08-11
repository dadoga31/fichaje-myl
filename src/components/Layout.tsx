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
import { ROLE_LABEL } from '../lib/types'
import { Badge, cx } from './ui'
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
  { to: '/historial', label: 'Mi historial', short: 'Historial', icon: CalendarDays, roles: ['employee', 'manager', 'admin'] },
  { to: '/correcciones', label: 'Correcciones', short: 'Correcciones', icon: ClipboardCheck, roles: ['employee', 'manager', 'admin'] },
  { to: '/equipo', label: 'Plantilla', short: 'Plantilla', icon: LayoutDashboard, roles: ['manager', 'admin'] },
  { to: '/aprobaciones', label: 'Aprobaciones', short: 'Aprobar', icon: Users, roles: ['manager', 'admin'] },
  { to: '/informes', label: 'Informes', short: 'Informes', icon: FileSpreadsheet, roles: ['manager', 'admin'] },
  { to: '/inspeccion', label: 'Inspección', short: 'Inspección', icon: Gavel, roles: ['admin', 'inspector'] },
  { to: '/ajustes', label: 'Ajustes', short: 'Ajustes', icon: Settings, roles: ['employee', 'manager', 'admin', 'inspector'] },
]

export function Layout({ children }: { children: ReactNode }) {
  const { session, logout, isDemo } = useSession()
  const location = useLocation()
  if (!session) return null

  const role = session.profile.role
  const items = NAV.filter((item) => item.roles.includes(role))
  // En móvil la barra inferior solo admite 5 destinos legibles.
  const mobileItems = items.slice(0, 5)
  const isPunchScreen = location.pathname === '/'

  return (
    <div
      className={cx(
        'flex flex-col bg-canvas',
        // La pantalla de fichaje necesita un alto DEFINIDO para que su panel
        // pueda repartirse el espacio sin desbordar; el resto de secciones
        // son documentos que crecen y se recorren con normalidad.
        isPunchScreen ? 'h-dvh overflow-hidden' : 'min-h-dvh',
      )}
    >
      {/* --- Barra superior ---------------------------------------------- */}
      <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-brand-800 text-white">
              <Timer size={16} strokeWidth={2.4} />
            </span>
            <div className="leading-tight">
              <p className="text-[13px] font-semibold tracking-tight text-slate-900">
                Fichaje MyL
              </p>
              <p className="hidden text-[10px] text-slate-500 sm:block">
                {session.company.name}
              </p>
            </div>
          </div>

          {/* Navegación de escritorio */}
          <nav className="ml-4 hidden flex-1 items-center gap-0.5 lg:flex">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-1.5 rounded-[4px] px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-800'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )
                }
              >
                <item.icon size={15} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {isDemo && <Badge tone="warn">demo</Badge>}
            <div className="hidden text-right sm:block">
              <p className="text-[13px] font-medium text-slate-900">
                {session.profile.full_name}
              </p>
              <p className="text-[10px] text-slate-500">{ROLE_LABEL[role]}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex h-8 w-8 items-center justify-center rounded-[4px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <UpdatePrompt />

      {/* --- Contenido ----------------------------------------------------
          La pantalla de fichaje ocupa exactamente el alto disponible y no
          scrollea; el resto de secciones son documentos que sí se recorren.
          Se descuenta la barra superior (3.5rem) y, en móvil, la inferior. */}
      <main
        key={location.pathname}
        className={cx(
          'mx-auto w-full max-w-7xl px-4 sm:px-6',
          isPunchScreen
            ? 'min-h-0 flex-1 py-3 pb-[4.25rem] lg:py-4 lg:pb-4'
            : 'pt-5 pb-24 sm:pt-6 lg:pb-10',
        )}
      >
        {children}
      </main>

      {/* --- Barra inferior (móvil) --------------------------------------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/97 backdrop-blur-sm lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }}
        >
          {mobileItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
                    isActive ? 'text-brand-800' : 'text-slate-500 hover:text-slate-800',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cx(
                        'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                        isActive && 'bg-brand-50',
                      )}
                    >
                      <item.icon size={17} strokeWidth={isActive ? 2.4 : 2} />
                    </span>
                    {item.short}
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-600">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}
