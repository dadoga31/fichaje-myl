/**
 * PRUEBAS DE CUMPLIMIENTO — Security Rules de Firestore
 *
 * Equivalente de la batería SQL anterior. Cada bloque intenta ACTIVAMENTE
 * romper una garantía legal contra el emulador real de Firestore, y falla
 * ruidosamente si lo consigue.
 *
 *   npm run test:rules
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
  query, where, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'

const EMPRESA = 'acme'
const OTRA = 'rival'
const ANA = 'uid-ana'
const LUIS = 'uid-luis-admin'
const MARTA = 'uid-marta-manager'
const INSPECCION = 'uid-inspeccion'
const ESPIA = 'uid-espia-otra-empresa'

let env
let pasadas = 0
const fallos = []

async function comprobar(etiqueta, fn) {
  try {
    await fn()
    pasadas++
    console.log(`  ok  ${etiqueta}`)
  } catch (error) {
    fallos.push(`${etiqueta}\n      ${String(error).split('\n')[0]}`)
    console.log(`  ✗   ${etiqueta}`)
  }
}

const ctx = (uid) => env.authenticatedContext(uid).firestore()

/** Fichaje válido de la persona indicada. */
function fichaje(uid, tipo, extra = {}) {
  return {
    company_id: EMPRESA,
    user_id: uid,
    entry_type: tipo,
    event_at: Timestamp.now(),
    recorded_at: serverTimestamp(),
    work_date: '2026-09-14',
    origin: 'employee_app',
    supersedes_id: null,
    is_annulment: false,
    reason: null,
    latitude: null,
    longitude: null,
    accuracy_m: null,
    geo_consent: false,
    created_by: uid,
    ...extra,
  }
}

