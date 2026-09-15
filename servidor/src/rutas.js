import { comoUsuario } from './bd.js'
import { cambiarContrasena, cerrarSesion, iniciarSesion, ErrorAcceso } from './sesiones.js'

/**
 * RUTAS DE LA API
 *
 * Deliberadamente finas. La lógica de jornada —transiciones válidas, cómputo
 * de horas, rectificaciones, sellado de la cadena— vive en funciones de
 * PostgreSQL, no aquí. Dos razones:
 *
 *   · Las garantías legales tienen que estar donde están los datos. Si el
 *     cómputo viviera en este proceso, bastaría con hablarle a la base de
 *     datos por otro camino para saltárselo.
 *   · Esas funciones ya están cubiertas por 40 aserciones que intentan
 *     activamente romperlas. Reimplementarlas en JavaScript habría
 *     significado tener dos verdades y ninguna probada.
 */

const COOKIE = 'fichaje_sesion'

/** Opciones de la cookie de sesión. */
function opcionesCookie(seguro) {
  return {
    path: '/',
    httpOnly: true, // inaccesible desde JavaScript: acota el daño de un XSS
    sameSite: 'lax', // la PWA y la API comparten origen; basta para CSRF
    secure: seguro, // solo por HTTPS en producción
    maxAge: 60 * 60 * 24 * 30,
  }
}

