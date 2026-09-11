/**
 * BACKEND DE DEMOSTRACIÓN (solo cuando no hay Supabase configurado).
 *
 * Reproduce en memoria las reglas que en producción impone PostgreSQL:
 * el libro de fichajes es append-only, las rectificaciones generan un asiento
 * nuevo con su auditoría, y el estado se deriva siempre del último asiento
 * vigente. Permite evaluar la interfaz completa sin desplegar nada.
 *
 * AVISO: en un despliegue real la inalterabilidad NO puede depender del
 * navegador. Este módulo existe para la demo, no para producción.
 */
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
  WorkStatus,
} from './types'
import { computeDay, deriveStatus, toISODate } from './time'

const STORAGE_KEY = 'fichaje-myl:demo:v1'
const SESSION_KEY = 'fichaje-myl:demo:session'

/**
 * Acceso tolerante al almacenamiento. En un iframe restringido o con las
 * cookies de terceros bloqueadas, `localStorage` lanza excepción al tocarlo;
 * la demo debe seguir funcionando en memoria en vez de caerse.
 */
const memoryFallback = new Map<string, string>()

const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return memoryFallback.get(key) ?? null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      memoryFallback.set(key, value)
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      /* nada que borrar */
    }
    memoryFallback.delete(key)
  },
}

interface DemoState {
  company: Company
  profiles: Profile[]
  entries: TimeEntry[]
  audits: TimeEntryAudit[]
  requests: CorrectionRequest[]
  seq: number
}

const COMPANY_ID = 'demo-company-0001'

function uid(): string {
  return crypto.randomUUID()
}

/** Sello de integridad simulado. En producción lo calcula PostgreSQL. */
function fakeHash(seed: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0
    h2 = Math.imul(h2 + seed.charCodeAt(i) * (i + 1), 2246822519) >>> 0
  }
  return (h1.toString(16) + h2.toString(16)).padStart(16, '0').repeat(4).slice(0, 64)
}

// ---------------------------------------------------------------------
// Semilla: plantilla ficticia con dos meses de historial verosímil
// ---------------------------------------------------------------------
const DEMO_PEOPLE: Array<Omit<Profile, 'company_id'>> = [
  { id: 'demo-user-ana', full_name: 'Ana Pérez Ruiz', email: 'ana.perez@acme.test', role: 'employee', employee_number: 'E-001', nif: '12345678Z', contract_hours: 40, geo_consent: false, geo_consent_at: null, active: true },
  { id: 'demo-user-luis', full_name: 'Luis Marín Soto', email: 'luis.marin@acme.test', role: 'admin', employee_number: 'A-001', nif: '87654321X', contract_hours: 40, geo_consent: false, geo_consent_at: null, active: true },
  { id: 'demo-user-carmen', full_name: 'Carmen Ortiz Vega', email: 'carmen.ortiz@acme.test', role: 'employee', employee_number: 'E-002', nif: '11223344S', contract_hours: 40, geo_consent: false, geo_consent_at: null, active: true },
  { id: 'demo-user-javier', full_name: 'Javier Nadal Gil', email: 'javier.nadal@acme.test', role: 'employee', employee_number: 'E-003', nif: '55667788L', contract_hours: 30, geo_consent: false, geo_consent_at: null, active: true },
  { id: 'demo-user-marta', full_name: 'Marta Bueno Lara', email: 'marta.bueno@acme.test', role: 'manager', employee_number: 'M-001', nif: '99887766K', contract_hours: 40, geo_consent: false, geo_consent_at: null, active: true },
  { id: 'demo-user-inspeccion', full_name: 'Inspección de Trabajo', email: 'inspeccion@acme.test', role: 'inspector', employee_number: 'I-001', nif: null, contract_hours: 0, geo_consent: false, geo_consent_at: null, active: true },
]

/** Variación determinista por persona y día: la demo se ve igual en cada carga. */
function jitter(seed: string, spread: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return (h % (spread * 2 + 1)) - spread
}

