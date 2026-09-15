import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import pg from 'pg'

/**
 * APLICACIÓN DE MIGRACIONES
 *
 * Idempotente y verificable: anota cada fichero aplicado junto al hash de su
 * contenido. Si un fichero ya aplicado cambia, se detiene en vez de seguir.
 *
 * Eso no es purismo: el esquema es donde viven las garantías legales de este
 * producto. Un fichero de migración editado después de haberse aplicado
 * significa que lo que hay en la base de datos del cliente no es lo que dice
 * el repositorio, y en ese momento nadie sabe qué protege realmente.
 */

const raiz = dirname(fileURLToPath(import.meta.url))
const DIRECTORIO = join(raiz, '..', 'sql')

// Las pruebas no son una migración: se ejecutan aparte y sobre una base de
// datos desechable, porque siembran datos de ejemplo.
const EXCLUIDOS = new Set(['pruebas_cumplimiento.sql'])

const cliente = new pg.Client({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? 'fichaje',
})

await cliente.connect()

await cliente.query(`
  create table if not exists public.migraciones_aplicadas (
    fichero     text primary key,
    hash        text not null,
    aplicada_en timestamptz not null default now()
  )
`)

const ficheros = (await readdir(DIRECTORIO))
  .filter((f) => f.endsWith('.sql') && !EXCLUIDOS.has(f))
  .sort()

const { rows: previas } = await cliente.query('select fichero, hash from public.migraciones_aplicadas')
const yaAplicadas = new Map(previas.map((r) => [r.fichero, r.hash]))

let aplicadas = 0

for (const fichero of ficheros) {
  const sql = await readFile(join(DIRECTORIO, fichero), 'utf8')
  const hash = createHash('sha256').update(sql).digest('hex')
  const anterior = yaAplicadas.get(fichero)

  if (anterior) {
    if (anterior !== hash) {
      console.error(
        `\n  ✖ ${fichero} ha cambiado DESPUÉS de aplicarse.\n\n` +
          '  La base de datos ya no se corresponde con el repositorio. No se\n' +
          '  aplica nada. Cree una migración nueva en vez de editar una ya\n' +
          '  aplicada, o restaure el fichero a su contenido original.\n',
      )
      await cliente.end()
      process.exit(1)
    }
    console.log(`  ·  ${fichero} (ya aplicada)`)
    continue
  }

  process.stdout.write(`  →  ${fichero} … `)
  try {
    // Cada migración, en su propia transacción: o entra entera o no entra.
    await cliente.query('begin')
    await cliente.query(sql)
    await cliente.query(
      'insert into public.migraciones_aplicadas (fichero, hash) values ($1, $2)',
      [fichero, hash],
    )
    await cliente.query('commit')
    console.log('aplicada')
    aplicadas++
  } catch (error) {
    await cliente.query('rollback').catch(() => {})
    console.log('ERROR')
    console.error(`\n${error.message}\n`)
    await cliente.end()
    process.exit(1)
  }
}

console.log(
  aplicadas === 0
    ? '\n▸ La base de datos ya estaba al día.\n'
    : `\n▸ ${aplicadas} migración(es) aplicada(s).\n`,
)
await cliente.end()
