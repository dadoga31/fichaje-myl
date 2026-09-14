#!/usr/bin/env node
/**
 * ALTA DE LA EMPRESA Y DE LAS PERSONAS EN FIREBASE
 *
 * Crea la cuenta de Firebase Auth y su perfil en Firestore de una sola vez.
 * Usa el Admin SDK, que se salta las Security Rules: por eso se ejecuta desde
 * SU equipo y nunca desde el navegador.
 *
 *   # 1. Dar de alta la empresa (una sola vez)
 *   node scripts/alta-personas.mjs --empresa "Mi Empresa SL" --cif B12345678
 *
 *   # 2. Dar de alta a la plantilla
 *   node scripts/alta-personas.mjs plantilla.csv --dry-run
 *   node scripts/alta-personas.mjs plantilla.csv
 *
 * Formato del CSV (cabecera obligatoria, separador coma):
 *   email,nombre,rol,numero_empleado,nif,horas_semana
 *   ana.perez@miempresa.es,Ana Pérez Ruiz,employee,E-001,12345678Z,40
 *   luis.marin@miempresa.es,Luis Marín Soto,admin,A-001,87654321X,40
 *
 * Roles: employee · manager · admin · inspector
 *
 * Requiere la clave de cuenta de servicio (Configuración del proyecto →
 * Cuentas de servicio → Generar nueva clave privada):
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/ruta/clave-privada.json
 *
 * ⚠ Ese JSON es la llave maestra del proyecto. No lo suba al repositorio ni
 *   lo ponga en Vercel: aquí no hace ninguna falta.
 */
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const ROLES = new Set(['employee', 'manager', 'admin', 'inspector'])
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

function valorDe(bandera) {
  const i = args.indexOf(bandera)
  return i === -1 ? null : args[i + 1]
}

// --- Conexión ---------------------------------------------------------
const rutaClave = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!rutaClave) {
  console.error(
    'Falta GOOGLE_APPLICATION_CREDENTIALS.\n\n' +
      '  Consola de Firebase → Configuración del proyecto → Cuentas de servicio\n' +
      '  → Generar nueva clave privada, y después:\n\n' +
      '  export GOOGLE_APPLICATION_CREDENTIALS=/ruta/clave-privada.json\n',
  )
  process.exit(1)
}

let credencial
try {
  credencial = cert(JSON.parse(readFileSync(rutaClave, 'utf8')))
} catch {
  credencial = applicationDefault()
}
initializeApp({ credential: credencial })
const auth = getAuth()
const db = getFirestore()

// --- Alta de la empresa ----------------------------------------------
const nombreEmpresa = valorDe('--empresa')
if (nombreEmpresa) {
  const cif = valorDe('--cif')
  if (!cif) {
    console.error('Indique también el CIF:  --empresa "Mi Empresa SL" --cif B12345678')
    process.exit(1)
  }

  const ref = await db.collection('companies').add({
    name: nombreEmpresa,
    cif,
    timezone: 'Europe/Madrid',
    geolocation_policy: 'disabled',
    geolocation_notice: null,
    // La conservación legal mínima del Art. 34.9 ET. Las reglas impiden bajarla.
    retention_years: 4,
    weekly_hours: 40,
    created_at: FieldValue.serverTimestamp(),
  })

  console.log(`\n▸ Empresa creada.\n`)
  console.log(`  company_id: ${ref.id}\n`)
  console.log('  Guárdelo: hace falta para dar de alta a las personas.')
  console.log('  Expórtelo antes del siguiente paso:\n')
  console.log(`     export FICHAJE_COMPANY_ID=${ref.id}\n`)
  process.exit(0)
}

// --- Alta de personas -------------------------------------------------
const csvPath = args.find((a) => !a.startsWith('--'))
if (!csvPath) {
  console.error(
    'Uso:\n' +
      '  node scripts/alta-personas.mjs --empresa "Mi Empresa SL" --cif B12345678\n' +
      '  node scripts/alta-personas.mjs plantilla.csv [--dry-run]\n',
  )
  process.exit(1)
}

