/**
 * Sustituto de `virtual:pwa-register/react` para el build de demostración
 * autocontenido (un único HTML, sin service worker que registrar).
 *
 * El build normal de la PWA no usa este módulo: lo sustituye vite.config.ts
 * únicamente cuando se compila con `--mode demo`.
 */
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (value: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (value: boolean) => void],
    updateServiceWorker: async () => {},
  }
}
