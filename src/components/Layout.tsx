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
import { AppBackground, Badge, cx } from './ui'
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

/**
 * ARMAZÓN DE LA APLICACIÓN
 *
 * La regla estructural: el armazón mide exactamente la pantalla y NADA se
 * desplaza. `h-dvh` más `overflow-hidden` en la raíz, y `min-h-0` en la zona
 * de contenido para que sea ella la que ceda. Cada sección recibe una caja de
 * altura conocida y se organiza dentro; las listas sin final se paginan.
 *
 * `dvh` y no `vh` a propósito: en el móvil la barra del navegador aparece y
 * desaparece, y con `vh` el muelle de navegación queda tapado justo cuando se
 * va a pulsar.
 */
export function Layout({
  children,
  status,
}: {
  children: ReactNode
  /** Estado de jornada. Se conserva por compatibilidad de la firma. */
  status?: WorkStatus
}) {
  const { session, logout, isDemo } = useSession()
  const location = useLocation()
  if (!session) return null

  void status

  const role = session.profile.role
  const items = NAV.filter((item) => item.roles.includes(role))
  const mobileItems = items.slice(0, 5)

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppBackground />

      {/* --- Barra superior ----------------------------------------------- */}
      <header className="shrink-0 border-b border-[color:var(--color-hairline)] bg-surface">
        <div className="mx-auto flex h-13 max-w-7xl items-center gap-3 px-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-violet-700 text-white">
              <Timer size={15} strokeWidth={2.4} />
            </span>
            <div className="leading-tight">
              <p className="text-[13.5px] font-semibold tracking-tight text-ink">Fichaje</p>
              <p className="hidden text-[10px] text-ink-soft sm:block">{session.company.name}</p>
            </div>
          </div>

          {/* Navegación de escritorio. Pestañas con subrayado: el patrón que
              usa cualquier herramienta de gestión, y el que menos estorba. */}
          <nav className="ml-6 hidden items-center gap-0.5 self-stretch lg:flex">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'relative flex items-center gap-1.5 px-3 text-[13px] font-medium',
                    'transition-colors duration-150',
                    isActive ? 'text-violet-800' : 'text-ink-soft hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={14} strokeWidth={2.2} />
                    <span>{item.label}</span>
                    {isActive && (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-violet-700" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {isDemo && <Badge tone="warn">demo</Badge>}
            <div className="hidden text-right sm:block">
              <p className="text-[12.5px] font-semibold text-ink">{session.profile.full_name}</p>
              <p className="text-[10px] text-ink-soft">{ROLE_LABEL[role]}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[color:var(--color-hairline-strong)] bg-surface text-ink-soft transition-colors hover:bg-slate-50 hover:text-ink"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      <UpdatePrompt />

      {/* --- Contenido ------------------------------------------------------
          `min-h-0` es lo que hace que este bloque se encoja en lugar de
          empujar el muelle fuera de la pantalla. Sin él, `flex-1` respeta la
          altura natural del contenido y reaparece el desplazamiento. */}
      <main
        key={location.pathname}
        className="page-enter mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col px-3 py-3 sm:px-5 lg:pb-5"
      >
        {children}
      </main>

      {/* --- Muelle de navegación (móvil) ----------------------------------- */}
      <nav
        className="shrink-0 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden"
        aria-label="Navegación principal"
      >
        <ul
          className="dock mx-auto grid max-w-md rounded-[12px] p-1"
          style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }}
        >
          {mobileItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex flex-col items-center gap-0.5 rounded-[8px] py-1.5 text-[10px] font-medium',
                    'transition-colors duration-150',
                    isActive ? 'bg-violet-50 text-violet-800' : 'text-ink-soft',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={17} strokeWidth={isActive ? 2.4 : 2} />
                    <span>{item.short}</span>
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

/**
 * Cabecera de sección. Compacta a propósito: cada píxel que ocupa aquí es un
 * píxel que la tabla de abajo pierde, y con la pantalla como límite duro eso
 * se traduce en una fila menos por página.
 */
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
    <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.022em] text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 line-clamp-1 text-[12px] text-ink-soft">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
