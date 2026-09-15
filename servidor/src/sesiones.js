import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { comoServicio } from './bd.js'

/**
 * CREDENCIALES Y SESIONES
 *
 * Se usa `scrypt` de la biblioteca estándar de Node y no Argon2 ni bcrypt:
 * ambos exigen compilar código nativo, y esto tiene que instalarse en el PC
 * de una oficina sin cadena de compilación y sobrevivir a actualizaciones de
 * Node sin dejar de arrancar. scrypt es una función de derivación con coste
 * de memoria, resistente a ASIC, y viene en el propio Node.
 */

const scryptAsync = promisify(scrypt)

// Parámetros de coste. N=2^15 con r=8 exige unos 32 MB por verificación:
// suficiente para encarecer un ataque por diccionario y asumible para un PC
// de oficina que atiende a una plantilla, no a medio país.
const COSTE = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }
const LONGITUD_CLAVE = 64

const DURACION_SESION_DIAS = 30
const MAX_INTENTOS = 8
const BLOQUEO_MINUTOS = 15

/** Deriva el hash de una contraseña con una sal nueva. */
export async function hashearContrasena(contrasena) {
  const sal = randomBytes(16)
  const clave = await scryptAsync(contrasena.normalize('NFKC'), sal, LONGITUD_CLAVE, COSTE)
  return `scrypt$${COSTE.N}$${COSTE.r}$${COSTE.p}$${sal.toString('base64')}$${clave.toString('base64')}`
}

/**
 * Comprueba una contraseña contra su hash almacenado.
 *
 * La comparación es en tiempo constante: comparar con `===` filtra, por la
 * diferencia de tiempo, cuántos bytes iniciales eran correctos.
 */
export async function verificarContrasena(contrasena, almacenado) {
  if (!almacenado) return false
  const partes = almacenado.split('$')
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false

  const [, N, r, p, salB64, claveB64] = partes
  const sal = Buffer.from(salB64, 'base64')
  const esperada = Buffer.from(claveB64, 'base64')

  const calculada = await scryptAsync(contrasena.normalize('NFKC'), sal, esperada.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: COSTE.maxmem,
  })

  return calculada.length === esperada.length && timingSafeEqual(calculada, esperada)
}

/**
 * El testigo de sesión se guarda HASHEADO.
 *
 * Quien logre leer `auth.sessions` —una copia de seguridad extraviada, por
 * ejemplo— no obtiene con ello ninguna sesión utilizable. Basta SHA-256 sin
 * sal: el testigo ya son 32 bytes aleatorios, no una contraseña adivinable.
 */
function hashDeTestigo(testigo) {
  return createHash('sha256').update(testigo).digest('hex')
}

/**
 * Valida credenciales y abre sesión.
 *
 * Devuelve siempre el mismo error genérico cuando falla, sea porque el
 * correo no existe o porque la contraseña no coincide: distinguirlos
 * permitiría averiguar qué correos están dados de alta.
 */
