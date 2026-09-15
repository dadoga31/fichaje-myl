#!/usr/bin/env node
/**
 * COPIAS DE SEGURIDAD Y SELLO DIARIO
 *
 *   node src/respaldo.js --copia   # volcado completo, cifrado, al disco local
 *   node src/respaldo.js --sello   # resumen diario firmado, para sacar fuera
 *   node src/respaldo.js --verificar <fichero.sellos>
 *
 * Dos piezas con propósitos distintos, y conviene no confundirlas:
 *
 * LA COPIA sirve para RESTAURAR. Es un volcado completo y cifrado que vive
 * en el disco del propio PC. Protege contra el borrado accidental y el fallo
 * del disco, pero no contra un incendio ni contra un cifrado malicioso que
 * alcance la carpeta.
 *
 * EL SELLO sirve para PROBAR. Es un resumen diminuto —cuántos asientos hay
 * por empresa y cuál es la cabeza de la cadena de hashes— firmado y con
 * fecha, pensado para salir de la oficina todos los días. No permite
 * restaurar nada; permite demostrar, meses después, qué decía el libro en
 * una fecha concreta. Si alguien altera la base de datos y rehace la cadena,
 * la cabeza dejará de coincidir con la que quedó sellada fuera ese día.
 *
 * Esa distinción es justo la que hace defendible una instalación en la
 * oficina del cliente: en el PC, quien tenga administrador puede tocar
 * PostgreSQL; lo que no puede es cambiar lo que ya salió firmado y fechado.
 */
import { spawn } from 'node:child_process'
import { createCipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as firmar, verify as verificarFirma } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const DESTINO_COPIAS = process.env.RUTA_COPIAS ?? '/datos/copias'
const DESTINO_SELLOS = process.env.RUTA_SELLOS ?? '/datos/sellos'
const CLAVE_FIRMA = process.env.RUTA_CLAVE_FIRMA ?? join(DESTINO_SELLOS, 'clave-firma.pem')
const DIAS_RETENCION_COPIAS = Number(process.env.DIAS_RETENCION_COPIAS ?? 30)

const args = process.argv.slice(2)

function asegurarDirectorio(ruta) {
  if (!existsSync(ruta)) mkdirSync(ruta, { recursive: true, mode: 0o700 })
}

// ---------------------------------------------------------------------
// Clave de firma
// ---------------------------------------------------------------------
/**
 * Ed25519 y no RSA: claves de 32 bytes, firmas de 64, sin parámetros que
 * elegir mal. Se genera en el primer uso y se queda en el PC.
 *
 * La clave PÚBLICA hay que sacarla de la oficina y guardarla aparte: es lo
 * que permite a un tercero —una asesoría, un perito— comprobar los sellos
 * sin depender de la máquina que los produjo.
 */
function obtenerClaveFirma() {
  asegurarDirectorio(DESTINO_SELLOS)

  if (!existsSync(CLAVE_FIRMA)) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    writeFileSync(CLAVE_FIRMA, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    const rutaPublica = join(DESTINO_SELLOS, 'clave-publica.pem')
    writeFileSync(rutaPublica, publicKey.export({ type: 'spki', format: 'pem' }))
    console.log(`▸ Clave de firma creada.`)
    console.log(`  Privada: ${CLAVE_FIRMA}  (NO la mueva de este equipo)`)
    console.log(`  Pública: ${rutaPublica}  (SÁQUELA de la oficina y consérvela aparte)\n`)
  }

  return createPrivateKey(readFileSync(CLAVE_FIRMA, 'utf8'))
}

