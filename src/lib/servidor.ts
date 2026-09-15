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

/**
 * CLIENTE DEL SERVIDOR DE FICHAJE
 *
 * Habla con el servidor que vive en el PC de la empresa. No hay SDK de
 * terceros ni claves en el navegador: la aplicación y la API comparten
 * origen, la sesión viaja en una cookie `httpOnly` —inaccesible desde
 * JavaScript— y el servidor decide qué puede ver cada persona.
 *
 * Esto es más simple que la versión anterior con Firebase, y además más
 * defendible: en el navegador no queda ninguna credencial que robar.
 */

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  let respuesta: Response
  try {
    respuesta = await fetch(ruta, {
      // Sin esto la cookie de sesión no se envía y todo responde 401.
      credentials: 'same-origin',
      headers: opciones.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opciones,
    })
  } catch {
    // `fetch` solo rechaza por fallo de red. Se distingue del resto porque es
    // el único caso en el que un fichaje debe encolarse en vez de perderse.
    throw new ErrorDeRed('Sin conexión con el servidor de la empresa.')
  }

  if (respuesta.status === 204) return undefined as T

  const texto = await respuesta.text()
  const datos = texto ? JSON.parse(texto) : null

  if (!respuesta.ok) {
    throw new Error(datos?.error ?? `Error ${respuesta.status} del servidor.`)
  }
  return datos as T
}

/** Fallo de red, no del servidor: es lo que decide si un fichaje se encola. */
export class ErrorDeRed extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeRed'
  }
}

// ---------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------
export async function srvGetSession(): Promise<{ profile: Profile; company: Company } | null> {
  return pedir<{ profile: Profile; company: Company } | null>('/api/sesion')
}

export async function srvSignIn(
  email: string,
  contrasena: string,
): Promise<{ debeCambiarContrasena: boolean }> {
  return pedir('/api/sesion', {
    method: 'POST',
    body: JSON.stringify({ email, contrasena }),
  })
}

export async function srvSignOut(): Promise<void> {
  await pedir('/api/sesion', { method: 'DELETE' })
}

export async function srvCambiarContrasena(actual: string, nueva: string): Promise<void> {
  await pedir('/api/contrasena', {
    method: 'POST',
    body: JSON.stringify({ actual, nueva }),
  })
}

// ---------------------------------------------------------------------
// Fichaje
// ---------------------------------------------------------------------
export async function srvPunch(
  tipo: EntryType,
  geo: PunchGeo | null,
  opts: { offline?: boolean; eventAt?: string } = {},
): Promise<TimeEntry> {
  return pedir<TimeEntry>('/api/fichajes', {
    method: 'POST',
    body: JSON.stringify({
      tipo,
      geo,
      offline: opts.offline ?? false,
      eventAt: opts.eventAt ?? null,
      dispositivo: navigator.userAgent.slice(0, 120),
    }),
  })
}

function parametros(userId: string, from: string, to: string) {
  return new URLSearchParams({ usuario: userId, desde: from, hasta: to }).toString()
}

export async function srvGetEntries(
  userId: string,
  from: string,
  to: string,
): Promise<TimeEntry[]> {
  return pedir<TimeEntry[]>(`/api/fichajes?${parametros(userId, from, to)}`)
}

export async function srvGetRawEntries(
  userId: string,
  from: string,
  to: string,
): Promise<TimeEntry[]> {
  return pedir<TimeEntry[]>(`/api/fichajes/crudos?${parametros(userId, from, to)}`)
}

export async function srvGetDailySummaries(
  userId: string,
  from: string,
  to: string,
): Promise<DailySummary[]> {
  const filas = await pedir<Array<Record<string, unknown>>>(
    `/api/resumenes?${parametros(userId, from, to)}`,
  )
  // Los `bigint` de PostgreSQL llegan como cadena: el controlador no los
  // convierte por su cuenta porque no todos caben en un número de
  // JavaScript. Estos son segundos de una jornada, así que caben de sobra.
  return filas.map((f) => ({
    work_date: f.work_date as string,
    first_in: (f.first_in as string) ?? null,
    last_out: (f.last_out as string) ?? null,
    worked_seconds: Number(f.worked_seconds ?? 0),
    break_seconds: Number(f.break_seconds ?? 0),
    is_open: Boolean(f.is_open),
    entry_count: Number(f.entry_count ?? 0),
    has_corrections: Boolean(f.has_corrections),
  }))
}