function buildSeed(): DemoState {
  const company: Company = {
    id: COMPANY_ID,
    name: 'ACME Servicios SL',
    cif: 'B12345678',
    timezone: 'Europe/Madrid',
    geolocation_policy: 'disabled',
    geolocation_notice: null,
    retention_years: 4,
    weekly_hours: 40,
  }

  const profiles: Profile[] = DEMO_PEOPLE.map((p) => ({ ...p, company_id: COMPANY_ID }))
  const entries: TimeEntry[] = []
  const audits: TimeEntryAudit[] = []
  let seq = 0

  const push = (
    userId: string,
    type: EntryType,
    at: Date,
    extra: Partial<TimeEntry> = {},
  ): TimeEntry => {
    seq += 1
    const entry: TimeEntry = {
      id: uid(),
      company_id: COMPANY_ID,
      user_id: userId,
      entry_type: type,
      event_at: at.toISOString(),
      recorded_at: at.toISOString(),
      work_date: toISODate(at),
      origin: 'employee_app',
      supersedes_id: null,
      is_annulment: false,
      reason: null,
      latitude: null,
      longitude: null,
      accuracy_m: null,
      created_by: userId,
      entry_hash: fakeHash(`${userId}|${type}|${at.toISOString()}|${seq}`),
      seq,
      ...extra,
    }
    entries.push(entry)
    audits.push({
      id: uid(),
      entry_id: entry.id,
      previous_entry_id: entry.supersedes_id,
      action: entry.supersedes_id ? 'correct' : 'create',
      old_event_at: null,
      new_event_at: entry.event_at,
      old_entry_type: null,
      new_entry_type: entry.entry_type,
      reason: entry.reason,
      actor_id: entry.created_by,
      actor_role: profiles.find((p) => p.id === entry.created_by)?.role ?? 'employee',
      created_at: entry.recorded_at,
    })
    return entry
  }

  const at = (day: Date, h: number, m: number): Date => {
    const d = new Date(day)
    d.setHours(h, m, 0, 0)
    return d
  }

  const today = new Date()
  const workers = profiles.filter((p) => p.role !== 'inspector')

  // 45 días naturales hacia atrás, saltando fines de semana.
  for (let back = 45; back >= 1; back--) {
    const day = new Date(today)
    day.setDate(day.getDate() - back)
    const dow = day.getDay()
    if (dow === 0 || dow === 6) continue

    for (const person of workers) {
      const key = `${person.id}-${toISODate(day)}`
      // Una ausencia esporádica hace la demo más creíble.
      if (jitter(key + 'absent', 12) === 0) continue

      const partTime = person.contract_hours < 40
      const inH = 8 + (jitter(key + 'in', 1) > 0 ? 1 : 0)
      const inM = 30 + jitter(key + 'inm', 12)
      const start = at(day, inH, Math.max(0, inM))

      const lunch = at(day, partTime ? 12 : 14, 0 + jitter(key + 'l', 15))
      const backFromLunch = new Date(lunch.getTime() + (partTime ? 20 : 45) * 60_000)
      const outH = partTime ? 14 : 17
      const end = at(day, outH, 30 + jitter(key + 'out', 20))

      push(person.id, 'clock_in', start)
      push(person.id, 'break_start', lunch)
      push(person.id, 'break_end', backFromLunch)
      push(person.id, 'clock_out', end)
    }
  }

  // --- Caso didáctico: salida olvidada, rectificada y auditada ------------
  const ana = profiles[0]
  const target = [...entries]
    .reverse()
    .find((e) => e.user_id === ana.id && e.entry_type === 'clock_out')

  if (target) {
    const corrected = new Date(new Date(target.event_at).getTime() + 70 * 60_000)
    seq += 1
    const fix: TimeEntry = {
      id: uid(),
      company_id: COMPANY_ID,
      user_id: ana.id,
      entry_type: 'clock_out',
      event_at: corrected.toISOString(),
      recorded_at: new Date(corrected.getTime() + 20 * 3_600_000).toISOString(),
      work_date: target.work_date,
      origin: 'correction',
      supersedes_id: target.id,
      is_annulment: false,
      reason:
        'Rectificación aprobada. Motivo alegado por la persona trabajadora: ' +
        'me quedé terminando el cierre de mes y fiché la salida antes de tiempo. ' +
        '// Nota de administración: verificado con el registro de accesos del edificio.',
      latitude: null,
      longitude: null,
      accuracy_m: null,
      created_by: 'demo-user-luis',
      entry_hash: fakeHash(`fix|${target.id}|${corrected.toISOString()}`),
      seq,
    }
    entries.push(fix)
    audits.push({
      id: uid(),
      entry_id: fix.id,
      previous_entry_id: target.id,
      action: 'correct',
      old_event_at: target.event_at,
      new_event_at: fix.event_at,
      old_entry_type: target.entry_type,
      new_entry_type: fix.entry_type,
      reason: fix.reason,
      actor_id: 'demo-user-luis',
      actor_role: 'admin',
      created_at: fix.recorded_at,
    })
  }

  // --- Jornada de hoy en curso para parte de la plantilla -----------------
  const now = new Date()
  if (now.getDay() !== 0 && now.getDay() !== 6 && now.getHours() >= 9) {
    const startToday = at(now, 8, 45)
    if (startToday < now) {
      push('demo-user-carmen', 'clock_in', startToday)
      const cBreak = at(now, 11, 15)
      if (cBreak < now) push('demo-user-carmen', 'break_start', cBreak)

      push('demo-user-javier', 'clock_in', at(now, 8, 30))
      const jl = at(now, 12, 0)
      if (jl < now) {
        push('demo-user-javier', 'break_start', jl)
        const jb = at(now, 12, 20)
        if (jb < now) push('demo-user-javier', 'break_end', jb)
      }
    }
  }

  // --- Solicitud pendiente de resolver, para la bandeja de RRHH ----------
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const requests: CorrectionRequest[] = [
    {
      id: uid(),
      company_id: COMPANY_ID,
      user_id: 'demo-user-carmen',
      user_name: 'Carmen Ortiz Vega',
      target_entry_id: null,
      requested_type: 'clock_in',
      requested_event_at: at(yesterday, 8, 15).toISOString(),
      work_date: toISODate(yesterday),
      reason:
        'Ayer el móvil se quedó sin batería al llegar y no pude fichar la entrada. ' +
        'Entré a las 08:15, mi responsable puede confirmarlo.',
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      created_at: new Date(today.getTime() - 3 * 3_600_000).toISOString(),
    },
  ]

  return { company, profiles, entries, audits, requests, seq }
}