// Con una sola empresa dada de alta se usa esa; con varias hay que elegir.
let companyId = process.env.FICHAJE_COMPANY_ID ?? valorDe('--company-id')
if (!companyId) {
  const empresas = await db.collection('companies').get()
  if (empresas.size === 1) {
    companyId = empresas.docs[0].id
    console.log(`▸ Empresa detectada: ${empresas.docs[0].data().name} (${companyId})`)
  } else {
    console.error(
      `Hay ${empresas.size} empresas dadas de alta. Indique cuál:\n` +
        '  export FICHAJE_COMPANY_ID=<id>\n\n' +
        empresas.docs.map((d) => `  ${d.id}  ${d.data().name}`).join('\n'),
    )
    process.exit(1)
  }
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
const idx = (n) => cabecera.indexOf(n)
if (idx('email') === -1) {
  console.error('El CSV debe tener una columna "email".')
  process.exit(1)
}

const personas = lineas.slice(1).map((linea, n) => {
  const c = parseLinea(linea)
  const get = (nombre) => (idx(nombre) === -1 ? '' : (c[idx(nombre)] ?? ''))
  return {
    fila: n + 2,
    email: c[idx('email')],
    full_name: get('nombre'),
    role: get('rol') || 'employee',
    employee_number: get('numero_empleado'),
    nif: get('nif'),
    contract_hours: get('horas_semana') || '40',
  }
})

// --- Validación previa: mejor parar que dejar altas a medias -----------
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
  console.error('\nEl CSV tiene errores; no se ha dado de alta a nadie:\n')
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

if (!personas.some((p) => p.role === 'admin')) {
  console.warn(
    '⚠ Ninguna persona tiene rol «admin». Nadie podrá aprobar rectificaciones,\n' +
      '  porque nadie puede aprobar las suyas propias.\n',
  )
}

/** Contraseña inicial legible pero no adivinable; se cambia al primer acceso. */
const contrasenaInicial = () => randomBytes(9).toString('base64url').replace(/[-_]/g, 'x')

const credenciales = []
let creadas = 0
let fallidas = 0

for (const p of personas) {
  const password = contrasenaInicial()
  try {
    const user = await auth.createUser({
      email: p.email,
      password,
      displayName: p.full_name || undefined,
      emailVerified: true, // las da de alta la empresa, no hay autoregistro
    })

    // El perfil se crea con el MISMO id que la cuenta: las reglas de seguridad
    // resuelven el rol leyendo profiles/{uid}, así que deben coincidir.
    await db.collection('profiles').doc(user.uid).set({
      company_id: companyId,
      full_name: p.full_name || p.email.split('@')[0],
      email: p.email,
      role: p.role,
      employee_number: p.employee_number || null,
      nif: p.nif || null,
      contract_hours: Number(p.contract_hours),
      geo_consent: false,
      geo_consent_at: null,
      active: true,
      hired_on: new Date().toISOString().slice(0, 10),
      created_at: FieldValue.serverTimestamp(),
    })

    creadas++
    credenciales.push({ email: p.email, password })
    console.log(`  ✓ ${p.email}`)
  } catch (error) {
    fallidas++
    const codigo = error?.errorInfo?.code ?? error?.code ?? ''
    const detalle = codigo === 'auth/email-already-exists'
      ? 'ya existe una cuenta con ese correo'
      : (error?.message ?? String(error)).slice(0, 120)
    console.error(`  ✗ ${p.email} — ${detalle}`)
  }
}

console.log(`\n▸ ${creadas} creada(s), ${fallidas} con error\n`)

if (credenciales.length > 0) {
  console.log('CONTRASEÑAS INICIALES — repártalas por un canal seguro')
  console.log('y pida que las cambien en el primer acceso:\n')
  for (const c of credenciales) console.log(`  ${c.email.padEnd(34)} ${c.password}`)
  console.log('\nEstas contraseñas NO se pueden volver a consultar: guárdelas ahora.\n')
}

process.exit(fallidas > 0 ? 1 : 0)
