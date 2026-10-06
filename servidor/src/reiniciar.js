#!/usr/bin/env node
/**
 * REINICIO A CERO — borra todo y deja la base de datos recién instalada
 *
 *   node src/reiniciar.js --confirmo               # durante las pruebas
 *   node src/reiniciar.js --confirmo --produccion  # el día del arranque real
 *
 * POR QUÉ ESTO EXISTE, Y POR QUÉ NO EXISTE UN «BORRAR FICHAJE»
 *
 * Cada asiento guarda el hash del anterior. Borrar unos cuantos fichajes de
 * prueba y seguir usando la misma base de datos dejaría al primer asiento
 * superviviente apuntando a un hash que ya no existe: la cadena quedaría rota
 * PARA SIEMPRE, y `verify_ledger()` informaría de manipulación durante los
 * cuatro años siguientes. Ante una inspección, un registro que se autodenuncia
 * como alterado es peor que no tener registro.
 *
 * Por eso la forma correcta de limpiar las pruebas no es borrar filas: es
 * tirar la base de datos entera y volver a crearla. La cadena arranca de nuevo
 * desde su asiento génesis y no queda rastro de los datos de prueba.
 *
 * EL CERROJO DE PRODUCCIÓN
 *
 * Con `--produccion`, además de reiniciar, se escribe una marca permanente.
 * A partir de ese momento este script SE NIEGA A EJECUTARSE. Es deliberado:
 * una herramienta capaz de vaciar el registro de jornada no puede seguir
 * disponible en la máquina donde ese registro ya tiene valor legal, por mucho
 * cuidado que se tenga. El cerrojo no se quita desde aquí.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import pg from 'pg'

const raiz = dirname(fileURLToPath(import.meta.url))
const DIRECTORIO_DATOS = process.env.RUTA_SELLOS ?? '/datos/sellos'
const MARCA_PRODUCCION = join(DIRECTORIO_DATOS, 'EN-PRODUCCION')

const args = process.argv.slice(2)
const confirmado = args.includes('--confirmo')
const marcarProduccion = args.includes('--produccion')

function salirConAyuda(mensaje) {
  console.error(`\n${mensaje}\n`)
  console.error('Uso:')
  console.error('  node src/reiniciar.js --confirmo               Borra todo (fase de pruebas)')
  console.error('  node src/reiniciar.js --confirmo --produccion  Borra todo y CIERRA el cerrojo\n')
  process.exit(1)
}

// --- Cerrojo ---------------------------------------------------------
if (existsSync(MARCA_PRODUCCION)) {
  const marca = readFileSync(MARCA_PRODUCCION, 'utf8').trim()
  console.error(
    '\n  ✖ ESTA INSTALACIÓN YA ESTÁ EN PRODUCCIÓN. No se borra nada.\n\n' +
      `  ${marca.split('\n').join('\n  ')}\n\n` +
      '  El registro de jornada de esta empresa tiene valor legal y debe\n' +
      '  conservarse 4 años. Si de verdad necesita empezar de cero —porque\n' +
      '  se equivocó de empresa al dar de alta, por ejemplo— es una decisión\n' +
      '  consciente que exige borrar a mano el fichero:\n\n' +
      `     ${MARCA_PRODUCCION}\n\n` +
      '  Antes de hacerlo, guarde una copia y documente por qué.\n',
  )
  process.exit(1)
}

if (!confirmado) {
  salirConAyuda('Falta --confirmo. Este script BORRA TODOS LOS DATOS.')
}

// --- Conexión --------------------------------------------------------
const baseDeDatos = process.env.PGDATABASE ?? 'fichaje'
const cliente = new pg.Client({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
  database: baseDeDatos,
})
await cliente.connect()

// --- Qué se va a destruir -------------------------------------------
/** Cuenta sin romperse si la tabla aún no existe (instalación nueva). */
async function contar(tabla) {
  try {
    const { rows } = await cliente.query(`select count(*)::int as n from ${tabla}`)
    return rows[0].n
  } catch {
    return 0
  }
}

