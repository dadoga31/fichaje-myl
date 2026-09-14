/**
 * Capa de acceso a datos. Un único punto por el que pasan todas las lecturas
 * y escrituras, con dos implementaciones intercambiables:
 *
 *   · Firebase (producción): Firestore con Security Rules, Auth y sincronización
 *     en tiempo real.
 *   · Demo (VITE_DEMO=true): backend en memoria con las mismas reglas, para
 *     enseñar la interfaz sin desplegar nada.
 *
 * Los componentes no saben cuál está activa.
 */
import { isConfigured, isDemoMode } from './firebase'
import { demoApi, subscribeDemo } from './demo'
import {
  fbCreateRequest,
  fbGetAudits,
  fbGetDailySummaries,
  fbGetEntries,
  fbGetRawEntries,
  fbGetRequests,
  fbGetSession,
  fbGetStaffLive,
  fbListProfiles,
  fbLogAccess,
  fbPunch,
  fbReviewRequest,
  fbSignIn,
  fbSignOut,
  fbSubscribe,
  fbUpdateGeoConsent,
} from './firestore'
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

/**
 * La sesión activa, cacheada.
 *
 * Firestore necesita saber la empresa y el rol para casi todas las consultas,
 * y pedirlos en cada llamada multiplicaría las lecturas facturables. Se
 * refresca en cada `getSession()`, que es justo cuando puede haber cambiado.
 */
let sesion: SessionUser | null = null

function requiereSesion(): SessionUser {
  if (!sesion) throw new Error('No hay sesión iniciada.')
  return sesion
}

// ---------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------
export async function getSession(): Promise<SessionUser | null> {
  // Sin backend ni demo no hay nada que consultar: preguntar por la sesión
  // lanzaría una excepción justo en la pantalla que explica cómo configurarlo.
  if (!isConfigured && !isDemoMode) return null

  if (isDemoMode) {
    const userId = demoApi.getSessionUserId()
    if (!userId) return null
    const profile = demoApi.getProfile(userId)
    if (!profile) return null
    sesion = { profile, company: demoApi.getCompany() }
    return sesion
  }

  sesion = await fbGetSession()
  return sesion
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  await fbSignIn(email, password)
}

export function signInDemo(userId: string): Profile {
  return demoApi.signIn(userId)
}

export async function signOut(): Promise<void> {
  sesion = null
  if (isDemoMode) {
    demoApi.signOut()
    return
  }
  await fbSignOut()
}

// ---------------------------------------------------------------------
// Fichaje
// ---------------------------------------------------------------------
export async function punch(
  userId: string,
  type: EntryType,
  geo: PunchGeo | null,
  opts: { offline?: boolean; eventAt?: string } = {},
): Promise<TimeEntry | void> {
  if (isDemoMode) return demoApi.punch(userId, type, geo, opts.offline)

  const { profile, company } = requiereSesion()

  // La máquina de estados se comprueba aquí porque las reglas de Firestore no
  // pueden consultar "el último fichaje" sin encarecer cada escritura. Lo que
  // SÍ garantizan las reglas es lo que importa legalmente: que el asiento sea
  // tuyo, esté sellado por el servidor y no se pueda tocar después.
  const hoy = new Date()
  hoy.setDate(hoy.getDate() - 1)
  const recientes = await fbGetEntries(
    profile.id,
    hoy.toISOString().slice(0, 10),
    new Date().toISOString().slice(0, 10),
  )
  const ultimo = recientes[recientes.length - 1]
  const estado = ultimo ? deriveEstado(ultimo.entry_type, ultimo.event_at) : 'off'

  const permitido: Record<string, EntryType[]> = {
    off: ['clock_in'],
    working: ['break_start', 'clock_out'],
    break: ['break_end', 'clock_out'],
  }
  if (!permitido[estado].includes(type)) {
    throw new Error('Esa acción no es posible desde su estado actual.')
  }

  await fbPunch(profile, company, type, geo, opts)
}

/** Estado a partir del último asiento; 20 h sin cerrar se consideran olvido. */
function deriveEstado(tipo: EntryType, cuando: string): 'working' | 'break' | 'off' {
  const horas = (Date.now() - new Date(cuando).getTime()) / 3_600_000
  if (horas > 20) return 'off'
  if (tipo === 'clock_in' || tipo === 'break_end') return 'working'
  if (tipo === 'break_start') return 'break'
  return 'off'
}

export async function getEntries(userId: string, from: string, to: string): Promise<TimeEntry[]> {
  if (isDemoMode) return demoApi.getEntries(userId, from, to)
  return fbGetEntries(userId, from, to)
}