// ---------------------------------------------------------------------
// Copia completa, cifrada
// ---------------------------------------------------------------------
async function hacerCopia() {
  const clave = process.env.CLAVE_COPIAS
  if (!clave || clave.length < 16) {
    console.error(
      'Falta CLAVE_COPIAS (mínimo 16 caracteres).\n\n' +
        '  Una copia del registro de jornada sin cifrar es una filtración de datos\n' +
        '  personales de toda la plantilla esperando a ocurrir. Defínala en el\n' +
        '  fichero .env y guárdela en un gestor de contraseñas: sin ella la copia\n' +
        '  NO se puede restaurar.\n',
    )
    process.exit(1)
  }

  asegurarDirectorio(DESTINO_COPIAS)
  const marca = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const destino = join(DESTINO_COPIAS, `fichaje-${marca}.dump.enc`)

  // La clave de cifrado se deriva de la frase con scrypt y una sal nueva por
  // copia; la sal y el vector viajan en claro al principio del fichero, que
  // es lo correcto: lo secreto es la frase.
  const sal = randomBytes(16)
  const iv = randomBytes(12)
  const { scryptSync } = await import('node:crypto')
  const claveDerivada = scryptSync(clave, sal, 32)
  const cifrador = createCipheriv('aes-256-gcm', claveDerivada, iv)

  const salida = createWriteStream(destino, { mode: 0o600 })
  salida.write(Buffer.concat([Buffer.from('FMYL1'), sal, iv]))

  const volcado = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges'], {
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? 'localhost',
      PGPORT: process.env.PGPORT ?? '5432',
      PGUSER: process.env.PGUSER ?? 'postgres',
      PGDATABASE: process.env.PGDATABASE ?? 'fichaje',
    },
  })

  let errorVolcado = ''
  volcado.stderr.on('data', (d) => (errorVolcado += d.toString()))
  volcado.stdout.pipe(cifrador).pipe(salida, { end: false })

  const codigo = await new Promise((resolve) => volcado.on('close', resolve))
  if (codigo !== 0) {
    console.error(`pg_dump ha fallado (código ${codigo}):\n${errorVolcado}`)
    process.exit(1)
  }

  await new Promise((resolve) => cifrador.on('end', resolve))
  // La etiqueta de autenticación va al final: sin ella no se puede descifrar,
  // y además delata cualquier alteración del fichero.
  salida.end(cifrador.getAuthTag())
  await new Promise((resolve) => salida.on('close', resolve))

  const tam = statSync(destino).size
  console.log(`▸ Copia creada: ${destino} (${(tam / 1024 / 1024).toFixed(1)} MB)`)

  // Retención: se conservan los últimos N días de copias. El registro legal
  // de 4 años lo garantiza la base de datos, no el histórico de volcados.
  const limite = Date.now() - DIAS_RETENCION_COPIAS * 86_400_000
  let borradas = 0
  for (const f of readdirSync(DESTINO_COPIAS)) {
    if (!f.endsWith('.dump.enc')) continue
    const ruta = join(DESTINO_COPIAS, f)
    if (statSync(ruta).mtimeMs < limite) {
      unlinkSync(ruta)
      borradas++
    }
  }
  if (borradas > 0) console.log(`  ${borradas} copia(s) anterior(es) a ${DIAS_RETENCION_COPIAS} días eliminadas`)
}

