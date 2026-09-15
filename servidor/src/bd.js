import pg from 'pg'

/**
 * ACCESO A POSTGRESQL
 *
 * Aquí está la decisión que sostiene todo lo demás: el servidor NO atiende
 * las peticiones de la plantilla con un superusuario. Abre cada petición en
 * una transacción, adopta el rol `authenticated` y declara de quién es la
 * petición. A partir de ese momento la RLS de la base de datos manda, y el
 * servidor pasa a estar tan limitado como el navegador que le habla.
 *
 * Eso importa especialmente en una instalación autoalojada: un fallo en el
 * código del servidor —una comprobación de permisos que se olvida, un
 * identificador que llega del cliente sin validar— no basta para leer los
 * fichajes de otra empresa ni para tocar un asiento, porque quien lo impide
 * es el motor de base de datos y no el código que acaba de fallar.
 */

const { Pool } = pg

export const pool = new Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'fichaje',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? 'fichaje',
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  // Una consulta que tarda más de 15 s en una aplicación de fichaje está
  // colgada, no ocupada: mejor cortarla que agotar el pool del PC de la
  // oficina, que no es un servidor de centro de datos.
  statement_timeout: 15_000,
})

pool.on('error', (error) => {
  console.error('[bd] error en una conexión inactiva:', error.message)
})

/**
 * Ejecuta `fn` como la persona indicada, dentro de una transacción.
 *
 * `set local` y no `set`: el valor se deshace al terminar la transacción,
 * de modo que la conexión vuelve al pool sin identidad. Con `set` a secas,
 * la siguiente petición que reutilizara esa conexión heredaría el usuario
 * anterior — un fallo de aislamiento silencioso y difícil de ver.
 */
export async function comoUsuario(userId, fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set local role authenticated')
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
    const resultado = await fn(client)
    await client.query('commit')
    return resultado
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Ejecuta `fn` con privilegios de administración, sin RLS.
 *
 * Reservado a lo que no puede hacerse de otro modo: comprobar credenciales
 * —el rol de la plantilla no puede leer los hashes—, crear sesiones y dar
 * de alta personas. Cada uso está acotado a esas tres cosas; si aparece un
 * cuarto, conviene preguntarse por qué.
 */
export async function comoServicio(fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set local role service_role')
    const resultado = await fn(client)
    await client.query('commit')
    return resultado
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** Espera a que PostgreSQL acepte conexiones. El PC de la oficina arranca los
 *  dos servicios a la vez y la base de datos tarda más en estar lista. */
export async function esperarBaseDeDatos(intentos = 30) {
  for (let i = 1; i <= intentos; i++) {
    try {
      await pool.query('select 1')
      return
    } catch (error) {
      if (i === intentos) throw error
      console.log(`[bd] esperando a PostgreSQL (${i}/${intentos})…`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}
