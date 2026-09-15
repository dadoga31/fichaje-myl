import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import estaticos from '@fastify/static'
import pg from 'pg'

import { esperarBaseDeDatos, pool } from './bd.js'
import { purgarSesiones, usuarioDeSesion, ErrorAcceso } from './sesiones.js'
import { registrarRutas } from './rutas.js'

/**
 * SERVIDOR DE FICHAJE — instalación autoalojada
 *
 * Un solo proceso que sirve la PWA y la API, hablando con un PostgreSQL en
 * la misma máquina. Pensado para vivir en el PC de una oficina: sin
 * dependencias nativas que compilar, sin servicios externos y arrancando
 * solo tras un corte de luz.
 *
 * El acceso desde la calle NO se resuelve aquí. Este proceso escucha en
 * localhost y es el túnel de Cloudflare quien lo publica: así el equipo no
 * tiene ningún puerto abierto hacia internet, que es la diferencia entre
 * exponer una aplicación y exponer un PC de oficina.
 */

const raiz = dirname(fileURLToPath(import.meta.url))
const PUERTO = Number(process.env.PORT ?? 3000)
const EN_PRODUCCION = process.env.NODE_ENV === 'production'

/**
 * Difusor de avisos de PostgreSQL.
 *
 * Una única conexión dedicada escuchando el canal, y desde ella se reparte a
 * todos los navegadores conectados. Una conexión por navegador agotaría el
 * pool con veinte personas fichando.
 */
function crearDifusor() {
  const oyentes = new Set()
  let cliente = null

  async function conectar() {
    cliente = new pg.Client({
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? 'fichaje',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE ?? 'fichaje',
    })

    cliente.on('notification', (mensaje) => {
      let aviso
      try {
        aviso = JSON.parse(mensaje.payload)
      } catch {
        return
      }
      for (const oyente of oyentes) {
        try {
          oyente(aviso)
        } catch {
          /* un navegador que ya se fue no debe tumbar al resto */
        }
      }
    })

    // Si se cae la conexión de escucha, la aplicación seguiría funcionando
    // pero dejaría de actualizarse sola, y nadie se enteraría. Se reconecta.
    cliente.on('error', (error) => {
      console.error('[avisos] conexión perdida:', error.message)
      setTimeout(() => void conectar().catch(() => {}), 3000)
    })

    await cliente.connect()
    await cliente.query('listen fichaje_cambio')
    console.log('[avisos] escuchando cambios')
  }

  return {
    conectar,
    suscribir(fn) {
      oyentes.add(fn)
      return () => oyentes.delete(fn)
    },
    get conectados() {
      return oyentes.size
    },
  }
}

async function arrancar() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // El túnel es quien termina TLS y quien conoce la IP real de quien
    // llama; sin esto, el registro de accesos anotaría siempre la del túnel.
    trustProxy: true,
    bodyLimit: 256 * 1024,
  })

  await app.register(cookie)

  // Identidad de la petición, resuelta una sola vez por petición.
  app.decorateRequest('usuarioId', null)
  app.addHook('onRequest', async (peticion) => {
    const testigo = peticion.cookies?.fichaje_sesion
    if (testigo) peticion.usuarioId = await usuarioDeSesion(testigo)
  })

  // Cabeceras de seguridad. La PWA no carga nada de terceros, así que la
  // política puede ser estricta de verdad.
  app.addHook('onSend', async (_peticion, respuesta) => {
    respuesta.header('X-Content-Type-Options', 'nosniff')
    respuesta.header('X-Frame-Options', 'DENY')
    respuesta.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    respuesta.header('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')
    if (EN_PRODUCCION) {
      respuesta.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
  })

  app.setErrorHandler((error, peticion, respuesta) => {
    if (error instanceof ErrorAcceso || error.name === 'ErrorAcceso') {
      return respuesta.code(error.statusCode ?? 401).send({ error: error.message })
    }

    // Los errores que levantan las funciones y la RLS de PostgreSQL llevan
    // un mensaje escrito para leerse; se devuelven tal cual porque explican
    // exactamente qué garantía ha impedido la operación.
    if (error.code && /^[0-9A-Z]{5}$/.test(error.code)) {
      const esPermiso = error.code === '42501'
      peticion.log.warn({ code: error.code, msg: error.message }, 'rechazo de PostgreSQL')
      return respuesta.code(esPermiso ? 403 : 400).send({
        error: esPermiso
          ? 'No tiene permiso para esta operación. Los fichajes registrados no se pueden modificar: solicite una rectificación.'
          : error.message,
      })
    }

    peticion.log.error(error)
    return respuesta.code(500).send({ error: 'Error interno del servidor.' })
  })


  const difusor = crearDifusor()
  registrarRutas(app, { seguro: EN_PRODUCCION, difusor })

  // La PWA compilada. Va DESPUÉS de la API para que ninguna ruta estática
  // pueda ensombrecer un endpoint.
  const web = process.env.RUTA_WEB ?? join(raiz, '..', 'web')
  await app.register(estaticos, { root: web, prefix: '/', index: ['index.html'] })

  // Enrutado del lado del cliente: cualquier ruta desconocida devuelve la
  // aplicación, salvo /api, que debe responder 404 de verdad.
  app.setNotFoundHandler((peticion, respuesta) => {
    if (peticion.url.startsWith('/api')) {
      return respuesta.code(404).send({ error: 'Ruta no encontrada.' })
    }
    return respuesta.sendFile('index.html')
  })

  await esperarBaseDeDatos()
  await difusor.conectar()

  const purgadas = await purgarSesiones()
  if (purgadas > 0) console.log(`[sesiones] ${purgadas} sesión(es) caducada(s) eliminadas`)
  setInterval(() => void purgarSesiones().catch(() => {}), 24 * 60 * 60 * 1000)

  // Solo en localhost: quien publica el servicio es el túnel.
  await app.listen({ port: PUERTO, host: process.env.HOST ?? '127.0.0.1' })
  console.log(`[servidor] escuchando en el puerto ${PUERTO}`)

  for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, () => {
      void (async () => {
        await app.close()
        await pool.end()
        process.exit(0)
      })()
    })
  }
}

arrancar().catch((error) => {
  console.error('No se ha podido arrancar el servidor:', error)
  process.exit(1)
})
