import { createContext, use, useMemo, useState, type ReactNode } from 'react'
import type { WorkStatus } from '../lib/types'

/**
 * AMBIENTE
 *
 * La luz del fondo cambia con el estado de la jornada: verde cuando se
 * trabaja, ámbar en pausa, morada en reposo. Quien conoce ese estado es la
 * pantalla de fichaje, pero quien pinta el fondo es el armazón, así que hace
 * falta este puente.
 */
interface AmbientValue {
  status: WorkStatus
  setStatus: (status: WorkStatus) => void
}

const AmbientContext = createContext<AmbientValue | null>(null)

export function AmbientProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WorkStatus>('off')
  const value = useMemo(() => ({ status, setStatus }), [status])
  return <AmbientContext value={value}>{children}</AmbientContext>
}

export function useAmbient(): AmbientValue {
  const ctx = use(AmbientContext)
  if (!ctx) throw new Error('useAmbient debe usarse dentro de <AmbientProvider>.')
  return ctx
}
