#!/usr/bin/env node
/**
 * Empaqueta la demostración en un ÚNICO fichero HTML autocontenido.
 *
 *   npm run build:demo
 *
 * Compila con `--mode demo` (sin service worker, enrutado por hash) y luego
 * incrusta el CSS y el JavaScript dentro del HTML, de modo que la demo se
 * pueda abrir con doble clic o publicar como una página suelta, sin servidor
 * ni peticiones a ningún host externo.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist-demo')

console.log('▸ Compilando en modo demo…')
execFileSync('npx', ['vite', 'build', '--mode', 'demo'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_HASH_ROUTER: 'true', VITE_DEMO: 'true' },
})

const assets = join(DIST, 'assets')
const files = readdirSync(assets)
const jsFile = files.find((f) => f.endsWith('.js'))
const cssFile = files.find((f) => f.endsWith('.css'))

if (!jsFile || !cssFile) {
  throw new Error(`No se encontraron los assets esperados en ${assets}: ${files.join(', ')}`)
}

const js = readFileSync(join(assets, jsFile), 'utf8')
const css = readFileSync(join(assets, cssFile), 'utf8')

// El cierre de etiqueta dentro de una cadena de JS rompería el <script>.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>')

// Sin <!doctype>, <html>, <head> ni <body>: el alojamiento envuelve el
// contenido, y así el mismo fichero sirve para publicarlo o abrirlo suelto.
const html = `<title>Fichaje MyL</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#6B21A8" />
<meta name="color-scheme" content="light" />
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${safeJs}
</script>
`

mkdirSync(join(ROOT, 'dist-demo'), { recursive: true })
const out = join(DIST, 'fichaje-demo.html')
writeFileSync(out, html)

console.log(`\n▸ Demostración autocontenida: ${out}`)
console.log(`  ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB en un único fichero`)
