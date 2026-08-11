import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Sin credenciales configuradas la aplicación arranca en MODO DEMO, con un
 * backend en memoria que reproduce las mismas reglas del servidor. Sirve para
 * evaluar la interfaz sin infraestructura; no es apto para uso real, porque la
 * inalterabilidad solo es exigible del lado del servidor.
 */
export const isDemoMode = !url || !anonKey

export const supabase: SupabaseClient | null = isDemoMode
  ? null
  : createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        headers: { 'x-app': 'fichaje-myl' },
      },
    })

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase no está configurado. Defina VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
    )
  }
  return supabase
}