export function registrarRutas(app, { seguro, difusor }) {
  /** Exige sesión. Devuelve el id de la persona. */
  async function exigirSesion(peticion) {
    if (!peticion.usuarioId) throw new ErrorAcceso('Sesión no iniciada.')
    return peticion.usuarioId
  }

  // -------------------------------------------------------------------
  // Sesión
  // -------------------------------------------------------------------
  app.post('/api/sesion', async (peticion, respuesta) => {
    const { email, contrasena } = peticion.body ?? {}
    if (!email || !contrasena) throw new ErrorAcceso('Indique correo y contraseña.')

    const { testigo, debeCambiarContrasena } = await iniciarSesion({
      email,
      contrasena,
      userAgent: peticion.headers['user-agent'],
      ip: peticion.ip,
    })

    respuesta.setCookie(COOKIE, testigo, opcionesCookie(seguro))
    return { ok: true, debeCambiarContrasena }
  })

  app.delete('/api/sesion', async (peticion, respuesta) => {
    await cerrarSesion(peticion.cookies?.[COOKIE])
    respuesta.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/sesion', async (peticion) => {
    if (!peticion.usuarioId) return null
    return comoUsuario(peticion.usuarioId, async (c) => {
      const { rows: perfiles } = await c.query(
        `select id, company_id, full_name, email, role, employee_number, nif,
                contract_hours, geo_consent, geo_consent_at, active
           from public.profiles where id = auth.uid()`,
      )
      if (!perfiles[0]) throw new ErrorAcceso('Su cuenta no tiene perfil asignado.')

      const { rows: empresas } = await c.query(
        `select id, name, cif, timezone, geolocation_policy, geolocation_notice,
                retention_years, weekly_hours
           from public.companies where id = $1`,
        [perfiles[0].company_id],
      )
      return { profile: perfiles[0], company: empresas[0] ?? null }
    })
  })

  app.post('/api/contrasena', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const { actual, nueva } = peticion.body ?? {}
    await cambiarContrasena({
      userId,
      actual,
      nueva,
      testigoActual: peticion.cookies?.[COOKIE],
    })
    return { ok: true }
  })

  // -------------------------------------------------------------------
  // Fichaje
  // -------------------------------------------------------------------
  app.post('/api/fichajes', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const { tipo, eventAt, geo, offline, dispositivo } = peticion.body ?? {}

    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        `select * from public.punch($1::public.entry_type, coalesce($2::timestamptz, now()),
                                    $3, $4, $5, $6, coalesce($7, false))`,
        [
          tipo,
          eventAt ?? null,
          geo?.latitude ?? null,
          geo?.longitude ?? null,
          geo?.accuracy ?? null,
          dispositivo ?? null,
          offline ?? false,
        ],
      )
      return rows[0]
    })
  })

  /** Asientos VIGENTES: sin los sustituidos por una rectificación. */
  app.get('/api/fichajes', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const { usuario, desde, hasta } = peticion.query
    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        `select * from public.effective_entries
          where user_id = $1 and work_date between $2::date and $3::date
          order by event_at`,
        [usuario ?? userId, desde, hasta],
      )
      return rows
    })
  })

  /** Libro completo, incluidos sustituidos y anulados: vista de Inspección. */
  app.get('/api/fichajes/crudos', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const { usuario, desde, hasta } = peticion.query
    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        `select * from public.time_entries
          where user_id = $1 and work_date between $2::date and $3::date
          order by event_at, seq`,
        [usuario ?? userId, desde, hasta],
      )
      return rows
    })
  })

  app.get('/api/resumenes', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const { usuario, desde, hasta } = peticion.query
    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        'select * from public.daily_summary($1, $2::date, $3::date)',
        [usuario ?? userId, desde, hasta],
      )
      return rows
    })
  })

  // -------------------------------------------------------------------
  // Administración
  // -------------------------------------------------------------------
  app.get('/api/plantilla', async (peticion) => {
    const userId = await exigirSesion(peticion)
    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        'select * from public.staff_live_status order by full_name',
      )
      return rows
    })
  })

  app.get('/api/personas', async (peticion) => {
    const userId = await exigirSesion(peticion)
    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        `select id, company_id, full_name, email, role, employee_number, nif,
                contract_hours, geo_consent, geo_consent_at, active
           from public.profiles order by full_name`,
      )
      return rows
    })
  })

  app.get('/api/solicitudes', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const propias = peticion.query.propias === 'true'
    return comoUsuario(userId, async (c) => {
      // La RLS ya acota lo visible; el filtro `propias` solo evita traer de
      // más cuando la pantalla únicamente muestra las de quien la abre.
      const { rows } = await c.query(
        `select r.*, p.full_name as user_name
           from public.correction_requests r
           join public.profiles p on p.id = r.user_id
          ${propias ? 'where r.user_id = auth.uid()' : ''}
          order by r.created_at desc`,
      )
      return rows
    })
  })

  app.post('/api/solicitudes', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const { targetEntryId, tipo, eventAt, workDate, motivo } = peticion.body ?? {}
    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        `insert into public.correction_requests
           (company_id, user_id, target_entry_id, requested_type, requested_event_at,
            work_date, reason, status)
         select p.company_id, auth.uid(), $1, $2::public.entry_type, $3::timestamptz,
                $4::date, $5, 'pending'
           from public.profiles p where p.id = auth.uid()
         returning *`,
        [targetEntryId ?? null, tipo, eventAt, workDate, motivo],
      )
      return rows[0]
    })
  })

  app.post('/api/solicitudes/:id/resolver', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const { aprobar, nota } = peticion.body ?? {}
    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        'select * from public.review_correction($1::uuid, $2::boolean, $3)',
        [peticion.params.id, aprobar, nota ?? null],
      )
      return rows[0]
    })
  })

  app.get('/api/auditoria', async (peticion) => {
    const userId = await exigirSesion(peticion)
    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        `select a.*, p.full_name as actor_name
           from public.time_entry_audits a
           left join public.profiles p on p.id = a.actor_id
          order by a.created_at desc
          limit 500`,
      )
      return rows
    })
  })

  app.patch('/api/perfil/geo', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const consiente = Boolean(peticion.body?.consiente)
    return comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        `update public.profiles
            set geo_consent = $1,
                geo_consent_at = case when $1 then now() else null end
          where id = auth.uid()
        returning id, geo_consent, geo_consent_at`,
        [consiente],
      )
      return rows[0]
    })
  })

  app.post('/api/accesos', async (peticion) => {
    const userId = await exigirSesion(peticion)
    const { accion, sujeto, desde, hasta } = peticion.body ?? {}
    await comoUsuario(userId, (c) =>
      c.query(
        `insert into public.access_logs
           (company_id, actor_id, actor_role, action, subject_user_id, period_start, period_end)
         select p.company_id, auth.uid(), p.role, $1, $2, $3::date, $4::date
           from public.profiles p where p.id = auth.uid()`,
        [accion, sujeto ?? null, desde ?? null, hasta ?? null],
      ),
    )
    return { ok: true }
  })

  /**
   * Comprobación de la cadena de hashes.
   *
   * Devuelve los asientos cuyo sello no cuadra con el anterior. Cero filas
   * significa que nadie ha tocado el libro por detrás de la aplicación. En
   * una instalación autoalojada esta es LA prueba que se enseña, porque aquí
   * el administrador del equipo sí tiene acceso directo a PostgreSQL.
   */
  app.get('/api/integridad', async (peticion) => {
    const userId = await exigirSesion(peticion)
    return comoUsuario(userId, async (c) => {
      const { rows: perfil } = await c.query(
        'select company_id from public.profiles where id = auth.uid()',
      )
      const { rows } = await c.query('select * from public.verify_ledger($1)', [
        perfil[0].company_id,
      ])
      return { anomalias: rows.length, detalle: rows }
    })
  })

  // -------------------------------------------------------------------
  // Sincronización en vivo (SSE)
  // -------------------------------------------------------------------
  app.get('/api/eventos', async (peticion, respuesta) => {
    const userId = await exigirSesion(peticion)

    const { companyId } = await comoUsuario(userId, async (c) => {
      const { rows } = await c.query(
        'select company_id from public.profiles where id = auth.uid()',
      )
      return { companyId: rows[0]?.company_id }
    })

    respuesta.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Sin esto, un proxy intermedio puede acumular la respuesta y el
      // «en vivo» dejar de serlo.
      'X-Accel-Buffering': 'no',
    })
    respuesta.raw.write('retry: 5000\n\n')

    const enviar = (aviso) => {
      if (aviso.company_id !== companyId) return
      respuesta.raw.write(`data: ${JSON.stringify(aviso)}\n\n`)
    }

    const baja = difusor.suscribir(enviar)

    // Latido: mantiene viva la conexión a través de proxies que cierran las
    // que llevan un rato en silencio.
    const latido = setInterval(() => respuesta.raw.write(': latido\n\n'), 25_000)

    peticion.raw.on('close', () => {
      clearInterval(latido)
      baja()
    })

    return respuesta
  })
}
