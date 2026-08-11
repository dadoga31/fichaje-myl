/**
 * COLA DE FICHAJES SIN CONEXIÓN
 *
 * Un fichaje nunca se pierde por falta de cobertura. Si la escritura falla, el
 * evento se guarda en IndexedDB con SU HORA REAL y se reenvía al recuperar la
 * red, marcado como 'employee_offline' para que la trazabilidad refleje que se
 * grabó en diferido. El servidor sella `recorded_at` con su propio reloj, de
 * modo que la diferencia entre "cuándo ocurrió" y "cuándo se registró" queda
 * documentada y es auditable.
 */
import { del, get, set } from 'idb-keyval'
import type { EntryType, PunchGeo, QueuedPunch } from './types'
import { punch } from './api'

const QUEUE_KEY = 'fichaje-myl:offline-queue'
const MAX_ATTEMPTS = 10

async function readQueue(): Promise<QueuedPunch[]> {
  return (await get<QueuedPunch[]>(QUEUE_KEY)) ?? []
}

async function writeQueue(queue: QueuedPunch[]): Promise<void> {
  if (queue.length === 0) await del(QUEUE_KEY)
  else await set(QUEUE_KEY, queue)
  notify(queue)
}

type Listener = (queue: QueuedPunch[]) => void
const listeners = new Set<Listener>()

function notify(queue: QueuedPunch[]): void {
  for (const listener of listeners) listener(queue)
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener)
  void readQueue().then(listener)
  return () => listeners.delete(listener)
}

export async function getQueue(): Promise<QueuedPunch[]> {
  return readQueue()
}

/** Encola un fichaje que no ha podido enviarse. */
export async function enqueuePunch(
  entryType: EntryType,
  geo: PunchGeo | null,
  eventAt: Date = new Date(),
): Promise<QueuedPunch> {
  const item: QueuedPunch = {
    localId: crypto.randomUUID(),
    entry_type: entryType,
    event_at: eventAt.toISOString(),
    geo,
    device: navigator.userAgent.slice(0, 120),
    queued_at: new Date().toISOString(),
    attempts: 0,
  }
  const queue = await readQueue()
  queue.push(item)
  await writeQueue(queue)
  return item
}

export interface FlushResult {
  sent: number
  failed: number
  remaining: number
}

/**
 * Reenvía la cola en orden cronológico. Se detiene en el primer fallo para no
 * romper la secuencia (un 'break_end' antes que su 'break_start' sería
 * rechazado por la máquina de estados del servidor).
 */
export async function flushQueue(userId: string): Promise<FlushResult> {
  let queue = await readQueue()
  if (queue.length === 0) return { sent: 0, failed: 0, remaining: 0 }

  queue.sort((a, b) => a.event_at.localeCompare(b.event_at))

  let sent = 0
  let failed = 0

  while (queue.length > 0) {
    const item = queue[0]
    try {
      await punch(userId, item.entry_type, item.geo, {
        offline: true,
        eventAt: item.event_at,
      })
      queue.shift()
      sent++
    } catch (error) {
      item.attempts++
      item.lastError = error instanceof Error ? error.message : String(error)

      // Un fichaje que el servidor rechaza por incoherencia (p. ej. duplicado
      // ya sincronizado desde otro dispositivo) no debe bloquear la cola para
      // siempre: se descarta tras varios intentos y se avisa a la persona.
      if (item.attempts >= MAX_ATTEMPTS) {
        queue.shift()
        failed++
        continue
      }
      break
    }
  }

  await writeQueue(queue)
  return { sent, failed, remaining: queue.length }
}

export async function discardQueued(localId: string): Promise<void> {
  const queue = await readQueue()
  await writeQueue(queue.filter((q) => q.localId !== localId))
}