export async function iniciarSesion({ email, contrasena, userAgent, ip }) {
  return comoServicio(async (c) => {
    const { rows } = await c.query(
      `select id, password_hash, must_change_password, failed_attempts, locked_until
         from auth.users where email = $1`,
      [String(email).trim()],
    )
    const usuario = rows[0]

    // Se verifica el hash incluso si el usuario no existe, contra un valor
    // de descarte: así el tiempo de respuesta no delata qué correos existen.
    if (!usuario) {
      await verificarContrasena(contrasena, await hashearContrasena('descarte'))
      throw new ErrorAcceso('Correo o contraseña incorrectos.')
    }

    if (usuario.locked_until && new Date(usuario.locked_until) > new Date()) {
      throw new ErrorAcceso(
        'Cuenta bloqueada temporalmente por intentos fallidos. Espere unos minutos.',
      )
    }

    const valida = await verificarContrasena(contrasena, usuario.password_hash)

    if (!valida) {
      const intentos = usuario.failed_attempts + 1
      await c.query(
        `update auth.users
            set failed_attempts = $2::smallint,
                locked_until = case
                  when $2::smallint >= $3::smallint
                  then now() + ($4::text || ' minutes')::interval
                  else null
                end
          where id = $1`,
        [usuario.id, intentos, MAX_INTENTOS, String(BLOQUEO_MINUTOS)],
      )
      throw new ErrorAcceso('Correo o contraseña incorrectos.')
    }

    // El perfil tiene que existir y estar de alta: una cuenta sin perfil no
    // puede hacer nada útil, y una persona dada de baja no debe entrar.
    const { rows: perfiles } = await c.query(
      `select id, active from public.profiles where id = $1`,
      [usuario.id],
    )
    if (!perfiles[0]) {
      throw new ErrorAcceso(
        'Su cuenta existe pero no tiene perfil asignado. Avise a administración.',
      )
    }
    if (!perfiles[0].active) {
      throw new ErrorAcceso('Su cuenta está dada de baja.')
    }

    await c.query(
      `update auth.users set failed_attempts = 0, locked_until = null, last_login_at = now()
        where id = $1`,
      [usuario.id],
    )

    const testigo = randomBytes(32).toString('base64url')
    await c.query(
      `insert into auth.sessions (token_hash, user_id, expires_at, user_agent, ip)
       values ($1, $2, now() + ($3 || ' days')::interval, $4, $5)`,
      [hashDeTestigo(testigo), usuario.id, String(DURACION_SESION_DIAS), userAgent ?? null, ip ?? null],
    )

    return {
      testigo,
      userId: usuario.id,
      debeCambiarContrasena: usuario.must_change_password,
    }
  })
}

/** Devuelve el id de la persona dueña de la sesión, o null. */
export async function usuarioDeSesion(testigo) {
  if (!testigo) return null
  return comoServicio(async (c) => {
    const { rows } = await c.query(
      `update auth.sessions
          set last_seen_at = now()
        where token_hash = $1 and expires_at > now()
        returning user_id`,
      [hashDeTestigo(testigo)],
    )
    return rows[0]?.user_id ?? null
  })
}

export async function cerrarSesion(testigo) {
  if (!testigo) return
  await comoServicio((c) =>
    c.query('delete from auth.sessions where token_hash = $1', [hashDeTestigo(testigo)]),
  )
}

/**
 * Cambia la contraseña y CIERRA TODAS LAS DEMÁS SESIONES.
 *
 * Cambiar la contraseña porque se sospecha que alguien la conoce no sirve de
 * nada si la sesión que esa persona ya tenía abierta sigue viva.
 */
export async function cambiarContrasena({ userId, actual, nueva, testigoActual }) {
  if (String(nueva).length < 10) {
    throw new ErrorAcceso('La contraseña nueva debe tener al menos 10 caracteres.')
  }

  return comoServicio(async (c) => {
    const { rows } = await c.query('select password_hash from auth.users where id = $1', [userId])
    if (!rows[0]) throw new ErrorAcceso('Cuenta no encontrada.')

    // Si la cuenta aún no tiene contraseña —alta recién creada— no se exige
    // la anterior, porque no existe.
    if (rows[0].password_hash && !(await verificarContrasena(actual ?? '', rows[0].password_hash))) {
      throw new ErrorAcceso('La contraseña actual no es correcta.')
    }

    await c.query(
      'update auth.users set password_hash = $2, must_change_password = false where id = $1',
      [userId, await hashearContrasena(nueva)],
    )
    await c.query('delete from auth.sessions where user_id = $1 and token_hash <> $2', [
      userId,
      hashDeTestigo(testigoActual ?? ''),
    ])
  })
}

/** Limpieza de sesiones caducadas. Se llama al arrancar y una vez al día. */
export async function purgarSesiones() {
  const { rowCount } = await comoServicio((c) =>
    c.query('delete from auth.sessions where expires_at < now()'),
  )
  return rowCount ?? 0
}

export class ErrorAcceso extends Error {
  constructor(mensaje, estado = 401) {
    super(mensaje)
    this.name = 'ErrorAcceso'
    // Fastify lee `statusCode`. Con un nombre propio, el marco lo ignoraba y
    // un fallo de credenciales salía como error interno 500: además de ser
    // falso, impedía al navegador distinguir «te has equivocado» de «el
    // servidor está roto».
    this.statusCode = estado
  }
}
