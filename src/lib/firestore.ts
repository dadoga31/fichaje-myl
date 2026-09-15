/**
 * CAPA DE DATOS SOBRE FIRESTORE
 *
 * Traduce entre el modelo de dominio de la aplicación y las colecciones de
 * Firestore. Las garantías legales NO viven aquí: viven en `firestore.rules`,
 * que se evalúan en el servidor. Este fichero es un cliente educado; aunque
 * alguien lo reescribiera, las reglas seguirían rechazando lo que no toca.
 *
 * Diferencia deliberada con la versión PostgreSQL: no hay colección de
 * auditoría aparte. Como los asientos son inmutables por regla, el propio
 * asiento sustituido ES la instantánea del valor anterior, y la rectificación
 * ya guarda motivo, autor y momento. Una colección paralela solo añadiría una
 * copia que podría desincronizarse.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { requireAuth, requireDb } from './firebase'
import { computeDay, deriveStatus, toISODate } from './time'
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

const COL = {
  companies: 'companies',
  profiles: 'profiles',
  entries: 'time_entries',
  requests: 'correction_requests',
  logs: 'access_logs',
} as const

/** Firestore devuelve Timestamp; el dominio trabaja con ISO 8601. */
function iso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

function isoOrNull(value: unknown): string | null {
  return value == null ? null : iso(value)
}

function aTimeEntry(snap: QueryDocumentSnapshot<DocumentData>): TimeEntry {
  const d = snap.data()
  return {
    id: snap.id,
    company_id: d.company_id,
    user_id: d.user_id,
    entry_type: d.entry_type,
    event_at: iso(d.event_at),
    recorded_at: iso(d.recorded_at),
    work_date: d.work_date,
    origin: d.origin,
    supersedes_id: d.supersedes_id ?? null,
    is_annulment: d.is_annulment ?? false,
    reason: d.reason ?? null,
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    accuracy_m: d.accuracy_m ?? null,
    created_by: d.created_by,
    entry_hash: d.entry_hash ?? '',
    seq: d.seq ?? 0,
  }
}

function aProfile(snap: QueryDocumentSnapshot<DocumentData> | DocumentData, id: string): Profile {
  const d = 'data' in snap && typeof snap.data === 'function' ? snap.data() : snap
  return {
    id,
    company_id: d.company_id,
    full_name: d.full_name,
    email: d.email ?? null,
    role: d.role,
    employee_number: d.employee_number ?? null,
    nif: d.nif ?? null,
    contract_hours: Number(d.contract_hours ?? 40),
    geo_consent: d.geo_consent ?? false,
    geo_consent_at: isoOrNull(d.geo_consent_at),
    active: d.active ?? true,
  }
}

function aRequest(snap: QueryDocumentSnapshot<DocumentData>): CorrectionRequest {
  const d = snap.data()
  return {
    id: snap.id,
    company_id: d.company_id,
    user_id: d.user_id,
    target_entry_id: d.target_entry_id ?? null,
    requested_type: d.requested_type,
    requested_event_at: iso(d.requested_event_at),
    work_date: d.work_date,
    reason: d.reason,
    status: d.status,
    reviewed_by: d.reviewed_by ?? null,
    reviewed_at: isoOrNull(d.reviewed_at),
    review_note: d.review_note ?? null,
    resulting_entry_id: d.resulting_entry_id ?? null,
    created_at: iso(d.created_at),
  }
}

/**
 * Los asientos VIGENTES: ni anulados ni sustituidos por una rectificación.
 * El equivalente de la vista `effective_entries` de PostgreSQL, resuelto aquí
 * porque Firestore no tiene vistas.
 */
function vigentes(todos: TimeEntry[]): TimeEntry[] {
  const sustituidos = new Set(
    todos.map((e) => e.supersedes_id).filter((x): x is string => Boolean(x)),
  )
  return todos
    .filter((e) => !e.is_annulment && !sustituidos.has(e.id))
    .sort((a, b) => a.event_at.localeCompare(b.event_at))
}

