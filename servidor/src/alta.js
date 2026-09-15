#!/usr/bin/env node
/**
 * ALTA DE LA EMPRESA Y DE LAS PERSONAS
 *
 *   # 1. Dar de alta la empresa (una sola vez)
 *   node src/alta.js --empresa "Mi Empresa SL" --cif B12345678
 *
 *   # 2. Dar de alta a la plantilla
 *   node src/alta.js plantilla.csv --dry-run
 *   node src/alta.js plantilla.csv
 *
 * Formato del CSV (cabecera obligatoria, separador coma):
 *   email,nombre,rol,numero_empleado,nif,horas_semana
 *   ana.perez@miempresa.es,Ana Pérez Ruiz,employee,E-001,12345678Z,40
 *   luis.marin@miempresa.es,Luis Marín Soto,admin,A-001,87654321X,40
 *
 * Roles: employee · manager · admin · inspector
 *
 * Se ejecuta EN EL PC donde vive la base de datos, con el usuario
 * administrador de PostgreSQL. No hay ninguna vía para dar de alta personas
 * desde el navegador, y es deliberado: crear cuentas es justo la operación
 * con la que alguien podría fabricarse un perfil de administración.
 */
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { hashearContrasena } from './sesiones.js'

const ROLES = new Set(['employee', 'manager', 'admin', 'inspector'])
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

function valorDe(bandera) {
  const i = args.indexOf(bandera)
  return i === -1 ? null : args[i + 1]
}

const cliente = new pg.Client({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? 'fichaje',
})
await cliente.connect()

// --- Alta de la empresa ----------------------------------------------
const nombreEmpresa = valorDe('--empresa')
if (nombreEmpresa) {
  const cif = valorDe('--cif')
  if (!cif) {
    console.error('Indique también el CIF:  --empresa "Mi Empresa SL" --cif B12345678')
    process.exit(1)
  }

  const { rows } = await cliente.query(
    `insert into public.companies (name, cif) values ($1, $2) returning id`,
    [nombreEmpresa, cif],
  )

  console.log(`\n▸ Empresa creada.\n`)
  console.log(`  company_id: ${rows[0].id}\n`)
  console.log('  Guárdelo: hace falta para dar de alta a las personas.')
  console.log('  Expórtelo antes del siguiente paso:\n')
  console.log(`     export FICHAJE_COMPANY_ID=${rows[0].id}\n`)
  await cliente.end()
  process.exit(0)
}

// --- Alta de personas -------------------------------------------------
const csvPath = args.find((a) => !a.startsWith('--') && a.endsWith('.csv'))
if (!csvPath) {
  console.error(
    'Uso:\n' +
      '  node src/alta.js --empresa "Mi Empresa SL" --cif B12345678\n' +
      '  node src/alta.js plantilla.csv [--dry-run]\n',
  )
  process.exit(1)
}

let companyId = process.env.FICHAJE_COMPANY_ID ?? valorDe('--company-id')
if (!companyId) {
  const { rows } = await cliente.query('select id, name from public.companies order by created_at')
  if (rows.length === 1) {
    companyId = rows[0].id
    console.log(`▸ Empresa detectada: ${rows[0].name} (${companyId})`)
  } else {
    console.error(
      `Hay ${rows.length} empresas dadas de alta. Indique cuál:\n` +
        '  export FICHAJE_COMPANY_ID=<id>\n\n' +
        rows.map((r) => `  ${r.id}  ${r.name}`).join('\n'),
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
  await cliente.end()
  process.exit(0)
}

if (!personas.some((p) => p.role === 'admin')) {
  console.warn(
    '⚠ Ninguna persona tiene rol «admin». Nadie podrá aprobar rectificaciones,\n' +
      '  porque nadie puede aprobar las suyas propias.\n',
  )
}

/** Contraseña inicial legible pero no adivinable; se cambia al primer acceso. */
function contrasenaInicial() {
  const abc = 'abcdefghijkmnpqrstuvwxyz'
  const num = '23456789'
  const b = randomBytes(24)
  let p = ''
  for (let i = 0; i < 4; i++) p += abc[b[i] % abc.length]
  p += '-'
  for (let i = 4; i < 8; i++) p += abc[b[i] % abc.length]
  p += '-'
  for (let i = 8; i < 11; i++) p += num[b[i] % num.length]
  return p
}

const credenciales = []
let creadas = 0
let fallidas = 0

for (const p of personas) {
  const password = contrasenaInicial()
  try {
    // El perfil NO se crea aquí. Lo crea el disparador
    // `on_auth_user_created` a partir de los metadatos, que es el camino ya
    // cubierto por la batería de cumplimiento. Duplicarlo en JavaScript
    // habría dado dos formas de dar de alta y solo una probada.
    await cliente.query('begin')

    await cliente.query(
      `insert into auth.users (email, password_hash, must_change_password, raw_user_meta_data)
       values ($1, $2, true, $3::jsonb)`,
      [
        p.email,
        await hashearContrasena(password),
        JSON.stringify({
          company_id: companyId,
          role: p.role,
          full_name: p.full_name || p.email.split('@')[0],
          employee_number: p.employee_number || null,
          nif: p.nif || null,
          contract_hours: p.contract_hours,
        }),
      ],
    )

    await cliente.query('commit')
    creadas++
    credenciales.push({ email: p.email, password })
    console.log(`  ✓ ${p.email}`)
  } catch (error) {
    await cliente.query('rollback').catch(() => {})
    fallidas++
    // El código 23505 es «clave duplicada» a secas: puede ser el correo, pero
    // también el número de empleado, que es único por empresa. Decir siempre
    // «ese correo ya existe» manda a buscar el problema donde no está.
    const detalle =
      error.code === '23505'
        ? `ya existe un registro con ese valor (${error.constraint ?? 'clave única'})`
        : error.message
    console.error(`  ✗ ${p.email} — ${String(detalle).slice(0, 120)}`)
  }
}

console.log(`\n▸ ${creadas} creada(s), ${fallidas} con error\n`)

if (credenciales.length > 0) {
  console.log('CONTRASEÑAS INICIALES — repártalas por un canal seguro.')
  console.log('La aplicación obliga a cambiarlas en el primer acceso.\n')
  for (const c of credenciales) console.log(`  ${c.email.padEnd(34)} ${c.password}`)
  console.log('\nEstas contraseñas NO se pueden volver a consultar: guárdelas ahora.\n')
}

await cliente.end()
process.exit(fallidas > 0 ? 1 : 0)