const fichajes = await contar('public.time_entries')
const personas = await contar('public.profiles')
const empresas = await contar('public.companies')
const solicitudes = await contar('public.correction_requests')

console.log(`\n▸ Base de datos «${baseDeDatos}»\n`)
console.log(`   ${String(empresas).padStart(6)}  empresa(s)`)
console.log(`   ${String(personas).padStart(6)}  persona(s)`)
console.log(`   ${String(fichajes).padStart(6)}  fichaje(s)`)
console.log(`   ${String(solicitudes).padStart(6)}  solicitud(es) de corrección\n`)

if (fichajes + personas + empresas === 0) {
  console.log('   (ya estaba vacía)\n')
}

// --- Copia de rescate antes de destruir ------------------------------
// No se pide: se hace. Vaciar el registro por error y no tener dónde mirar
// sería un fallo irrecuperable, y el coste de un volcado es nada.
if (fichajes > 0) {
  const destino = join(
    process.env.RUTA_COPIAS ?? '/tmp',
    `antes-de-reiniciar-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sql`,
  )
  try {
    mkdirSync(dirname(destino), { recursive: true })
    const volcado = spawnSync('pg_dump', ['--no-owner', '--no-privileges', '-f', destino], {
      env: { ...process.env, PGDATABASE: baseDeDatos },
    })
    if (volcado.status === 0) {
      console.log(`   Copia de rescate guardada en:\n   ${destino}\n`)
    } else {
      console.log('   (no se ha podido hacer copia de rescate; se continúa)\n')
    }
  } catch {
    console.log('   (no se ha podido hacer copia de rescate; se continúa)\n')
  }
}

// --- Borrado ---------------------------------------------------------
// Se eliminan los esquemas enteros, no las filas. Borrar filas dejaría los
// contadores de secuencia avanzados y la cadena arrancaría en un número que
// no es el uno: una rareza inexplicable el día que alguien la audite.
console.log('   Borrando esquemas…')
await cliente.query('drop schema if exists public cascade')
await cliente.query('drop schema if exists auth cascade')
await cliente.query('create schema public')
await cliente.query('grant all on schema public to public')
await cliente.end()

// --- Reinstalación ---------------------------------------------------
console.log('   Aplicando migraciones…\n')
const migracion = spawnSync('node', [join(raiz, 'migrar.js')], {
  stdio: 'inherit',
  env: process.env,
})
if (migracion.status !== 0) {
  console.error('\n  ✖ Las migraciones han fallado. La base de datos está vacía.\n')
  process.exit(1)
}

// --- Cerrojo de producción -------------------------------------------
if (marcarProduccion) {
  mkdirSync(DIRECTORIO_DATOS, { recursive: true })
  writeFileSync(
    MARCA_PRODUCCION,
    `Puesta en producción: ${new Date().toISOString()}\n` +
      `Base de datos: ${baseDeDatos}\n` +
      'A partir de esta fecha el registro de jornada tiene valor legal.\n',
    { mode: 0o444 },
  )
  console.log(
    '\n═══════════════════════════════════════════════════════════\n' +
      '  INSTALACIÓN EN PRODUCCIÓN\n' +
      '═══════════════════════════════════════════════════════════\n\n' +
      '  Base de datos vacía y cerrojo cerrado. Este script ya no\n' +
      '  volverá a ejecutarse en este equipo.\n\n' +
      '  Siguientes pasos:\n' +
      '    1. node src/alta.js --empresa "…" --cif …\n' +
      '    2. node src/alta.js plantilla.csv\n' +
      '    3. Compruebe que las tareas de copia y sello están en cron\n' +
      '    4. Saque hoy mismo el primer sello fuera de la oficina\n',
  )
} else {
  console.log(
    '\n▸ Base de datos reiniciada. Puede volver a dar de alta y seguir probando.\n\n' +
      '  Cuando vaya a producción, ejecute el reinicio con --produccion:\n' +
      '  dejará la base limpia y cerrará el cerrojo definitivamente.\n',
  )
}
