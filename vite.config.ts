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
        // Nunca cachear las llamadas de escritura del ledger: los fichajes offline
        // se encolan en IndexedDB y se sincronizan de forma explícita y auditada.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkOnly',
            method: 'POST',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-lectura',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
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
  server: { port: 5173, host: true },
  }
})
