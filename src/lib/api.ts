/**
 * Capa de acceso a datos. Un único punto por el que pasan todas las lecturas
 * y escrituras, con dos implementaciones intercambiables:
 *
 *   · Supabase (producción): PostgreSQL con RLS, triggers y RPC.
 *   · Demo (sin credenciales): backend en memoria con las mismas reglas.
 *
 * Los componentes no saben cuál está activa.
 */
import { isDemoMode, requireSupabase } from './supabase'
import { demoApi, subscribeDemo } from './demo'
import type {
  Company,
  CorrectionRequest,
  DailySummary,
  EntryType,
  Profile,
  PunchGeo,
  StaffLiveStatus,
  TimeEntry,
  TimeEntryAudit,
} from './types'

export interface SessionUser {
  profile: Profile
  company: Company
}

// ---------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------
export async function getSession(): Promise<SessionUser | null> {
  if (isDemoMode) {
    const userId = demoApi.getSessionUserId()
    if (!userId) return null
    const profile = demoApi.getProfile(userId)
    if (!profile) return null
    return { profile, company: demoApi.getCompany() }
  }

  const sb = requireSupabase()
  const { data } = await sb.auth.getUser()
  if (!data.user) return null

  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single()
  if (error || !profile) return null

  const { data: company } = await sb
    .from('companies')
    .select('*')
    .eq('id', profile.company_id)
    .single()

  return { profile: profile as Profile, company: company as Company }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const sb = requireSupabase()
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(traducirError(error.message))
}

export function signInDemo(userId: string): Profile {
  return demoApi.signIn(userId)
}

export async function signOut(): Promise<void> {
  if (isDemoMode) {
    demoApi.signOut()
    return
  }
  await requireSupabase().auth.signOut()
}

// ---------------------------------------------------------------------
// Fichaje
// ---------------------------------------------------------------------
export async function punch(
  userId: string,
  type: EntryType,
  geo: PunchGeo | null,
  opts: { offline?: boolean; eventAt?: string } = {},
): Promise<TimeEntry> {
  if (isDemoMode) return demoApi.punch(userId, type, geo, opts.offline)

  const sb = requireSupabase()
  const { data, error } = await sb.rpc('punch', {
    p_entry_type: type,
    p_event_at: opts.eventAt ?? new Date().toISOString(),
    p_latitude: geo?.latitude ?? null,
    p_longitude: geo?.longitude ?? null,
    p_accuracy: geo?.accuracy ?? null,
    p_device: navigator.userAgent.slice(0, 120),
    p_offline: opts.offline ?? false,
  })
  if (error) throw new Error(traducirError(error.message))
  return data as TimeEntry
}

export async function getEntries(
  userId: string,
  from: string,
  to: string,
): Promise<TimeEntry[]> {
  if (isDemoMode) return demoApi.getEntries(userId, from, to)

  const { data, error } = await requireSupabase()
    .from('effective_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('event_at', { ascending: true })
  if (error) throw new Error(traducirError(error.message))
  return (data ?? []) as TimeEntry[]
}

/** Incluye los asientos sustituidos y anulados: vista de Inspección. */
export async function getRawEntries(
  userId: string,
  from: string,
  to: string,
): Promise<TimeEntry[]> {
  if (isDemoMode) return demoApi.getRawEntries(userId, from, to)

  const { data, error } = await requireSupabase()
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('event_at', { ascending: true })
  if (error) throw new Error(traducirError(error.message))
  return (data ?? []) as TimeEntry[]
}

export async function getDailySummaries(
  userId: string,
  from: string,
  to: string,
): Promise<DailySummary[]> {
  if (isDemoMode) return demoApi.getDailySummaries(userId, from, to)

  const { data, error } = await requireSupabase().rpc('daily_summary', {
    p_user_id: userId,
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(traducirError(error.message))
  return (data ?? []) as DailySummary[]
}

// ---------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------
export async function getStaffLive(): Promise<StaffLiveStatus[]> {
  if (isDemoMode) return demoApi.getStaffLive()

  const { data, error } = await requireSupabase()
    .from('staff_live_status')
    .select('*')
    .order('full_name')
  if (error) throw new Error(traducirError(error.message))
  return (data ?? []) as StaffLiveStatus[]
}

export async function listProfiles(): Promise<Profile[]> {
  if (isDemoMode) return demoApi.listProfiles()

  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('*')
    .eq('active', true)
    .order('full_name')
  if (error) throw new Error(traducirError(error.message))
  return (data ?? []) as Profile[]
}

export async function getRequests(scope: {
  userId?: string
  companyWide?: boolean
}): Promise<CorrectionRequest[]> {
  if (isDemoMode) return demoApi.getRequests(scope)

  const sb = requireSupabase()
  let query = sb
    .from('correction_requests')
    .select('*, profiles!correction_requests_user_id_fkey(full_name)')
    .order('created_at', { ascending: false })
  if (!scope.companyWide && scope.userId) query = query.eq('user_id', scope.userId)

  const { data, error } = await query
  if (error) throw new Error(traducirError(error.message))

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as unknown as CorrectionRequest),
    user_name: (row.profiles as { full_name?: string } | null)?.full_name,
  }))
}

