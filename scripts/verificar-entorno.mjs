/**
 * Comprobación previa al build.
 *
 * Vite incrusta las variables `VITE_*` en el JavaScript durante la
 * compilación. Si faltan, el build TERMINA BIEN y publica una aplicación que
 * no puede conectarse a nada: el fallo no aparece hasta que alguien abre la
 * página. En una herramienta de fichaje eso significa plantilla delante de un
 * muro y sin poder registrar su jornada.
 *
 * Así que aquí se rompe a propósito. Un artefacto de producción sin backend
 * no es un artefacto válido, y es mejor un despliegue en rojo con el motivo
 * escrito que uno en verde que no funciona.
 *
 * En local solo avisa: compilar sin credenciales es legítimo mientras se
 * trabaja en la interfaz.
 */

const REQUERIDAS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

const entorno = process.env
const esDemo = entorno.VITE_DEMO === 'true'
// Vercel define VERCEL=1; el resto de integraciones continuas, CI=true.
const esDespliegue = Boolean(entorno.VERCEL || entorno.CI)
const forzado = entorno.PERMITIR_BUILD_SIN_BACKEND === 'true'

// Un valor con espacios alrededor es un error de copiado que no se ve a
// simple vista en el formulario de Vercel, y rompe igual que si faltara.
const conEspacios = REQUERIDAS.filter((k) => entorno[k] && entorno[k] !== entorno[k].trim())
const faltan = REQUERIDAS.filter((k) => !entorno[k]?.trim())

if (esDemo) {
  console.log('▸ Build de DEMOSTRACIÓN (VITE_DEMO=true). Sin valor legal.')
  process.exit(0)
}

if (faltan.length === 0 && conEspacios.length === 0) {
  console.log(`▸ Firebase configurado — proyecto «${entorno.VITE_FIREBASE_PROJECT_ID}»`)
  process.exit(0)
}

// Los nombres (no los valores) de las VITE_* que sí ha visto el build. Es lo
// que permite distinguir «no las he guardado» de «las he escrito mal».
const visibles = Object.keys(entorno).filter((k) => k.startsWith('VITE_'))

const lineas = [
  '',
  '  ✖ FALTA LA CONFIGURACIÓN DE FIREBASE',
  '',
]

if (faltan.length) {
  lineas.push('  Sin definir:', ...faltan.map((k) => `      · ${k}`), '')
}

if (conEspacios.length) {
  lineas.push(
    '  Con espacios sobrantes en el valor (se copiaron mal):',
    ...conEspacios.map((k) => `      · ${k}`),
    '',
  )
}

lineas.push(
  visibles.length
    ? `  Variables VITE_* que sí ha visto este build: ${visibles.join(', ')}`
    : '  Este build no ha recibido NINGUNA variable VITE_*.',
  '',
)

if (esDespliegue) {
  lineas.push(
    '  En Vercel: Settings → Environment Variables. Compruebe que:',
    '',
    '    1. Están en ESTE proyecto (no en otro de la misma cuenta).',
    '    2. Están marcadas para el entorno Production.',
    '    3. Su visibilidad es «Config», no «Secret»: el prefijo VITE_ es',
    '       público por definición y Vercel rechaza marcarlo como secreto.',
    '',
    '  Y recuerde que guardarlas no basta: hay que volver a desplegar,',
    '  porque Vite las incrusta durante la compilación.',
    '',
    '  Si necesita publicar igualmente una versión sin backend, repita el',
    '  despliegue con PERMITIR_BUILD_SIN_BACKEND=true.',
    '',
  )
  console.error(lineas.join('\n'))
  process.exit(forzado ? 0 : 1)
}

lineas.push('  Compilación local: continúo, pero la aplicación mostrará el muro.', '')
console.warn(lineas.join('\n'))
