import { useEffect, useState } from 'react'

/**
 * Reloj compartido. Un solo intervalo por componente, alineado al segundo
 * exacto para que el contador no "salte" ni se desfase con el reloj del
 * sistema. Se pausa cuando la pestaña está oculta: en móvil el navegador
 * congela los temporizadores igualmente y así no se malgasta batería.
 */
export function useTicker(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timeoutId: number | undefined
    let intervalId: number | undefined

    const start = () => {
      setNow(new Date())
      // Primer disparo en el cambio de segundo, luego cadencia regular.
      const drift = intervalMs - (Date.now() % intervalMs)
      timeoutId = window.setTimeout(() => {
        setNow(new Date())
        intervalId = window.setInterval(() => setNow(new Date()), intervalMs)
      }, drift)
    }

    const stop = () => {
      if (timeoutId) window.clearTimeout(timeoutId)
      if (intervalId) window.clearInterval(intervalId)
      timeoutId = undefined
      intervalId = undefined
    }

    const onVisibility = () => {
      stop()
      if (document.visibilityState === 'visible') start()
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])

  return now
}