export async function createRequest(
  userId: string,
  input: {
    target_entry_id: string | null
    requested_type: EntryType
    requested_event_at: string
    work_date: string
    reason: string
  },
  companyId?: string,
): Promise<CorrectionRequest> {
  if (isDemoMode) return demoApi.createRequest(userId, input)

  const { data, error } = await requireSupabase()
    .from('correction_requests')
    .insert({ ...input, user_id: userId, company_id: companyId })
    .select()
    .single()
  if (error) throw new Error(traducirError(error.message))
  return data as CorrectionRequest
}

export async function reviewRequest(
  reviewerId: string,
  requestId: string,
  approve: boolean,
  note?: string,
): Promise<CorrectionRequest> {
  if (isDemoMode) return demoApi.reviewRequest(reviewerId, requestId, approve, note)

  const { data, error } = await requireSupabase().rpc('review_correction', {
    p_request_id: requestId,
    p_approve: approve,
    p_note: note ?? null,
  })
  if (error) throw new Error(traducirError(error.message))
  return data as CorrectionRequest
}

export async function getAudits(filter: {
  entryIds?: string[]
  companyWide?: boolean
}): Promise<TimeEntryAudit[]> {
  if (isDemoMode) return demoApi.getAudits(filter)

  const sb = requireSupabase()
  let query = sb
    .from('time_entry_audits')
    .select('*, profiles!time_entry_audits_actor_id_fkey(full_name)')
    .order('created_at', { ascending: false })
    .limit(500)
  if (!filter.companyWide && filter.entryIds?.length) {
    query = query.in('entry_id', filter.entryIds)
  }

  const { data, error } = await query
  if (error) throw new Error(traducirError(error.message))

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as unknown as TimeEntryAudit),
    actor_name: (row.profiles as { full_name?: string } | null)?.full_name,
  }))
}

export async function getCorrectionAudits(): Promise<TimeEntryAudit[]> {
  if (isDemoMode) return demoApi.getCorrectionAudits()
  const all = await getAudits({ companyWide: true })
  return all.filter((a) => a.action !== 'create')
}

export async function updateGeoConsent(userId: string, consent: boolean): Promise<void> {
  if (isDemoMode) {
    demoApi.updateProfile(userId, {
      geo_consent: consent,
      geo_consent_at: consent ? new Date().toISOString() : null,
    })
    return
  }
  const { error } = await requireSupabase()
    .from('profiles')
    .update({ geo_consent: consent, geo_consent_at: consent ? new Date().toISOString() : null })
    .eq('id', userId)
  if (error) throw new Error(traducirError(error.message))
}

/** Deja constancia de quién exporta o consulta qué (registro de accesos). */
export async function logAccess(input: {
  companyId: string
  actorId: string
  actorRole: string
  action: string
  subjectUserId?: string | null
  periodStart?: string
  periodEnd?: string
}): Promise<void> {
  if (isDemoMode) return
  await requireSupabase().from('access_logs').insert({
    company_id: input.companyId,
    actor_id: input.actorId,
    actor_role: input.actorRole,
    action: input.action,
    subject_user_id: input.subjectUserId ?? null,
    period_start: input.periodStart,
    period_end: input.periodEnd,
  })
}

/**
 * SINCRONIZACIÓN EN TIEMPO REAL
 *
 * Supabase Realtime empuja cada cambio por WebSocket, así que un fichaje
 * aparece en el panel de quien supervisa en el mismo instante, sin recargar
 * ni esperar a un sondeo.
 *
 * La difusión respeta la RLS de cada suscriptor: la persona trabajadora solo
 * recibe sus propios fichajes; administración, los de su empresa. Nadie
 * recibe lo que no podría consultar.
 *
 * Devuelve la función para cancelar la suscripción.
 */
export function subscribeToChanges(
  tables: Array<'time_entries' | 'correction_requests' | 'profiles'>,
  onChange: () => void,
): () => void {
  if (isDemoMode) {
    // En demo no hay servidor: solo se sincronizan las pestañas de este
    // navegador. Entre dispositivos distintos es imposible sin backend.
    return subscribeDemo(onChange)
  }

  const sb = requireSupabase()
  const channel = sb.channel(`fichaje-${tables.join('-')}`)

  for (const table of tables) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange())
  }

  channel.subscribe()

  return () => {
    void sb.removeChannel(channel)
  }
}

/** Prueba de integridad de la cadena hash (solo con Supabase). */
export async function verifyLedger(companyId: string): Promise<number> {
  if (isDemoMode) return 0
  const { data, error } = await requireSupabase().rpc('verify_ledger', {
    p_company_id: companyId,
  })
  if (error) throw new Error(traducirError(error.message))
  return (data ?? []).length
}

// ---------------------------------------------------------------------
// Mensajes de error legibles
// ---------------------------------------------------------------------
function traducirError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.'
  if (m.includes('email not confirmed')) return 'Debe confirmar su correo antes de acceder.'
  if (m.includes('registro inalterable')) {
    return 'Este registro no se puede modificar. Solicite una rectificación: quedará documentada.'
  }
  if (m.includes('row-level security')) {
    return 'No tiene permiso para realizar esta operación.'
  }
  if (m.includes('failed to fetch') || m.includes('networkerror')) {
    return 'Sin conexión con el servidor. El fichaje se guardará y se enviará al recuperarla.'
  }
  return message
}
