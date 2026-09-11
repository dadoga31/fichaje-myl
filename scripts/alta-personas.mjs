#!/usr/bin/env node
/**
 * ALTA DE PERSONAS REALES EN SUPABASE AUTH
 *
 * Crea las cuentas de la plantilla a partir de un CSV. El perfil (empresa,
 * rol, nº de empleado, jornada) lo crea solo el trigger handle_new_auth_user
 * con los metadatos que se envían aquí.
 *
 *   node scripts/alta-personas.mjs plantilla.csv
 *   node scripts/alta-personas.mjs plantilla.csv --dry-run
 *
 * Formato del CSV (primera línea de cabecera, separador coma):
 *   email,nombre,rol,numero_empleado,nif,horas_semana
 *   ana.perez@miempresa.es,Ana Pérez Ruiz,employee,E-001,12345678Z,40
 *   luis.marin@miempresa.es,Luis Marín Soto,admin,A-001,87654321X,40
 *
 * Roles válidos: employee · manager · admin · inspector
 *
 * Requiere dos variables de entorno:
 *   SUPABASE_URL           https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY   clave `service_role` (Settings → API)
 *
 * ⚠ La clave service_role SALTA la seguridad a nivel de fila. Se usa solo
 *   desde su equipo o servidor, NUNCA se publica en el frontend ni se sube
 *   al repositorio.
 */
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_KEY
const [, , csvPath, ...flags] = process.argv
const dryRun = flags.includes('--dry-run')

if (!url || !serviceKey) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en el entorno.')
  process.exit(1)
}
if (!csvPath) {
  console.error('Uso: node scripts/alta-personas.mjs <fichero.csv> [--dry-run]')
  process.exit(1)
}

const ROLES = new Set(['employee', 'manager', 'admin', 'inspector'])

/** Contraseña inicial legible pero no adivinable; se cambia al primer acceso. */
function contrasenaInicial() {
  return randomBytes(9).toString('base64url').replace(/[-_]/g, 'x')
}

/** Divide una línea CSV respetando las comillas dobles. */
function parseLinea(linea) {
  const campos = []
  let actual = ''
  let entreComillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"'
        i++
      } else entreComillas = !entreComillas
    } else if (c === ',' && !entreComillas) {
      campos.push(actual.trim())
      actual = ''
    } else actual += c
  }
  campos.push(actual.trim())
  return campos
}

const lineas = readFileSync(csvPath, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))

if (lineas.length < 2) {
  console.error('El CSV no tiene filas de datos.')
  process.exit(1)
}

const cabecera = parseLinea(lineas[0]).map((h) => h.toLowerCase())
const idx = (nombre) => cabecera.indexOf(nombre)

const iEmail = idx('email')
if (iEmail === -1) {
  console.error('El CSV debe tener una columna "email".')
  process.exit(1)
}

const personas = lineas.slice(1).map((linea, n) => {
  const c = parseLinea(linea)
  const get = (nombre) => (idx(nombre) === -1 ? '' : (c[idx(nombre)] ?? ''))
  return {
    fila: n + 2,
    email: c[iEmail],
    full_name: get('nombre'),
    role: get('rol') || 'employee',
    employee_number: get('numero_empleado'),
    nif: get('nif'),
    contract_hours: get('horas_semana') || '40',
  }
})

// --- Validación previa: mejor parar antes que dejar altas a medias ----
const errores = []
const vistos = new Set()
for (const p of personas) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) {
    errores.push(`fila ${p.fila}: correo no válido «${p.email}»`)
  }
  if (vistos.has(p.email.toLowerCase())) {
    errores.push(`fila ${p.fila}: correo repetido «${p.email}»`)
  }
  vistos.add(p.email.toLowerCase())
  if (!ROLES.has(p.role)) {
    errores.push(`fila ${p.fila}: rol «${p.role}» no válido (${[...ROLES].join(', ')})`)
  }
  if (Number.isNaN(Number(p.contract_hours))) {
    errores.push(`fila ${p.fila}: horas_semana «${p.contract_hours}» no es un número`)
  }
}

if (errores.length > 0) {
  console.error('El CSV tiene errores; no se ha dado de alta a nadie:\n')
  for (const e of errores) console.error('  ·', e)
  process.exit(1)
}

console.log(`\n▸ ${personas.length} persona(s) en ${csvPath}\n`)

if (dryRun) {
  for (const p of personas) {
    console.log(`  ${p.email.padEnd(34)} ${p.role.padEnd(10)} ${p.full_name}`)
  }
  console.log('\n--dry-run: no se ha creado nada.\n')
  process.exit(0)
}

const credenciales = []
let creados = 0
let fallidos = 0

for (const p of personas) {
  const password = contrasenaInicial()

  const respuesta = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: p.email,
      password,
      email_confirm: true, // sin verificación por correo: las da de alta la empresa
      user_metadata: {
        full_name: p.full_name,
        role: p.role,
        employee_number: p.employee_number || null,
        nif: p.nif || null,
        contract_hours: p.contract_hours,
      },
    }),
  })

  if (respuesta.ok) {
    creados++
    credenciales.push({ email: p.email, password, rol: p.role })
    console.log(`  ✓ ${p.email}`)
  } else {
    fallidos++
    const detalle = await respuesta.text()
    console.error(`  ✗ ${p.email} — ${respuesta.status} ${detalle.slice(0, 160)}`)
  }
}

console.log(`\n▸ ${creados} creada(s), ${fallidos} con error\n`)

if (credenciales.length > 0) {
  console.log('CONTRASEÑAS INICIALES — entrégueselas por un canal seguro')
  console.log('y pida que las cambien en el primer acceso:\n')
  for (const c of credenciales) {
    console.log(`  ${c.email.padEnd(34)} ${c.password}`)
  }
  console.log('\nEstas contraseñas NO se pueden volver a consultar: guárdelas ahora.\n')
}

process.exit(fallidos > 0 ? 1 : 0)