// ---------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------
export async function fbGetSession(): Promise<{ profile: Profile; company: Company } | null> {
  const auth = requireAuth()

  // Al arrancar, Firebase aún no ha restaurado la sesión: hay que esperarla
  // o la aplicación creería que nadie ha iniciado sesión y pediría el acceso.
  const user: User | null =
    auth.currentUser ??
    (await new Promise<User | null>((resolve) => {
      const stop = onAuthStateChanged(auth, (u) => {
        stop()
        resolve(u)
      })
    }))

  if (!user) return null

  const db = requireDb()
  const perfilSnap = await getDoc(doc(db, COL.profiles, user.uid))
  if (!perfilSnap.exists()) {
    throw new Error(
      'Su cuenta existe pero no tiene perfil asignado. Avise a administración: ' +
        'hay que darle de alta con el script de personas.',
    )
  }
  const profile = aProfile(perfilSnap.data(), user.uid)

  const empresaSnap = await getDoc(doc(db, COL.companies, profile.company_id))
  const c = empresaSnap.data() ?? {}
  const company: Company = {
    id: profile.company_id,
    name: c.name ?? '—',
    cif: c.cif ?? '—',
    timezone: c.timezone ?? 'Europe/Madrid',
    geolocation_policy: c.geolocation_policy ?? 'disabled',
    geolocation_notice: c.geolocation_notice ?? null,
    retention_years: Number(c.retention_years ?? 4),
    weekly_hours: Number(c.weekly_hours ?? 40),
  }

  return { profile, company }
}

export async function fbSignIn(email: string, password: string): Promise<void> {
  try {
    await signInWithEmailAndPassword(requireAuth(), email, password)
  } catch (error) {
    throw new Error(traducirError(error))
  }
}

export async function fbSignOut(): Promise<void> {
  await signOut(requireAuth())
}

// ---------------------------------------------------------------------
// Fichaje
// ---------------------------------------------------------------------
export async function fbPunch(
  profile: Profile,
  company: Company,
  type: EntryType,
  geo: PunchGeo | null,
  opts: { offline?: boolean; eventAt?: string } = {},
): Promise<void> {
  const db = requireDb()
  const cuando = opts.eventAt ? new Date(opts.eventAt) : new Date()

  // La ubicación solo se guarda si la empresa la ha activado Y la persona ha
  // consentido. Sin las dos cosas no se envía ni un dato.
  const geoOk = company.geolocation_policy !== 'disabled' && profile.geo_consent && geo !== null

  try {
    await addDoc(collection(db, COL.entries), {
      company_id: profile.company_id,
      user_id: profile.id,
      entry_type: type,
      event_at: Timestamp.fromDate(cuando),
      // Sellado por el SERVIDOR: las reglas exigen que sea request.time, así
      // que un móvil con la hora cambiada no puede antedatar nada.
      recorded_at: serverTimestamp(),
      work_date: toISODate(cuando),
      origin: opts.offline ? 'employee_offline' : 'employee_app',
      supersedes_id: null,
      is_annulment: false,
      reason: null,
      latitude: geoOk ? geo!.latitude : null,
      longitude: geoOk ? geo!.longitude : null,
      accuracy_m: geoOk ? geo!.accuracy : null,
      geo_consent: geoOk,
      created_by: profile.id,
      device_label: navigator.userAgent.slice(0, 120),
    })
  } catch (error) {
    throw new Error(traducirError(error))
  }
}

async function entradasDe(userId: string, from: string, to: string): Promise<TimeEntry[]> {
  const db = requireDb()
  const q = query(
    collection(db, COL.entries),
    where('user_id', '==', userId),
    where('work_date', '>=', from),
    where('work_date', '<=', to),
  )
  try {
    const snap = await getDocs(q)
    return snap.docs.map(aTimeEntry)
  } catch (error) {
    throw new Error(traducirError(error))
  }
}

export async function fbGetEntries(userId: string, from: string, to: string): Promise<TimeEntry[]> {
  return vigentes(await entradasDe(userId, from, to))
}

/** Incluye los asientos sustituidos y anulados: vista de Inspección. */
export async function fbGetRawEntries(
  userId: string,
  from: string,
  to: string,
): Promise<TimeEntry[]> {
  const todas = await entradasDe(userId, from, to)
  return todas.sort((a, b) => a.event_at.localeCompare(b.event_at))
}

