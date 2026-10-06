#!/usr/bin/env node
/**
 * CONFIGURACIÓN INICIAL — genera el fichero .env con contraseñas aleatorias
 *
 * Se ejecuta UNA vez, desde la carpeta del proyecto, con el mismo comando en
 * Windows, Mac y Linux (no exige tener Node instalado en el PC):
 *
 *   docker run --rm -v "${PWD}:/w" -w /w node:22-alpine node servidor/src/configurar.js
 *
 * NO SOBRESCRIBE UN .env EXISTENTE, y es lo más importante de este fichero.
 * La contraseña del superusuario queda grabada en la base de datos la
 * primera vez que arranca. Regenerar el .env después dejaría a la aplicación
 * sin poder entrar en su propia base de datos, con cuatro años de registro
 * dentro.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const RUTA = '.env'

if (existsSync(RUTA)) {
  console.error(
    '\n  ✖ Ya existe un fichero .env. No se toca.\n\n' +
      '  Sus contraseñas ya están grabadas en la base de datos: cambiarlas aquí\n' +
      '  dejaría a la aplicación sin acceso a su propio registro. Si lo que\n' +
      '  quiere es añadir el token del túnel, edite .env a mano y rellene\n' +
      '  TOKEN_TUNEL.\n',
  )
  process.exit(1)
}

// Base64 "url" sin símbolos que el fichero .env o la shell puedan malinterpretar.
const secreto = (bytes) => randomBytes(bytes).toString('base64url')

const claveCopias = secreto(24)

const contenido = `# =====================================================================
#  FICHAJE MyL — configuración de este equipo
#  Generado el ${new Date().toLocaleString('es-ES')}. NO lo comparta ni lo suba a ningún sitio.
# =====================================================================

# Superusuario de PostgreSQL: solo lo usan las tareas de mantenimiento.
POSTGRES_PASSWORD=${secreto(24)}

# Usuario con el que la aplicación atiende a la plantilla. NO puede
# modificar ni borrar un fichaje.
PGUSER=fichaje_app
PGPASSWORD=${secreto(24)}

PGDATABASE=fichaje
TZ=Europe/Madrid

# Frase con la que se cifran las copias de seguridad.
# GUÁRDELA TAMBIÉN EN UN GESTOR DE CONTRASEÑAS: si este equipo se pierde,
# sin ella las copias no se pueden restaurar.
CLAVE_COPIAS=${claveCopias}
DIAS_RETENCION_COPIAS=30

# Token del túnel definitivo de Cloudflare. Solo hace falta para producción;
# para las pruebas se usa un túnel temporal que no lo necesita.
TOKEN_TUNEL=
`

writeFileSync(RUTA, contenido, { mode: 0o600 })

console.log(`
  ✓ Fichero .env creado con contraseñas aleatorias.

  ┌────────────────────────────────────────────────────────────────┐
  │  APUNTE AHORA ESTA FRASE EN UN GESTOR DE CONTRASEÑAS:          │
  │                                                                │
  │     CLAVE_COPIAS = ${claveCopias.padEnd(44)}│
  │                                                                │
  │  Sin ella, las copias de seguridad no se pueden restaurar.     │
  └────────────────────────────────────────────────────────────────┘

  Siguiente paso:

     docker compose --profile pruebas up -d --build
`)
