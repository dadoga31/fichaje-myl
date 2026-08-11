import type { EntryType, TimeEntry, WorkStatus } from './types'

/** Segundos → "7h 32m" (formato de lectura para resúmenes). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** Segundos → "07:32:15" (contador en vivo, ancho fijo). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':')
}

/** Segundos → "7,53" horas decimales, como exige la nómina. */
export function toDecimalHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(iso: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleDateString('es-ES', opts ?? { day: '2-digit', month: 'short', year: 'numeric' })
}

/** "2026-08-11" en hora local, sin desplazamientos por UTC. */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export const WEEKDAYS_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

/** Lunes = 0 … domingo = 6, que es como se lee un calendario en España. */
export function mondayFirstDay(date: Date): number {
  return (date.getDay() + 6) % 7
}

/**
 * Estado actual derivado del último fichaje vigente.
 * Una jornada abierta más de 20 h se considera un olvido de salida y la
 * persona pasa a "fuera de jornada": debe rectificarla, no seguir sumando.
 */
export const STALE_SHIFT_HOURS = 20

export function deriveStatus(lastEntry: TimeEntry | null | undefined): WorkStatus {
  if (!lastEntry) return 'off'
  const ageHours = (Date.now() - new Date(lastEntry.event_at).getTime()) / 3_600_000
  if (ageHours > STALE_SHIFT_HOURS) return 'off'
  switch (lastEntry.entry_type) {
    case 'clock_in':
    case 'break_end':
      return 'working'
    case 'break_start':
      return 'break'
    case 'clock_out':
      return 'off'
  }
}

/** Qué acciones son legales desde el estado actual (espejo del RPC punch). */
export function allowedActions(status: WorkStatus): EntryType[] {
  switch (status) {
    case 'off':
      return ['clock_in']
    case 'working':
      return ['break_start', 'clock_out']
    case 'break':
      return ['break_end', 'clock_out']
  }
}

/**
 * Trabajo efectivo y pausa de una jornada, a partir de sus fichajes vigentes.
 * `now` permite contar en vivo el tramo aún abierto.
 *
 * Es el mismo algoritmo que public.daily_summary() en SQL: el servidor manda,
 * pero el cliente necesita el cómputo para el contador en tiempo real y para
 * seguir funcionando sin conexión.
 */
export function computeDay(
  entries: TimeEntry[],
  now: Date = new Date(),
): { workedSeconds: number; breakSeconds: number; isOpen: boolean } {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime(),
  )

  let worked = 0
  let paused = 0
  let isOpen = false

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]
    const next = sorted[i + 1]
    const start = new Date(current.event_at).getTime()

    if (current.entry_type === 'clock_out') continue

    // Tramo sin cierre: solo cuenta en vivo si la jornada sigue siendo
    // razonablemente reciente; si no, es un fichaje de salida olvidado.
    let end: number
    if (next) {
      end = new Date(next.event_at).getTime()
    } else {
      const ageHours = (now.getTime() - start) / 3_600_000
      if (ageHours > STALE_SHIFT_HOURS) continue
      isOpen = true
      end = now.getTime()
    }

    const seconds = Math.max(0, (end - start) / 1000)
    if (current.entry_type === 'break_start') paused += seconds
    else worked += seconds
  }

  return {
    workedSeconds: Math.floor(worked),
    breakSeconds: Math.floor(paused),
    isOpen,
  }
}

/**
 * Reparto entre horas ordinarias y extraordinarias sobre la jornada de
 * referencia del periodo. El exceso es "hora extraordinaria" a efectos del
 * Art. 35 ET; la calificación definitiva depende del convenio aplicable.
 */
export function splitOrdinaryOvertime(
  workedSeconds: number,
  contractHoursWeek: number,
  workingDays: number,
): { ordinary: number; overtime: number } {
  const referenceSeconds = (contractHoursWeek / 5) * 3600 * workingDays
  const ordinary = Math.min(workedSeconds, referenceSeconds)
  return { ordinary, overtime: Math.max(0, workedSeconds - referenceSeconds) }
}