// ---------------------------------------------------------------------
async function main() {
  env = await initializeTestEnvironment({
    projectId: 'fichaje-myl-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })

  // --- Datos de partida, escritos saltándose las reglas ----------------
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore()
    await setDoc(doc(db, 'companies', EMPRESA), {
      name: 'ACME Servicios SL', cif: 'B12345678', timezone: 'Europe/Madrid',
      geolocation_policy: 'disabled', geolocation_notice: null,
      retention_years: 4, weekly_hours: 40,
    })
    await setDoc(doc(db, 'companies', OTRA), {
      name: 'Otra Empresa SA', cif: 'B87654321', timezone: 'Europe/Madrid',
      geolocation_policy: 'disabled', geolocation_notice: null,
      retention_years: 4, weekly_hours: 40,
    })
    const perfil = (id, rol, empresa = EMPRESA, activo = true) =>
      setDoc(doc(db, 'profiles', id), {
        company_id: empresa, full_name: id, email: `${id}@test.es`, role: rol,
        employee_number: 'E-1', nif: null, contract_hours: 40,
        geo_consent: false, geo_consent_at: null, active: activo,
      })
    await perfil(ANA, 'employee')
    await perfil(LUIS, 'admin')
    await perfil(MARTA, 'manager')
    await perfil(INSPECCION, 'inspector')
    await perfil(ESPIA, 'admin', OTRA)

    // Un fichaje ya existente sobre el que probar la inalterabilidad.
    await setDoc(doc(db, 'time_entries', 'entrada-ana'), {
      ...fichaje(ANA, 'clock_in'), recorded_at: Timestamp.now(),
    })
    await setDoc(doc(db, 'time_entries', 'entrada-espia'), {
      ...fichaje(ESPIA, 'clock_in'), company_id: OTRA, recorded_at: Timestamp.now(),
    })
  })

  console.log('\n--- 1. Fichaje propio ---')
  await comprobar('Una persona puede fichar su propia entrada', () =>
    assertSucceeds(setDoc(doc(ctx(ANA), 'time_entries', 'nueva-1'), fichaje(ANA, 'clock_in'))))

  await comprobar('No puede fichar EN NOMBRE DE otra persona', () =>
    assertFails(setDoc(doc(ctx(ANA), 'time_entries', 'suplantacion'),
      { ...fichaje(MARTA, 'clock_in'), created_by: ANA })))

  await comprobar('No puede antedatar el sello de grabación', () =>
    assertFails(setDoc(doc(ctx(ANA), 'time_entries', 'antedatado'),
      { ...fichaje(ANA, 'clock_in'), recorded_at: Timestamp.fromMillis(Date.now() - 86400000) })))

  await comprobar('No puede fichar con fecha del futuro', () =>
    assertFails(setDoc(doc(ctx(ANA), 'time_entries', 'futuro'),
      { ...fichaje(ANA, 'clock_in'), event_at: Timestamp.fromMillis(Date.now() + 3600000) })))

  await comprobar('No puede fichar con más de 26 h de retraso', () =>
    assertFails(setDoc(doc(ctx(ANA), 'time_entries', 'viejisimo'),
      { ...fichaje(ANA, 'clock_in'), event_at: Timestamp.fromMillis(Date.now() - 40 * 3600000) })))

  await comprobar('Un tipo de fichaje inventado se rechaza', () =>
    assertFails(setDoc(doc(ctx(ANA), 'time_entries', 'tipo-raro'),
      { ...fichaje(ANA, 'clock_in'), entry_type: 'teletrabajo' })))

  console.log('\n--- 2. Inalterabilidad del registro ---')
  await comprobar('La persona trabajadora NO puede modificar su fichaje', () =>
    assertFails(updateDoc(doc(ctx(ANA), 'time_entries', 'entrada-ana'),
      { event_at: Timestamp.now() })))

  await comprobar('La persona trabajadora NO puede borrar su fichaje', () =>
    assertFails(deleteDoc(doc(ctx(ANA), 'time_entries', 'entrada-ana'))))

  await comprobar('ADMINISTRACIÓN tampoco puede modificar un fichaje', () =>
    assertFails(updateDoc(doc(ctx(LUIS), 'time_entries', 'entrada-ana'),
      { event_at: Timestamp.now() })))

  await comprobar('ADMINISTRACIÓN tampoco puede borrarlo', () =>
    assertFails(deleteDoc(doc(ctx(LUIS), 'time_entries', 'entrada-ana'))))

  await comprobar('Un responsable de equipo tampoco puede modificarlo', () =>
    assertFails(updateDoc(doc(ctx(MARTA), 'time_entries', 'entrada-ana'),
      { reason: 'tapado' })))

  console.log('\n--- 3. Rectificación con motivo documentado ---')
  await comprobar('Administración rectifica creando un asiento NUEVO', () =>
    assertSucceeds(setDoc(doc(ctx(LUIS), 'time_entries', 'correccion-1'), {
      ...fichaje(ANA, 'clock_in'), origin: 'correction', created_by: LUIS,
      supersedes_id: 'entrada-ana',
      reason: 'Verificado contra el control de accesos del edificio.',
    })))

  await comprobar('Una rectificación SIN motivo es rechazada', () =>
    assertFails(setDoc(doc(ctx(LUIS), 'time_entries', 'sin-motivo'), {
      ...fichaje(ANA, 'clock_in'), origin: 'correction', created_by: LUIS,
      supersedes_id: 'entrada-ana', reason: null,
    })))

  await comprobar('Una rectificación con motivo insuficiente es rechazada', () =>
    assertFails(setDoc(doc(ctx(LUIS), 'time_entries', 'motivo-corto'), {
      ...fichaje(ANA, 'clock_in'), origin: 'correction', created_by: LUIS,
      supersedes_id: 'entrada-ana', reason: 'error',
    })))

  await comprobar('Una rectificación no puede cambiar de titular', () =>
    assertFails(setDoc(doc(ctx(LUIS), 'time_entries', 'cambio-titular'), {
      ...fichaje(MARTA, 'clock_in'), origin: 'correction', created_by: LUIS,
      supersedes_id: 'entrada-ana',
      reason: 'Intento de reasignar el fichaje a otra persona.',
    })))

  await comprobar('Una persona trabajadora NO puede rectificar por su cuenta', () =>
    assertFails(setDoc(doc(ctx(ANA), 'time_entries', 'autocorreccion'), {
      ...fichaje(ANA, 'clock_in'), origin: 'correction', created_by: ANA,
      supersedes_id: 'entrada-ana',
      reason: 'Me corrijo yo mismo sin pasar por administración.',
    })))

  console.log('\n--- 4. Aislamiento entre empresas ---')
  await comprobar('Un administrador de otra empresa no lee fichajes ajenos', () =>
    assertFails(getDoc(doc(ctx(ESPIA), 'time_entries', 'entrada-ana'))))

  await comprobar('Tampoco puede escribir en la empresa ajena', () =>
    assertFails(setDoc(doc(ctx(ESPIA), 'time_entries', 'intrusion'),
      { ...fichaje(ESPIA, 'clock_in'), created_by: ESPIA })))

  await comprobar('Tampoco puede leer su ficha de empresa', () =>
    assertFails(getDoc(doc(ctx(ESPIA), 'companies', EMPRESA))))

  await comprobar('Una persona trabajadora no lee el fichaje de otra', () =>
    assertFails(getDoc(doc(ctx(ANA), 'time_entries', 'entrada-espia'))))

  console.log('\n--- 5. Rol de Inspección: solo lectura ---')
  await comprobar('La Inspección SÍ lee los fichajes de la empresa', () =>
    assertSucceeds(getDoc(doc(ctx(INSPECCION), 'time_entries', 'entrada-ana'))))

  await comprobar('La Inspección NO puede fichar', () =>
    assertFails(setDoc(doc(ctx(INSPECCION), 'time_entries', 'inspector-ficha'),
      fichaje(INSPECCION, 'clock_in'))))

  await comprobar('La Inspección NO puede crear solicitudes', () =>
    assertFails(setDoc(doc(ctx(INSPECCION), 'correction_requests', 'req-inspector'), {
      company_id: EMPRESA, user_id: INSPECCION, status: 'pending',
      requested_type: 'clock_in', requested_event_at: Timestamp.now(),
      work_date: '2026-09-14', reason: 'intento de escritura por inspección',
      created_at: serverTimestamp(), target_entry_id: null,
      reviewed_by: null, reviewed_at: null, review_note: null,
    })))

  console.log('\n--- 6. Solicitudes y regla de los cuatro ojos ---')
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore()
    const base = {
      company_id: EMPRESA, status: 'pending', requested_type: 'clock_out',
      requested_event_at: Timestamp.now(), work_date: '2026-09-14',
      reason: 'Olvidé fichar la salida al terminar la jornada.',
      created_at: Timestamp.now(), target_entry_id: null,
      reviewed_by: null, reviewed_at: null, review_note: null,
    }
    await setDoc(doc(db, 'correction_requests', 'req-ana'), { ...base, user_id: ANA })
    await setDoc(doc(db, 'correction_requests', 'req-luis'), { ...base, user_id: LUIS })
  })

  await comprobar('Administración resuelve la solicitud de otra persona', () =>
    assertSucceeds(updateDoc(doc(ctx(LUIS), 'correction_requests', 'req-ana'), {
      status: 'approved', reviewed_by: LUIS, reviewed_at: serverTimestamp(),
      review_note: 'Verificado.',
    })))

  await comprobar('CUATRO OJOS: nadie aprueba su PROPIA solicitud', () =>
    assertFails(updateDoc(doc(ctx(LUIS), 'correction_requests', 'req-luis'), {
      status: 'approved', reviewed_by: LUIS, reviewed_at: serverTimestamp(),
      review_note: 'Me la apruebo yo.',
    })))

  await comprobar('Una persona trabajadora no aprueba solicitudes', () =>
    assertFails(updateDoc(doc(ctx(ANA), 'correction_requests', 'req-luis'), {
      status: 'approved', reviewed_by: ANA, reviewed_at: serverTimestamp(),
    })))

  await comprobar('Al resolver no se puede reescribir lo solicitado', () =>
    assertFails(updateDoc(doc(ctx(MARTA), 'correction_requests', 'req-luis'), {
      status: 'approved', reviewed_by: MARTA, reviewed_at: serverTimestamp(),
      requested_event_at: Timestamp.fromMillis(Date.now() - 7200000),
    })))

  await comprobar('Una solicitud no se puede borrar', () =>
    assertFails(deleteDoc(doc(ctx(LUIS), 'correction_requests', 'req-ana'))))

  console.log('\n--- 7. Escalada de privilegios en el propio perfil ---')
  await comprobar('Nadie puede ascenderse a sí mismo a administración', () =>
    assertFails(updateDoc(doc(ctx(ANA), 'profiles', ANA), { role: 'admin' })))

  await comprobar('Nadie puede cambiarse de empresa', () =>
    assertFails(updateDoc(doc(ctx(ANA), 'profiles', ANA), { company_id: OTRA })))

  await comprobar('Nadie puede subirse su jornada contratada', () =>
    assertFails(updateDoc(doc(ctx(ANA), 'profiles', ANA), { contract_hours: 80 })))

  await comprobar('SÍ puede dar y retirar su consentimiento de ubicación', () =>
    assertSucceeds(updateDoc(doc(ctx(ANA), 'profiles', ANA), {
      geo_consent: true, geo_consent_at: serverTimestamp(),
    })))

  console.log('\n--- 8. Conservación y geolocalización ---')
  await comprobar('No se puede bajar la conservación por debajo de 4 años', () =>
    assertFails(updateDoc(doc(ctx(LUIS), 'companies', EMPRESA), { retention_years: 2 })))

  await comprobar('No se activa la geolocalización sin el aviso informativo', () =>
    assertFails(updateDoc(doc(ctx(LUIS), 'companies', EMPRESA), {
      geolocation_policy: 'required', geolocation_notice: 'corto',
    })))

  await comprobar('Con aviso publicado, SÍ se puede activar', () =>
    assertSucceeds(updateDoc(doc(ctx(LUIS), 'companies', EMPRESA), {
      geolocation_policy: 'optional',
      geolocation_notice: 'Al fichar se registran las coordenadas del momento exacto, '
        + 'con la finalidad de acreditar el lugar de prestación de servicios. '
        + 'Puede retirar su consentimiento en cualquier momento.',
    })))

  console.log('\n--- 9. Registro de accesos ---')
  await comprobar('Queda constancia de quién exporta', () =>
    assertSucceeds(setDoc(doc(ctx(LUIS), 'access_logs', 'log-1'), {
      company_id: EMPRESA, actor_id: LUIS, actor_role: 'admin',
      action: 'export_pdf', subject_user_id: ANA,
      period_start: '2026-09-01', period_end: '2026-09-30',
      created_at: serverTimestamp(), detail: null,
    })))

  await comprobar('El registro de accesos no se puede borrar', () =>
    assertFails(deleteDoc(doc(ctx(LUIS), 'access_logs', 'log-1'))))

  await comprobar('Una persona trabajadora no husmea el registro de accesos', () =>
    assertFails(getDocs(query(collection(ctx(ANA), 'access_logs'),
      where('company_id', '==', EMPRESA)))))

  await env.cleanup()

  console.log('\n' + '='.repeat(62))
  if (fallos.length === 0) {
    console.log(`  TODAS LAS PRUEBAS HAN PASADO — ${pasadas} aserciones`)
    console.log('='.repeat(62) + '\n')
    process.exit(0)
  }
  console.log(`  ${fallos.length} FALLO(S) de ${pasadas + fallos.length}:\n`)
  for (const f of fallos) console.log('  ✗ ' + f)
  console.log('='.repeat(62) + '\n')
  process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