/** Incluye los asientos sustituidos y anulados: vista de Inspección. */
export async function getRawEntries(
  userId: string,
  from: string,
  to: string,
): Promise<TimeEntry[]> {
  if (isDemoMode) return demoApi.getRawEntries(userId, from, to)
  return fbGetRawEntries(userId, from, to)
}

export async function getDailySummaries(
  userId: string,
  from: string,
  to: string,
): Promise<DailySummary[]> {
  if (isDemoMode) return demoApi.getDailySummaries(userId, from, to)
  return fbGetDailySummaries(userId, from, to)
}

// ---------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------
export async function getStaffLive(): Promise<StaffLiveStatus[]> {
  if (isDemoMode) return demoApi.getStaffLive()
  return fbGetStaffLive(requiereSesion().profile.company_id)
}

export async function listProfiles(): Promise<Profile[]> {
  if (isDemoMode) return demoApi.listProfiles()
  return fbListProfiles(requiereSesion().profile.company_id)
}

export async function getRequests(scope: {
  userId?: string
  companyWide?: boolean
}): Promise<CorrectionRequest[]> {
  if (isDemoMode) return demoApi.getRequests(scope)
  return fbGetRequests({
    userId: scope.userId,
    companyWide: scope.companyWide,
    companyId: requiereSesion().profile.company_id,
  })
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
): Promise<void> {
  if (isDemoMode) {
    demoApi.createRequest(userId, input)
    return
  }
  await fbCreateRequest(requiereSesion().profile, input)
}

export async function reviewRequest(
  reviewerId: string,
  requestId: string,
  approve: boolean,
  note?: string,
): Promise<void> {
  if (isDemoMode) {
    demoApi.reviewRequest(reviewerId, requestId, approve, note)
    return
  }

  const { profile } = requiereSesion()
  const solicitudes = await fbGetRequests({
    companyWide: true,
    companyId: profile.company_id,
  })
  const solicitud = solicitudes.find((r) => r.id === requestId)
  if (!solicitud) throw new Error('Solicitud no encontrada.')

  await fbReviewRequest(profile, solicitud, approve, note)
}

export async function getAudits(filter: {
  entryIds?: string[]
  companyWide?: boolean
}): Promise<TimeEntryAudit[]> {
  if (isDemoMode) return demoApi.getAudits(filter)

  const todos = await fbGetAudits(requiereSesion().profile.company_id)
  if (filter.companyWide || !filter.entryIds) return todos
  const buscados = new Set(filter.entryIds)
  return todos.filter((a) => buscados.has(a.entry_id))
}

export async function getCorrectionAudits(): Promise<TimeEntryAudit[]> {
  if (isDemoMode) return demoApi.getCorrectionAudits()
  return fbGetAudits(requiereSesion().profile.company_id)
}

export async function updateGeoConsent(userId: string, consent: boolean): Promise<void> {
  if (isDemoMode) {
    demoApi.updateProfile(userId, {
      geo_consent: consent,
      geo_consent_at: consent ? new Date().toISOString() : null,
    })
    return
  }
  await fbUpdateGeoConsent(userId, consent)
}

/** Deja constancia de quién exporta o consulta qué. */
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
  await fbLogAccess(input)
}

/**
 * Prueba de integridad.
 *
 * En PostgreSQL existía una cadena de hashes encadenados que delataba
 * cualquier manipulación directa en base de datos. En Firestore esa cadena
 * exigiría una Cloud Function (plan Blaze) para calcularse en servidor: hecha
 * en el cliente no probaría nada, porque el cliente es justo lo que no se
 * puede dar por fiable.
 *
 * Lo que la sustituye está en `firestore.rules`: ningún camino permite
 * modificar ni borrar un asiento, y `recorded_at` lo sella el servidor. La
 * comprobación queda documentada en docs/CUMPLIMIENTO.md.
 */
export async function verifyLedger(): Promise<number> {
  return 0
}

// ---------------------------------------------------------------------
// Sincronización en tiempo real
// ---------------------------------------------------------------------
export function subscribeToChanges(
  tables: Array<'time_entries' | 'correction_requests' | 'profiles'>,
  onChange: () => void,
): () => void {
  if (isDemoMode) {
    // En demo no hay servidor: solo se sincronizan las pestañas de este
    // navegador. Entre dispositivos distintos es imposible sin backend.
    return subscribeDemo(onChange)
  }

  if (!sesion) return () => {}
  const { profile } = sesion

  // Quien solo puede ver lo suyo no necesita escuchar toda la empresa: menos
  // lecturas facturables y ningún dato de más viajando al dispositivo.
  const soloPropios = profile.role === 'employee' && !tables.includes('correction_requests')

  return fbSubscribe(profile.company_id, profile.id, soloPropios, onChange)
}