// ---------------------------------------------------------------------
// Sello diario firmado
// ---------------------------------------------------------------------
async function hacerSello() {
  const clave = obtenerClaveFirma()
  const cliente = new pg.Client({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE ?? 'fichaje',
  })
  await cliente.connect()

  const { rows: empresas } = await cliente.query('select id, name, cif from public.companies')
  const sellos = []

  for (const empresa of empresas) {
    // La CABEZA de la cadena: el sello del último asiento por número de
    // secuencia. Cambiar cualquier asiento anterior obliga a recalcular
    // todos los posteriores, y por tanto cambia esta cabeza.
    const { rows: cabeza } = await cliente.query(
      `select seq, entry_hash, recorded_at
         from public.time_entries
        where company_id = $1
        order by seq desc limit 1`,
      [empresa.id],
    )

    const { rows: conteo } = await cliente.query(
      `select count(*)::int as asientos,
              min(work_date) as desde,
              max(work_date) as hasta
         from public.time_entries where company_id = $1`,
      [empresa.id],
    )

    // Se comprueba la cadena en el momento de sellar: sellar una cadena ya
    // rota sería certificar la manipulación en vez de delatarla.
    const { rows: anomalias } = await cliente.query(
      'select * from public.verify_ledger($1)',
      [empresa.id],
    )

    sellos.push({
      empresa: { id: empresa.id, nombre: empresa.name, cif: empresa.cif },
      sellado_en: new Date().toISOString(),
      asientos: conteo[0].asientos,
      periodo: { desde: conteo[0].desde, hasta: conteo[0].hasta },
      cabeza_cadena: cabeza[0]?.entry_hash ?? null,
      ultimo_seq: cabeza[0]?.seq ?? 0,
      cadena_integra: anomalias.length === 0,
      anomalias: anomalias.length,
    })

    if (anomalias.length > 0) {
      console.error(
        `\n  ⚠ ATENCIÓN: la cadena de ${empresa.name} presenta ${anomalias.length} anomalía(s).\n` +
          '    Alguien ha modificado la base de datos por fuera de la aplicación.\n' +
          '    El sello lo deja constar; investíguelo antes de que pase otro día.\n',
      )
    }
  }

  await cliente.end()

  asegurarDirectorio(DESTINO_SELLOS)
  const fichero = join(DESTINO_SELLOS, `sellos-${new Date().getFullYear()}.jsonl`)

  for (const sello of sellos) {
    // Se firma la forma canónica del objeto, no una representación cualquiera:
    // dos serializaciones distintas del mismo dato darían firmas distintas.
    const canonico = JSON.stringify(sello, Object.keys(sello).sort())
    const firma = firmar(null, Buffer.from(canonico), clave).toString('base64')
    appendFileSync(fichero, `${JSON.stringify({ sello, firma })}\n`, { mode: 0o600 })
  }

  console.log(`▸ Sello diario añadido a ${fichero}`)
  for (const s of sellos) {
    console.log(
      `  ${s.empresa.nombre}: ${s.asientos} asientos · cadena ${s.cadena_integra ? 'íntegra' : 'CON ANOMALÍAS'}`,
    )
  }
  console.log(
    '\n  Saque este fichero de la oficina hoy mismo (correo, disco externo, nube).\n' +
      '  Su valor está en existir FUERA del equipo que lo produjo.\n',
  )
}

// ---------------------------------------------------------------------
// Verificación de sellos
// ---------------------------------------------------------------------
function verificarSellos(ruta) {
  const rutaPublica = join(DESTINO_SELLOS, 'clave-publica.pem')
  if (!existsSync(rutaPublica)) {
    console.error(`No se encuentra la clave pública en ${rutaPublica}`)
    process.exit(1)
  }
  const publica = createPublicKey(readFileSync(rutaPublica, 'utf8'))

  let validos = 0
  let invalidos = 0
  for (const linea of readFileSync(ruta, 'utf8').split('\n').filter(Boolean)) {
    const { sello, firma } = JSON.parse(linea)
    const canonico = JSON.stringify(sello, Object.keys(sello).sort())
    const ok = verificarFirma(null, Buffer.from(canonico), publica, Buffer.from(firma, 'base64'))
    if (ok) validos++
    else {
      invalidos++
      console.error(`  ✗ Firma inválida: ${sello.empresa?.nombre} ${sello.sellado_en}`)
    }
  }

  console.log(`\n▸ ${validos} sello(s) con firma válida, ${invalidos} inválido(s).\n`)
  process.exit(invalidos > 0 ? 1 : 0)
}

// ---------------------------------------------------------------------
if (args.includes('--copia')) await hacerCopia()
else if (args.includes('--sello')) await hacerSello()
else if (args.includes('--verificar')) verificarSellos(args[args.indexOf('--verificar') + 1])
else {
  console.log(
    'Uso:\n' +
      '  node src/respaldo.js --copia              Volcado completo cifrado (disco local)\n' +
      '  node src/respaldo.js --sello              Sello diario firmado (sacar fuera)\n' +
      '  node src/respaldo.js --verificar <fich>   Comprueba las firmas de un fichero de sellos\n',
  )
}
