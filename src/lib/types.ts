/** Tipos de dominio. Espejo exacto del esquema SQL de supabase/migrations. */

export type UserRole = 'employee' | 'manager' | 'admin' | 'inspector'

export type EntryType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out'

export type EntryOrigin =
  | 'employee_app'
  | 'employee_offline'
  | 'admin_manual'
  | 'correction'
  | 'import'

export type GeolocationPolicy = 'disabled' | 'optional' | 'required'

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

/** Estado de la persona trabajadora en este momento. */
export type WorkStatus = 'working' | 'break' | 'off'

export interface Company {
  id: string
  name: string
  cif: string
  timezone: string
  geolocation_policy: GeolocationPolicy
  geolocation_notice: string | null
  retention_years: number
  weekly_hours: number
}

export interface Profile {
  id: string
  company_id: string
  full_name: string
  email: string | null
  role: UserRole
  employee_number: string | null
  nif: string | null
  contract_hours: number
  geo_consent: boolean
  geo_consent_at: string | null
  active: boolean
}

export interface TimeEntry {
  id: string
  company_id: string
  user_id: string
  entry_type: EntryType
  event_at: string
  recorded_at: string
  work_date: string
  origin: EntryOrigin
  supersedes_id: string | null
  is_annulment: boolean
  reason: string | null
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  created_by: string
  entry_hash: string
  seq: number
}

export interface TimeEntryAudit {
  id: string
  entry_id: string
  previous_entry_id: string | null
  action: 'create' | 'correct' | 'annul' | 'approve' | 'reject'
  old_event_at: string | null
  new_event_at: string | null
  old_entry_type: EntryType | null
  new_entry_type: EntryType | null
  reason: string | null
  actor_id: string
  actor_role: UserRole
  actor_name?: string
  created_at: string
}

export interface CorrectionRequest {
  id: string
  company_id: string
  user_id: string
  user_name?: string
  target_entry_id: string | null
  requested_type: EntryType
  requested_event_at: string
  work_date: string
  reason: string
  status: RequestStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  /** Asiento de corrección generado al aprobar la solicitud. */
  resulting_entry_id?: string | null
  created_at: string
}

export interface DailySummary {
  work_date: string
  first_in: string | null
  last_out: string | null
  worked_seconds: number
  break_seconds: number
  is_open: boolean
  entry_count: number
  has_corrections: boolean
}

export interface StaffLiveStatus {
  user_id: string
  full_name: string
  employee_number: string | null
  contract_hours: number
  last_action: EntryType | null
  last_action_at: string | null
  status: WorkStatus
}

/** Coordenadas capturadas al fichar, si procede. */
export interface PunchGeo {
  latitude: number
  longitude: number
  accuracy: number
}

/** Fichaje pendiente de sincronizar, guardado en IndexedDB. */
export interface QueuedPunch {
  localId: string
  entry_type: EntryType
  event_at: string
  geo: PunchGeo | null
  device: string
  queued_at: string
  attempts: number
  lastError?: string
}

export const ENTRY_LABEL: Record<EntryType, string> = {
  clock_in: 'Entrada',
  break_start: 'Inicio de pausa',
  break_end: 'Reanudación',
  clock_out: 'Salida',
}

export const STATUS_LABEL: Record<WorkStatus, string> = {
  working: 'En jornada',
  break: 'En pausa',
  off: 'Fuera de jornada',
}

export const ROLE_LABEL: Record<UserRole, string> = {
  employee: 'Persona trabajadora',
  manager: 'Responsable de equipo',
  admin: 'Administración / RRHH',
  inspector: 'Inspección de Trabajo / RLT',
}