/**
 * Resumen diario. En PostgreSQL lo calculaba `daily_summary()`; aquí se
 * resuelve con el mismo algoritmo que ya usa la pantalla de fichaje para el
 * contador en vivo, de modo que servidor y cliente no puedan discrepar.
 */
export async function fbGetDailySummaries(
  userId: string,
  from: string,
  to: string,
): Promise<DailySummary[]> {
  const entradas = await fbGetEntries(userId, from, to)
  const porDia = new Map<string, TimeEntry[]>()
  for (const e of entradas) {
    const lista = porDia.get(e.work_date) ?? []
    lista.push(e)
    porDia.set(e.work_date, lista)
  }

  const todas = await entradasDe(userId, from, to)
  const sustituidos = new Set(
    todas.map((e) => e.supersedes_id).filter((x): x is string => Boolean(x)),
  )

  return [...porDia.entries()]
    .map(([work_date, lista]) => {
      const { workedSeconds, breakSeconds, isOpen } = computeDay(lista)
      return {
        work_date,
        first_in: lista.find((e) => e.entry_type === 'clock_in')?.event_at ?? null,
        last_out: [...lista].reverse().find((e) => e.entry_type === 'clock_out')?.event_at ?? null,
        worked_seconds: workedSeconds,
        break_seconds: breakSeconds,
        is_open: isOpen,
        entry_count: lista.length,
        has_corrections: lista.some(
          (e) => e.supersedes_id !== null || sustituidos.has(e.id) || e.origin === 'correction',
        ),
      }
    })
    .sort((a, b) => a.work_date.localeCompare(b.work_date))
}

// ---------------------------------------------------------------------
// Plantilla y administración
// ---------------------------------------------------------------------
export async function fbListProfiles(companyId: string): Promise<Profile[]> {
  const db = requireDb()
  const snap = await getDocs(
    query(collection(db, COL.profiles), where('company_id', '==', companyId)),
  )
  return snap.docs
    .map((d) => aProfile(d.data(), d.id))
    .filter((p) => p.active)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
}

export async function fbGetStaffLive(companyId: string): Promise<StaffLiveStatus[]> {
  const db = requireDb()
  const personas = await fbListProfiles(companyId)

  // Un día natural basta para saber quién está dentro ahora mismo.
  const desde = new Date()
  desde.setDate(desde.getDate() - 1)
  const snap = await getDocs(
    query(
      collection(db, COL.entries),
      where('company_id', '==', companyId),
      where('work_date', '>=', toISODate(desde)),
    ),
  )
  const porPersona = new Map<string, TimeEntry[]>()
  for (const e of vigentes(snap.docs.map(aTimeEntry))) {
    const lista = porPersona.get(e.user_id) ?? []
    lista.push(e)
    porPersona.set(e.user_id, lista)
  }

  return personas
    .filter((p) => p.role !== 'inspector')
    .map((p) => {
      const lista = porPersona.get(p.id) ?? []
      const ultimo = lista[lista.length - 1]
      return {
        user_id: p.id,
        full_name: p.full_name,
        employee_number: p.employee_number,
        contract_hours: p.contract_hours,
        last_action: ultimo?.entry_type ?? null,
        last_action_at: ultimo?.event_at ?? null,
        status: deriveStatus(ultimo),
      }
    })
}