// ---------------------------------------------------------------------
// Persistencia en localStorage
// ---------------------------------------------------------------------
let state: DemoState | null = null

function load(): DemoState {
  if (state) return state
  try {
    const raw = safeStorage.get(STORAGE_KEY)
    if (raw) {
      state = JSON.parse(raw) as DemoState
      return state
    }
  } catch {
    /* Semilla nueva si el almacenamiento está corrupto. */
  }
  state = buildSeed()
  save()
  return state
}

/** Oyentes de cambios, para que la demo también se refresque sola. */
const demoListeners = new Set<() => void>()

function save(): void {
  if (!state) return
  safeStorage.set(STORAGE_KEY, JSON.stringify(state))
  for (const listener of demoListeners) listener()
}

/**
 * Suscripción a cambios en modo demostración. Solo alcanza a las pestañas
 * de ESTE navegador (evento `storage` entre pestañas), porque la demo no
 * tiene servidor: los datos viven en el propio dispositivo. Para que una
 * jornada aparezca en el móvil de otra persona hace falta el backend real.
 */
export function subscribeDemo(onChange: () => void): () => void {
  demoListeners.add(onChange)

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      state = null // otra pestaña escribió: releer desde el almacenamiento
      onChange()
    }
  }
  window.addEventListener('storage', onStorage)

  return () => {
    demoListeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function resetDemo(): void {
  safeStorage.remove(STORAGE_KEY)
  safeStorage.remove(SESSION_KEY)
  state = null
  load()
}

/** Asientos vigentes: ni anulados ni sustituidos. Espejo de effective_entries. */
function effective(s: DemoState): TimeEntry[] {
  const superseded = new Set(s.entries.map((e) => e.supersedes_id).filter(Boolean) as string[])
  return s.entries.filter((e) => !e.is_annulment && !superseded.has(e.id))
}

// ---------------------------------------------------------------------
// API de demostración
// ---------------------------------------------------------------------
export const demoApi = {
  listDemoUsers(): Profile[] {
    return load().profiles
  },

  getSessionUserId(): string | null {
    return safeStorage.get(SESSION_KEY)
  },

  signIn(userId: string): Profile {
    const s = load()
    const profile = s.profiles.find((p) => p.id === userId)
    if (!profile) throw new Error('Usuario de demostración no encontrado.')
    safeStorage.set(SESSION_KEY, userId)
    return profile
  },

  signOut(): void {
    safeStorage.remove(SESSION_KEY)
  },

  getCompany(): Company {
    return load().company
  },

  updateCompany(patch: Partial<Company>): Company {
    const s = load()
    if (patch.retention_years !== undefined && patch.retention_years < 4) {
      throw new Error('La conservación no puede ser inferior a 4 años (Art. 34.9 ET).')
    }
    if (
      patch.geolocation_policy &&
      patch.geolocation_policy !== 'disabled' &&
      !(patch.geolocation_notice ?? s.company.geolocation_notice)
    ) {
      throw new Error('Debe publicar el aviso informativo antes de activar la geolocalización.')
    }
    s.company = { ...s.company, ...patch }
    save()
    return s.company
  },

  getProfile(userId: string): Profile | null {
    return load().profiles.find((p) => p.id === userId) ?? null
  },

  updateProfile(userId: string, patch: Partial<Profile>): Profile {
    const s = load()
    const p = s.profiles.find((x) => x.id === userId)
    if (!p) throw new Error('Perfil no encontrado.')
    Object.assign(p, patch)
    save()
    return p
  },

  getEntries(userId: string, from: string, to: string): TimeEntry[] {
    return effective(load())
      .filter((e) => e.user_id === userId && e.work_date >= from && e.work_date <= to)
      .sort((a, b) => a.event_at.localeCompare(b.event_at))
  },

  /** Incluye los asientos históricos: es la vista para Inspección. */
  getRawEntries(userId: string, from: string, to: string): TimeEntry[] {
    return load()
      .entries.filter((e) => e.user_id === userId && e.work_date >= from && e.work_date <= to)
      .sort((a, b) => a.event_at.localeCompare(b.event_at))
  },

  getStatus(userId: string): WorkStatus {
    const list = this.getEntries(userId, '0000-01-01', '9999-12-31')
    return deriveStatus(list[list.length - 1])
  },

  punch(userId: string, type: EntryType, geo: PunchGeo | null, offline = false): TimeEntry {
    const s = load()
    const profile = s.profiles.find((p) => p.id === userId)
    if (!profile) throw new Error('Perfil no encontrado.')
    if (profile.role === 'inspector') {
      throw new Error('El rol de inspección es de solo lectura y no puede fichar.')
    }

    // Misma máquina de estados que el RPC punch() del servidor.
    const status = this.getStatus(userId)
    const legal: Record<WorkStatus, EntryType[]> = {
      off: ['clock_in'],
      working: ['break_start', 'clock_out'],
      break: ['break_end', 'clock_out'],
    }
    if (!legal[status].includes(type)) {
      throw new Error('Esa acción no es posible desde su estado actual.')
    }

    const geoAllowed = s.company.geolocation_policy !== 'disabled' && profile.geo_consent
    if (s.company.geolocation_policy === 'required' && !geo) {
      throw new Error('Esta empresa exige registrar la ubicación al fichar.')
    }

    const now = new Date()
    s.seq += 1
    const entry: TimeEntry = {
      id: uid(),
      company_id: COMPANY_ID,
      user_id: userId,
      entry_type: type,
      event_at: now.toISOString(),
      recorded_at: now.toISOString(),
      work_date: toISODate(now),
      origin: offline ? 'employee_offline' : 'employee_app',
      supersedes_id: null,
      is_annulment: false,
      reason: null,
      latitude: geoAllowed && geo ? geo.latitude : null,
      longitude: geoAllowed && geo ? geo.longitude : null,
      accuracy_m: geoAllowed && geo ? geo.accuracy : null,
      created_by: userId,
      entry_hash: fakeHash(`${userId}|${type}|${now.toISOString()}|${s.seq}`),
      seq: s.seq,
    }
    s.entries.push(entry)
    s.audits.push({
      id: uid(),
      entry_id: entry.id,
      previous_entry_id: null,
      action: 'create',
      old_event_at: null,
      new_event_at: entry.event_at,
      old_entry_type: null,
      new_entry_type: type,
      reason: null,
      actor_id: userId,
      actor_role: profile.role,
      created_at: entry.recorded_at,
    })
    save()
    return entry
  },

  getDailySummaries(userId: string, from: string, to: string): DailySummary[] {
    const entries = this.getEntries(userId, from, to)
    const byDate = new Map<string, TimeEntry[]>()
    for (const e of entries) {
      const list = byDate.get(e.work_date) ?? []
      list.push(e)
      byDate.set(e.work_date, list)
    }
    const superseded = new Set(
      load().entries.map((e) => e.supersedes_id).filter(Boolean) as string[],
    )
    return [...byDate.entries()]
      .map(([work_date, list]) => {
        const { workedSeconds, breakSeconds, isOpen } = computeDay(list)
        return {
          work_date,
          first_in: list.find((e) => e.entry_type === 'clock_in')?.event_at ?? null,
          last_out:
            [...list].reverse().find((e) => e.entry_type === 'clock_out')?.event_at ?? null,
          worked_seconds: workedSeconds,
          break_seconds: breakSeconds,
          is_open: isOpen,
          entry_count: list.length,
          has_corrections: list.some(
            (e) => e.supersedes_id !== null || superseded.has(e.id) || e.origin === 'correction',
          ),
        }
      })
      .sort((a, b) => a.work_date.localeCompare(b.work_date))
  },

  getStaffLive(): StaffLiveStatus[] {
    const s = load()
    return s.profiles
      .filter((p) => p.active && p.role !== 'inspector')
      .map((p) => {
        const list = this.getEntries(p.id, '0000-01-01', '9999-12-31')
        const last = list[list.length - 1]
        return {
          user_id: p.id,
          full_name: p.full_name,
          employee_number: p.employee_number,
          contract_hours: p.contract_hours,
          last_action: last?.entry_type ?? null,
          last_action_at: last?.event_at ?? null,
          status: deriveStatus(last),
        }
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
  },

  getRequests(scope: { userId?: string; companyWide?: boolean }): CorrectionRequest[] {
    const s = load()
    return s.requests
      .filter((r) => (scope.companyWide ? true : r.user_id === scope.userId))
      .map((r) => ({
        ...r,
        user_name: s.profiles.find((p) => p.id === r.user_id)?.full_name ?? '—',
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  createRequest(
    userId: string,
    input: {
      target_entry_id: string | null
      requested_type: EntryType
      requested_event_at: string
      work_date: string
      reason: string
    },
  ): CorrectionRequest {
    const s = load()
    if (input.reason.trim().length < 10) {
      throw new Error('Explique el motivo con al menos 10 caracteres.')
    }
    const req: CorrectionRequest = {
      id: uid(),
      company_id: COMPANY_ID,
      user_id: userId,
      ...input,
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      created_at: new Date().toISOString(),
    }
    s.requests.push(req)
    save()
    return req
  },

  reviewRequest(
    reviewerId: string,
    requestId: string,
    approve: boolean,
    note?: string,
  ): CorrectionRequest {
    const s = load()
    const reviewer = s.profiles.find((p) => p.id === reviewerId)
    if (!reviewer || !['admin', 'manager'].includes(reviewer.role)) {
      throw new Error('Solo administración puede resolver solicitudes.')
    }
    const req = s.requests.find((r) => r.id === requestId)
    if (!req) throw new Error('Solicitud no encontrada.')
    if (req.status !== 'pending') throw new Error('La solicitud ya fue resuelta.')
    if (req.user_id === reviewerId) {
      throw new Error('No puede aprobar su propia solicitud de rectificación.')
    }

    req.status = approve ? 'approved' : 'rejected'
    req.reviewed_by = reviewerId
    req.reviewed_at = new Date().toISOString()
    req.review_note = note ?? null

    if (approve) {
      const target = req.target_entry_id
        ? s.entries.find((e) => e.id === req.target_entry_id)
        : undefined

      s.seq += 1
      const reason =
        'Rectificación aprobada. Motivo alegado por la persona trabajadora: ' +
        req.reason +
        (note?.trim() ? ` // Nota de administración: ${note.trim()}` : '')

      const entry: TimeEntry = {
        id: uid(),
        company_id: COMPANY_ID,
        user_id: req.user_id,
        entry_type: req.requested_type,
        event_at: req.requested_event_at,
        recorded_at: new Date().toISOString(),
        work_date: req.work_date,
        origin: 'correction',
        supersedes_id: target?.id ?? null,
        is_annulment: false,
        reason,
        latitude: null,
        longitude: null,
        accuracy_m: null,
        created_by: reviewerId,
        entry_hash: fakeHash(`fix|${req.id}|${req.requested_event_at}`),
        seq: s.seq,
      }
      s.entries.push(entry)
      s.audits.push({
        id: uid(),
        entry_id: entry.id,
        previous_entry_id: target?.id ?? null,
        action: target ? 'correct' : 'create',
        old_event_at: target?.event_at ?? null,
        new_event_at: entry.event_at,
        old_entry_type: target?.entry_type ?? null,
        new_entry_type: entry.entry_type,
        reason,
        actor_id: reviewerId,
        actor_role: reviewer.role,
        created_at: entry.recorded_at,
      })
      req.resulting_entry_id = entry.id
    }

    save()
    return req
  },

  getAudits(filter: { entryIds?: string[]; companyWide?: boolean }): TimeEntryAudit[] {
    const s = load()
    return s.audits
      .filter((a) => (filter.companyWide ? true : filter.entryIds?.includes(a.entry_id)))
      .map((a) => ({
        ...a,
        actor_name: s.profiles.find((p) => p.id === a.actor_id)?.full_name ?? '—',
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  /** Solo las auditorías que documentan un cambio (lo que mira la Inspección). */
  getCorrectionAudits(): TimeEntryAudit[] {
    return this.getAudits({ companyWide: true }).filter((a) => a.action !== 'create')
  },

  listProfiles(): Profile[] {
    return load()
      .profiles.filter((p) => p.active)
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
  },
}
