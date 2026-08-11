import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getSession, signInDemo, signInWithPassword, signOut, type SessionUser } from '../lib/api'
import { isDemoMode } from '../lib/supabase'

interface SessionContextValue {
  session: SessionUser | null
  loading: boolean
  isDemo: boolean
  signIn: (email: string, password: string) => Promise<void>
  enterDemo: (userId: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const next = await getSession()
    setSession(next)
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const next = await getSession()
      if (alive) {
        setSession(next)
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      loading,
      isDemo: isDemoMode,
      async signIn(email, password) {
        await signInWithPassword(email, password)
        await refresh()
      },
      async enterDemo(userId) {
        signInDemo(userId)
        await refresh()
      },
      async logout() {
        await signOut()
        setSession(null)
      },
      refresh,
    }),
    [session, loading, refresh],
  )

  return <SessionContext value={value}>{children}</SessionContext>
}

export function useSession(): SessionContextValue {
  const ctx = use(SessionContext)
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>.')
  return ctx
}
