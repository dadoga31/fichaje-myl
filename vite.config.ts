import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  // `--mode demo` compila un único HTML autocontenido para poder abrir la
  // demostración sin servidor: sin service worker y con enrutado por hash.
  const isSingleFile = mode === 'demo'

  return {
  plugins: [
    react(),
    tailwindcss(),
    ...(isSingleFile ? [] : [VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Fichaje MyL — Registro de jornada',
        short_name: 'Fichaje MyL',
        description:
          'Registro horario de jornada laboral conforme al Art. 34.9 del Estatuto de los Trabajadores y el RDL 8/2019.',
        lang: 'es-ES',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'portrait-primary',
        background_color: '#FFFFFF',
        theme_color: '#6B21A8',
        categories: ['business', 'productivity', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Fichar entrada/salida', short_name: 'Fichar', url: '/?action=punch' },
          { name: 'Mi historial', short_name: 'Historial', url: '/historial' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // Firestore no viaja por HTTP cacheable: habla por WebChannel con
        // googleapis.com y gestiona su propia persistencia en IndexedDB. No
        // hay nada de la API que el service worker deba cachear, y las reglas
        // que había aquí apuntaban a rutas /rest/v1/ de Supabase que ya no
        // existen. El caché de datos lo pone `persistentLocalCache` en
        // src/lib/firebase.ts.
      },
      devOptions: { enabled: false },
    })]),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Sin plugin PWA, el módulo virtual no existe: se sustituye por un stub.
      ...(isSingleFile
        ? {
            'virtual:pwa-register/react': fileURLToPath(
              new URL('./src/stubs/pwa-register.ts', import.meta.url),
            ),
          }
        : {}),
    },
  },
  build: isSingleFile
    ? {
        outDir: 'dist-demo',
        // Todo en un solo bundle: los generadores de PDF/Excel también, para
        // que no queden ficheros sueltos que el HTML no podría cargar.
        rollupOptions: { output: { inlineDynamicImports: true } },
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        cssCodeSplit: false,
      }
    : {},
  // Sello de compilación. Sin esto es imposible distinguir desde el
  // dispositivo si falta reconstruir en Vercel o si el service worker está
  // sirviendo una versión antigua desde la caché.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: { port: 5173, host: true },
  }
})