export async function fbGetRequests(scope: {
  userId?: string
  companyId?: string
  companyWide?: boolean
}): Promise<CorrectionRequest[]> {
  const db = requireDb()
  const q = scope.companyWide
    ? query(collection(db, COL.requests), where('company_id', '==', scope.companyId))
    : query(collection(db, COL.requests), where('user_id', '==', scope.userId))

  const snap = await getDocs(q)
  const solicitudes = snap.docs.map(aRequest)

  // El nombre de quien solicita no está en el documento: se resuelve aparte
  // para no duplicar un dato que puede cambiar.
  if (scope.companyWide && scope.companyId) {
    const personas = await fbListProfiles(scope.companyId)
    const nombres = new Map(personas.map((p) => [p.id, p.full_name]))
    for (const s of solicitudes) s.user_name = nombres.get(s.user_id) ?? '—'
  }

  return solicitudes.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function fbCreateRequest(
  profile: Profile,
  input: {
    target_entry_id: string | null
    requested_type: EntryType
    requested_event_at: string
    work_date: string
    reason: string
  },
): Promise<void> {
  try {
    await addDoc(collection(requireDb(), COL.requests), {
      company_id: profile.company_id,
      user_id: profile.id,
      target_entry_id: input.target_entry_id,
      requested_type: input.requested_type,
      requested_event_at: Timestamp.fromDate(new Date(input.requested_event_at)),
      work_date: input.work_date,
      reason: input.reason,
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      resulting_entry_id: null,
      created_at: serverTimestamp(),
    })
  } catch (error) {
    throw new Error(traducirError(error))
  }
}

/**
 * Resolver una solicitud. Aprobar NO modifica el fichaje original: crea un
 * asiento de corrección que lo sustituye, y ambos quedan almacenados.
 *
 * La regla de los cuatro ojos no se comprueba aquí sino en `firestore.rules`:
 * si se comprobara solo en el cliente, bastaría con abrir la consola para
 * saltársela.
 */
export async function fbReviewRequest(
  reviewer: Profile,
  request: CorrectionRequest,
  approve: boolean,
  note?: string,
): Promise<void> {
  const db = requireDb()

  try {
    if (approve) {
      const motivo =
        'Rectificación aprobada. Motivo alegado por la persona trabajadora: ' +
        request.reason +
        (note?.trim() ? ` // Nota de administración: ${note.trim()}` : '')

      const nuevo = await addDoc(collection(db, COL.entries), {
        company_id: request.company_id,
        user_id: request.user_id,
        entry_type: request.requested_type,
        event_at: Timestamp.fromDate(new Date(request.requested_event_at)),
        recorded_at: serverTimestamp(),
        work_date: request.work_date,
        origin: 'correction',
        supersedes_id: request.target_entry_id,
        is_annulment: false,
        reason: motivo,
        latitude: null,
        longitude: null,
        accuracy_m: null,
        geo_consent: false,
        created_by: reviewer.id,
        correction_request_id: request.id,
      })

      await updateDoc(doc(db, COL.requests, request.id), {
        status: 'approved',
        reviewed_by: reviewer.id,
        reviewed_at: serverTimestamp(),
        review_note: note ?? null,
        resulting_entry_id: nuevo.id,
      })
      return
    }

    await updateDoc(doc(db, COL.requests, request.id), {
      status: 'rejected',
      reviewed_by: reviewer.id,
      reviewed_at: serverTimestamp(),
      review_note: note ?? null,
    })
  } catch (error) {
    throw new Error(traducirError(error))
  }
}

/**
 * Historial de rectificaciones.
 *
 * Se DERIVA de los propios asientos en vez de guardarse aparte: la
 * rectificación apunta al asiento que sustituye, y ese asiento es inmutable,
 * así que contiene el valor original tal cual estaba. Una tabla de auditoría
 * paralela solo añadiría una copia susceptible de desincronizarse.
 */
export async function fbGetAudits(companyId: string, limite = 200): Promise<TimeEntryAudit[]> {
  const db = requireDb()
  const snap = await getDocs(
    query(
      collection(db, COL.entries),
      where('company_id', '==', companyId),
      orderBy('recorded_at', 'desc'),
      limit(limite),
    ),
  )
  const todas = snap.docs.map(aTimeEntry)
  const porId = new Map(todas.map((e) => [e.id, e]))
  const personas = await fbListProfiles(companyId)
  const nombres = new Map(personas.map((p) => [p.id, p.full_name]))
  const roles = new Map(personas.map((p) => [p.id, p.role]))

  return todas
    .filter((e) => e.supersedes_id !== null)
    .map((e) => {
      const anterior = porId.get(e.supersedes_id!)
      return {
        id: e.id,
        entry_id: e.id,
        previous_entry_id: e.supersedes_id,
        action: e.is_annulment ? ('annul' as const) : ('correct' as const),
        old_event_at: anterior?.event_at ?? null,
        new_event_at: e.is_annulment ? null : e.event_at,
        old_entry_type: anterior?.entry_type ?? null,
        new_entry_type: e.is_annulment ? null : e.entry_type,
        reason: e.reason,
        actor_id: e.created_by,
        actor_role: roles.get(e.created_by) ?? 'admin',
        actor_name: nombres.get(e.created_by) ?? '—',
        created_at: e.recorded_at,
      }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function fbUpdateGeoConsent(userId: string, consent: boolean): Promise<void> {
  await updateDoc(doc(requireDb(), COL.profiles, userId), {
    geo_consent: consent,
    geo_consent_at: consent ? serverTimestamp() : null,
  })
}

export async function fbLogAccess(input: {
  companyId: string
  actorId: string
  actorRole: string
  action: string
  subjectUserId?: string | null
  periodStart?: string
  periodEnd?: string
}): Promise<void> {
  try {
    await addDoc(collection(requireDb(), COL.logs), {
      company_id: input.companyId,
      actor_id: input.actorId,
      actor_role: input.actorRole,
      action: input.action,
      subject_user_id: input.subjectUserId ?? null,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      detail: null,
      created_at: serverTimestamp(),
    })
  } catch {
    // Dejar constancia del acceso no debe impedir la descarga en sí.
  }
}

/**
 * SINCRONIZACIÓN EN TIEMPO REAL
 *
 * Firestore empuja cada cambio por WebSocket: un fichaje aparece en el panel
 * de quien supervisa en el mismo instante. La difusión respeta las reglas de
 * seguridad, así que nadie recibe lo que no podría consultar.
 */
export function fbSubscribe(
  companyId: string,
  userId: string,
  soloPropios: boolean,
  onChange: () => void,
): () => void {
  const db = requireDb()
  const desde = new Date()
  desde.setDate(desde.getDate() - 2)

  const q = soloPropios
    ? query(
        collection(db, COL.entries),
        where('user_id', '==', userId),
        where('work_date', '>=', toISODate(desde)),
      )
    : query(
        collection(db, COL.entries),
        where('company_id', '==', companyId),
        where('work_date', '>=', toISODate(desde)),
      )

  const parar = onSnapshot(
    q,
    (snap) => {
      // La primera instantánea es el estado actual, no un cambio: avisar de
      // ella provocaría una recarga redundante nada más abrir la pantalla.
      if (!snap.metadata.hasPendingWrites) onChange()
    },
    () => {
      /* Sin conexión, Firestore reintenta solo. */
    },
  )

  return parar
}

export async function fbCreateUser(email: string, password: string): Promise<string> {
  const cred = await createUserWithEmailAndPassword(requireAuth(), email, password)
  return cred.user.uid
}

// ---------------------------------------------------------------------
// Mensajes de error legibles
// ---------------------------------------------------------------------
function traducirError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? ''
  const mensaje = error instanceof Error ? error.message : String(error)

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
    return 'Correo o contraseña incorrectos.'
  }
  if (code === 'auth/user-not-found') return 'No existe ninguna cuenta con ese correo.'
  if (code === 'auth/too-many-requests') {
    return 'Demasiados intentos fallidos. Espere unos minutos antes de volver a probar.'
  }
  if (code === 'auth/network-request-failed' || /offline|network/i.test(mensaje)) {
    return 'Sin conexión con el servidor. El fichaje se guardará y se enviará al recuperarla.'
  }
  if (code === 'permission-denied') {
    return 'No tiene permiso para esta operación. Los fichajes registrados no se pueden modificar: solicite una rectificación.'
  }
  if (code === 'unavailable') {
    return 'Sin conexión con el servidor. El fichaje se guardará y se enviará al recuperarla.'
  }
  // Índice sin desplegar. Le pasa a quien publica las reglas desde la consola
  // y olvida que los índices van aparte; el mensaje de Firestore es un muro de
  // texto en inglés con un enlace enterrado, así que se traduce.
  if (code === 'failed-precondition' || /requires an index/i.test(mensaje)) {
    return (
      'Faltan los índices de la base de datos. Despliéguelos con ' +
      '«npx firebase deploy --only firestore:indexes», o abra el enlace que ' +
      'Firestore imprime en la consola del navegador para crearlos uno a uno.'
    )
  }
  return mensaje
}
