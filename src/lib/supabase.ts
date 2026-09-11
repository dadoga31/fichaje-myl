import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Hay backend real configurado. */
export const isConfigured = Boolean(url && anonKey)

/**
 * El modo demostración es EXPLÍCITO: exige VITE_DEMO=true.
 *
 * Antes bastaba con que faltasen las credenciales para caer en la demo. En un
 * despliegue real eso es peligroso: una variable de entorno mal escrita en
 * Vercel dejaría la app funcionando con datos ficticios, la gente ficharía
 * contra el navegador y no quedaría registro legal de nada. Ahora una
 * configuración incompleta se ve en pantalla y bloquea el acceso.
 */
export const isDemoMode = !isConfigured && import.meta.env.VITE_DEMO === 'true'

/** Ni backend ni demo: hay que configurar algo antes de poder usarla. */
export const isMisconfigured = !isConfigured && !isDemoMode

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        headers: { 'x-app': 'fichaje-myl' },
      },
      realtime: {
        // Suficiente para el fichaje de una plantilla; evita saturar el
        // canal si alguien deja el panel abierto todo el día.
        params: { eventsPerSecond: 5 },
      },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase no está configurado. Defina VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
    )
  }
  return supabase
}
