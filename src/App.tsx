import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './context/SessionContext'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import { EmployeeHome } from './pages/EmployeeHome'
import { HistoryPage } from './pages/HistoryPage'
import { CorrectionsPage } from './pages/CorrectionsPage'
import { TeamPage } from './pages/TeamPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
import { ReportsPage } from './pages/ReportsPage'
import { InspectionPage } from './pages/InspectionPage'
import { SettingsPage } from './pages/SettingsPage'
import type { UserRole } from './lib/types'

/** Ruta restringida por rol. Sin permiso, se devuelve al inicio sin drama. */
function Guarded({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { session } = useSession()
  if (!session) return null
  if (!roles.includes(session.profile.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { session, loading } = useSession()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (!session) return <LoginPage />

  // La Inspección no ficha: su punto de entrada es la vista de consulta.
  const isInspector = session.profile.role === 'inspector'

  return (
    <Layout>
      <Routes>
        <Route
          path="/"
          element={isInspector ? <Navigate to="/inspeccion" replace /> : <EmployeeHome />}
        />
        <Route path="/historial" element={<HistoryPage />} />
        <Route path="/correcciones" element={<CorrectionsPage />} />
        <Route
          path="/equipo"
          element={
            <Guarded roles={['manager', 'admin']}>
              <TeamPage />
            </Guarded>
          }
        />
        <Route
          path="/aprobaciones"
          element={
            <Guarded roles={['manager', 'admin']}>
              <ApprovalsPage />
            </Guarded>
          }
        />
        <Route
          path="/informes"
          element={
            <Guarded roles={['manager', 'admin']}>
              <ReportsPage />
            </Guarded>
          }
        />
        <Route
          path="/inspeccion"
          element={
            <Guarded roles={['admin', 'inspector']}>
              <InspectionPage />
            </Guarded>
          }
        />
        <Route path="/ajustes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
