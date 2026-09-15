/**
 * Capa de acceso a datos. Un único punto por el que pasan todas las lecturas
 * y escrituras, con dos implementaciones intercambiables:
 *
 *   · Servidor (producción): la API del servidor instalado en la empresa.
 *   · Demo (VITE_DEMO=true): backend en memoria con las mismas reglas, para
 *     enseñar la interfaz sin instalar nada.
 *
 * Los componentes no saben cuál está activa.
 */
import { demoApi, subscribeDemo } from './demo'
import {
  ErrorDeRed,
  srvCambiarContrasena,
  srvCreateRequest,
  srvGetAudits,
  srvGetDailySummaries,
  srvGetEntries,
  srvGetRawEntries,
  srvGetRequests,
  srvGetSession,
  srvGetStaffLive,
  srvListProfiles,
  srvLogAccess,
  srvPunch,
  srvReviewRequest,
  srvSignIn,
  srvSignOut,
  srvSubscribe,
  srvUpdateGeoConsent,
  srvVerifyLedger,
} from './servidor'
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
 * Modo demostración. Explícito: exige compilar con VITE_DEMO=true.
 *
 * En la versión autoalojada ya no existe la pantalla de «falta configurar»:
 * la aplicación la sirve su propio servidor, así que si se abre, el servidor
 * está ahí por definición. Esa pantalla dejó de tener sentido al desaparecer
 * la configuración que había que introducir en el cliente.
 */
export const isDemoMode = import.meta.env.VITE_DEMO === 'true'

let sesion: SessionUser | null = null

function requiereSesion(): SessionUser {
  if (!sesion) throw new Error('No hay sesión iniciada.')
  return sesion
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
    sesion = { profile, company: demoApi.getCompany() }
    return sesion
  }

  sesion = await srvGetSession()
  return sesion
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  await srvSignIn(email, password)
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
  await srvSignOut()
}

/** Cambio de contraseña. Cierra el resto de sesiones de esa persona. */
export async function changePassword(actual: string, nueva: string): Promise<void> {
  if (isDemoMode) throw new Error('No disponible en el modo de demostración.')
  await srvCambiarContrasena(actual, nueva)
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

  // La transición válida la comprueba `public.punch()` en la base de datos,
  // dentro de la misma transacción que escribe el asiento. Comprobarla
  // además aquí —como hacía la versión anterior— añadía una consulta por
  // fichaje y abría la puerta a que ambas comprobaciones discreparan.
  return srvPunch(type, geo, opts)
}

export async function getEntries(userId: string, from: string, to: string): Promise<TimeEntry[]> {
  if (isDemoMode) return demoApi.getEntries(userId, from, to)
  return srvGetEntries(userId, from, to)
}

/** Incluye los asientos sustituidos y anulados: vista de Inspección. */
export async function getRawEntries(
  userId: string,
  from: string,
  to: string,
): Promise<TimeEntry[]> {
  if (isDemoMode) return demoApi.getRawEntries(userId, from, to)
  return srvGetRawEntries(userId, from, to)
}

export async function getDailySummaries(
  userId: string,
  from: string,
  to: string,
): Promise<DailySummary[]> {
  if (isDemoMode) return demoApi.getDailySummaries(userId, from, to)
  return srvGetDailySummaries(userId, from, to)
}

// ---------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------
export async function getStaffLive(): Promise<StaffLiveStatus[]> {
  if (isDemoMode) return demoApi.getStaffLive()
  return srvGetStaffLive()
}

export async function listProfiles(): Promise<Profile[]> {
  if (isDemoMode) return demoApi.listProfiles()
  return srvListProfiles()
}

export async function getRequests(scope: {
  userId?: string
  companyWide?: boolean
}): Promise<CorrectionRequest[]> {
  if (isDemoMode) return demoApi.getRequests(scope)
  return srvGetRequests(!scope.companyWide)
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
  await srvCreateRequest(input)
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
  await srvReviewRequest(requestId, approve, note)
}

export async function getAudits(filter: {
  entryIds?: string[]
  companyWide?: boolean
}): Promise<TimeEntryAudit[]> {
  if (isDemoMode) return demoApi.getAudits(filter)

  const todos = await srvGetAudits()
  if (filter.companyWide || !filter.entryIds) return todos
  const buscados = new Set(filter.entryIds)
  return todos.filter((a) => buscados.has(a.entry_id))
}

export async function getCorrectionAudits(): Promise<TimeEntryAudit[]> {
  if (isDemoMode) return demoApi.getCorrectionAudits()
  return srvGetAudits()
}

export async function updateGeoConsent(userId: string, consent: boolean): Promise<void> {
  if (isDemoMode) {
    demoApi.updateProfile(userId, {
      geo_consent: consent,
      geo_consent_at: consent ? new Date().toISOString() : null,
    })
    return
  }
  await srvUpdateGeoConsent(consent)
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
  // La empresa y el rol los deduce el servidor de la sesión: aceptarlos del
  // cliente permitiría anotar un acceso a nombre de otra persona.
  await srvLogAccess({
    action: input.action,
    subjectUserId: input.subjectUserId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  })
}

/**
 * Prueba de integridad del libro.
 *
 * Devuelve cuántos asientos tienen el sello descuadrado. En una instalación
 * en el propio equipo del cliente esta comprobación es la pieza central: el
 * administrador de ese PC SÍ puede abrir PostgreSQL y editar una fila, pero
 * no puede recalcular la cadena sin que esto lo delate.
 */
export async function verifyLedger(): Promise<number> {
  if (isDemoMode) return 0
  return srvVerifyLedger()
}

/** Distingue un corte de red de un rechazo del servidor: decide si se encola. */
export function esFalloDeRed(error: unknown): boolean {
  return error instanceof ErrorDeRed || (error as Error)?.name === 'ErrorDeRed'
}

// ---------------------------------------------------------------------
// Sincronización en tiempo real
// ---------------------------------------------------------------------
export function subscribeToChanges(
  _tables: Array<'time_entries' | 'correction_requests' | 'profiles'>,
  onChange: () => void,
): () => void {
  if (isDemoMode) {
    // En demo no hay servidor: solo se sincronizan las pestañas de este
    // navegador. Entre dispositivos distintos es imposible sin backend.
    return subscribeDemo(onChange)
  }
  if (!sesion) return () => {}
  return srvSubscribe(onChange)
}

export { requiereSesion }
