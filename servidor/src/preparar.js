#!/usr/bin/env node
/**
 * PREPARACIÓN AUTOMÁTICA DE LA BASE DE DATOS
 *
 * Se ejecuta sola al arrancar, antes que la aplicación, y deja la base lista:
 *
 *   1. Crea el usuario con el que la aplicación atiende a la plantilla, o le
 *      actualiza la contraseña si ya existía.
 *   2. Aplica las migraciones pendientes.
 *   3. Le concede los roles `authenticated` y `service_role`.
 *
 * Antes estos pasos eran tres comandos a mano en un orden concreto, y
 * hacerlos fuera de orden daba errores poco explicables. En un PC de oficina
 * que instala alguien que no es administrador de sistemas, cada paso manual
 * es un sitio donde atascarse.
 *
 * Es idempotente: ejecutarlo cien veces deja lo mismo que ejecutarlo una. Por
 * eso puede ir en cada arranque sin miedo, y así una actualización del
 * esquema se aplica sola al reiniciar.
 *
 * Corre con el superusuario de PostgreSQL —crear roles y extensiones lo
 * exige— y termina. La aplicación, en cambio, nunca tiene esos privilegios.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const raiz = dirname(fileURLToPath(import.meta.url))
const usuarioApp = process.env.APP_USER ?? 'fichaje_app'
const claveApp = process.env.APP_PASSWORD

if (!claveApp) {
  console.error('[preparar] Falta APP_PASSWORD (la PGPASSWORD del fichero .env).')
  process.exit(1)
}
// El nombre va interpolado en SQL (los identificadores no admiten
// parámetros), así que se valida en vez de confiar en él.
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(usuarioApp)) {
  console.error(`[preparar] Nombre de usuario no válido: «${usuarioApp}»`)
  process.exit(1)
}

const conexion = () =>
  new pg.Client({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE ?? 'fichaje',
  })

// PostgreSQL puede tardar en aceptar conexiones tras un corte de luz.
let cliente
for (let intento = 1; ; intento++) {
  cliente = conexion()
  try {
    await cliente.connect()
    break
  } catch (error) {
    await cliente.end().catch(() => {})
    if (intento >= 30) {
      console.error('[preparar] PostgreSQL no responde:', error.message)
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

// 1. Usuario de la aplicación
const { rows } = await cliente.query('select 1 from pg_roles where rolname = $1', [usuarioApp])
// La contraseña viaja como literal escapado por el propio controlador: es la
// única forma, porque CREATE/ALTER ROLE no acepta parámetros.
const literal = cliente.escapeLiteral(claveApp)
if (rows.length === 0) {
  await cliente.query(`create role ${usuarioApp} login password ${literal}`)
  console.log(`[preparar] usuario «${usuarioApp}» creado`)
} else {
  await cliente.query(`alter role ${usuarioApp} with login password ${literal}`)
}
await cliente.end()

// 2. Migraciones
const migracion = spawnSync('node', [join(raiz, 'migrar.js')], { stdio: 'inherit', env: process.env })
if (migracion.status !== 0) {
  console.error('[preparar] Las migraciones han fallado; la aplicación no arrancará.')
  process.exit(1)
}

// 3. Roles. Después de migrar, porque son las migraciones quienes los crean.
cliente = conexion()
await cliente.connect()
await cliente.query(`grant authenticated, service_role to ${usuarioApp}`)
await cliente.end()

console.log('[preparar] base de datos lista')