// ---------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------
export async function srvGetStaffLive(): Promise<StaffLiveStatus[]> {
  const filas = await pedir<Array<Record<string, unknown>>>('/api/plantilla')
  return filas.map((f) => ({
    user_id: f.user_id as string,
    full_name: f.full_name as string,
    employee_number: (f.employee_number as string) ?? null,
    contract_hours: Number(f.contract_hours ?? 40),
    last_action: (f.last_action as StaffLiveStatus['last_action']) ?? null,
    last_action_at: (f.last_action_at as string) ?? null,
    status: f.status as StaffLiveStatus['status'],
  }))
}

export async function srvListProfiles(): Promise<Profile[]> {
  const filas = await pedir<Array<Record<string, unknown>>>('/api/personas')
  return filas.map(
    (f) =>
      ({
        ...f,
        contract_hours: Number(f.contract_hours ?? 40),
      }) as unknown as Profile,
  )
}

export async function srvGetRequests(propias: boolean): Promise<CorrectionRequest[]> {
  return pedir<CorrectionRequest[]>(`/api/solicitudes?propias=${propias ? 'true' : 'false'}`)
}

export async function srvCreateRequest(input: {
  target_entry_id: string | null
  requested_type: EntryType
  requested_event_at: string
  work_date: string
  reason: string
}): Promise<void> {
  await pedir('/api/solicitudes', {
    method: 'POST',
    body: JSON.stringify({
      targetEntryId: input.target_entry_id,
      tipo: input.requested_type,
      eventAt: input.requested_event_at,
      workDate: input.work_date,
      motivo: input.reason,
    }),
  })
}

export async function srvReviewRequest(
  requestId: string,
  aprobar: boolean,
  nota?: string,
): Promise<void> {
  await pedir(`/api/solicitudes/${requestId}/resolver`, {
    method: 'POST',
    body: JSON.stringify({ aprobar, nota: nota ?? null }),
  })
}

export async function srvGetAudits(): Promise<TimeEntryAudit[]> {
  return pedir<TimeEntryAudit[]>('/api/auditoria')
}

export async function srvUpdateGeoConsent(consiente: boolean): Promise<void> {
  await pedir('/api/perfil/geo', {
    method: 'PATCH',
    body: JSON.stringify({ consiente }),
  })
}

export async function srvLogAccess(input: {
  action: string
  subjectUserId?: string | null
  periodStart?: string
  periodEnd?: string
}): Promise<void> {
  // Que falle el registro de un acceso no puede impedir el acceso en sí: es
  // una anotación, no un permiso.
  try {
    await pedir('/api/accesos', {
      method: 'POST',
      body: JSON.stringify({
        accion: input.action,
        sujeto: input.subjectUserId ?? null,
        desde: input.periodStart ?? null,
        hasta: input.periodEnd ?? null,
      }),
    })
  } catch {
    /* anotación perdida; la operación continúa */
  }
}

/**
 * Comprobación de la cadena de hashes.
 *
 * Devuelve cuántos asientos tienen el sello descuadrado. Cero significa que
 * nadie ha tocado el libro por detrás de la aplicación — ni siquiera con
 * acceso directo a PostgreSQL en el propio equipo.
 */
export async function srvVerifyLedger(): Promise<number> {
  const { anomalias } = await pedir<{ anomalias: number }>('/api/integridad')
  return anomalias
}

// ---------------------------------------------------------------------
// Sincronización en vivo
// ---------------------------------------------------------------------
/**
 * Se usa SSE y no WebSocket: sobre un túnel y un proxy, una conexión HTTP de
 * larga duración atraviesa lo que haya en medio sin negociar nada, y el
 * navegador la reconecta solo. Aquí el tráfico va en un solo sentido
 * —servidor a navegador—, que es justo para lo que sirve SSE.
 */
export function srvSubscribe(onChange: () => void): () => void {
  let fuente: EventSource | null = null
  let cerrado = false
  let reintento: number | null = null

  const conectar = () => {
    if (cerrado) return
    fuente = new EventSource('/api/eventos', { withCredentials: true })

    fuente.onmessage = () => onChange()

    fuente.onerror = () => {
      // EventSource reintenta por su cuenta, pero si el servidor devuelve un
      // error definitivo se queda cerrado. Se rearma a mano.
      fuente?.close()
      if (cerrado) return
      reintento = window.setTimeout(conectar, 5000)
    }
  }

  conectar()

  return () => {
    cerrado = true
    if (reintento !== null) window.clearTimeout(reintento)
    fuente?.close()
  }
}
