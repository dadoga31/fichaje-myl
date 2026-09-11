# Puesta en producción

Objetivo: que la plantilla fiche desde el móvil, por internet, y que lo que
una persona ficha aparezca **al instante** en el panel de quien supervisa.

Arquitectura:

```
   Móvil / PC  ──HTTPS──▶  Vercel            (la PWA: HTML, JS, service worker)
                              │
                              └──HTTPS/WSS──▶ Supabase
                                              · PostgreSQL con toda la lógica legal
                                              · Auth (usuarios reales)
                                              · Realtime (sincronización instantánea)
```

Vercel sirve **solo ficheros estáticos**; no guarda ningún dato de jornada.
Todo el registro vive en PostgreSQL, con la RLS y los triggers de
inalterabilidad que documenta [`CUMPLIMIENTO.md`](CUMPLIMIENTO.md).

---

## Por qué hacía falta esto

Hasta ahora la aplicación funcionaba en **modo demostración**: los datos se
guardaban en el `localStorage` de cada navegador. Por eso quien supervisa no
veía las jornadas de nadie — no había nada compartido que ver. Cada móvil
tenía su propia copia privada, y al borrar los datos del navegador
desaparecía todo.

Ese modo ya **no se activa solo**. Si faltan las variables de entorno, la
aplicación muestra una pantalla de configuración y no deja entrar, en vez de
fingir que funciona.

---

## 1. Crear el proyecto de Supabase

1. Entre en [supabase.com](https://supabase.com) → **New project**.
2. Región: **West EU (Ireland)** o **Central EU (Frankfurt)** — datos dentro
   de la UE, que es lo que corresponde para datos de personal (RGPD).
3. Anote la contraseña de la base de datos que le genere.
4. Cuando termine, vaya a **Settings → API** y copie:
   - **Project URL** → `https://xxxxx.supabase.co`
   - **anon public** → clave pública, va en el frontend
   - **service_role** → clave privada, **nunca** en el frontend

> La clave `anon` es pública por diseño: quien protege los datos es la RLS.
> La `service_role` se salta la RLS por completo: trátela como una contraseña
> de administración.

## 2. Aplicar el esquema

En **SQL Editor**, ejecute **en orden** y de uno en uno:

```
supabase/migrations/0001_schema.sql         Tablas y tipos
supabase/migrations/0002_immutability.sql   Inalterabilidad, sellado, auditoría
supabase/migrations/0003_rls.sql            Seguridad a nivel de fila
supabase/migrations/0004_operations.sql     Operaciones transaccionales
supabase/migrations/0005_realtime_y_altas.sql  Tiempo real + alta de personas
```

Cada uno debe terminar en **Success**. Si alguno falla, pare y revise antes
de seguir: el siguiente da por hecho que el anterior se aplicó entero.

## 3. Dar de alta la empresa

Edite `supabase/seed/01_empresa.sql` con su razón social y CIF, ejecútelo, y
**guarde el `company_id`** que devuelve.

## 4. Dar de alta a las personas

Prepare un CSV con la plantilla real:

```csv
email,nombre,rol,numero_empleado,nif,horas_semana
ana.perez@miempresa.es,Ana Pérez Ruiz,employee,E-001,12345678Z,40
luis.marin@miempresa.es,Luis Marín Soto,admin,A-001,87654321X,40
```

Roles: `employee` (ficha), `manager` (además aprueba), `admin` (además
configura), `inspector` (solo lectura, para la ITSS o la RLT).

Compruebe primero, cree después:

```bash
export SUPABASE_URL=https://xxxxx.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...        # service_role

node scripts/alta-personas.mjs plantilla.csv --dry-run   # solo comprueba
node scripts/alta-personas.mjs plantilla.csv             # crea de verdad
```

Al terminar imprime las **contraseñas iniciales**. No se pueden volver a
consultar: cópielas, repártalas por un canal seguro y pida que las cambien.

> Necesita al menos una persona con rol `admin`, o no habrá quien apruebe
> rectificaciones: nadie puede aprobar las suyas propias.

## 5. Conectar Vercel

En su proyecto de Vercel, **Settings → Environment Variables**, añada para
*Production*, *Preview* y *Development*:

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | la clave `anon public` |

**No añada nunca `SUPABASE_SERVICE_KEY` en Vercel.** El frontend no la
necesita y ahí sería pública.

Vuelva a desplegar (**Deployments → Redeploy**). Vercel no recoge variables
nuevas sin un build nuevo: este es el paso que más veces se olvida.

`vercel.json` ya está en el repositorio con lo necesario: reescritura de
rutas para que funcione el enrutado, cabeceras de seguridad, y caché correcta
del service worker.

## 6. Permitir el dominio en Supabase

**Authentication → URL Configuration**:

- *Site URL*: `https://su-dominio.vercel.app` (o su dominio propio)
- *Redirect URLs*: añada el mismo

Sin esto el inicio de sesión falla con un error de redirección.

---

## Cómo se accede

- **Personas trabajadoras**: abren `https://su-dominio` en el móvil, entran
  con su correo y su contraseña, y pulsan **Añadir a pantalla de inicio**
  (iPhone: *Compartir → Añadir a pantalla de inicio*; Android: el navegador
  lo ofrece solo). A partir de ahí se abre como una aplicación y ficha
  aunque se quede sin cobertura.
- **Administración**: el mismo enlace desde el PC. Ve *Plantilla*,
  *Aprobaciones* e *Informes* según su rol.

La instalación y el modo sin conexión **exigen HTTPS**. Con Vercel ya lo
tiene; por IP local (`http://192.168.x.x`) el navegador no registra el
service worker y no habría ni instalación ni funcionamiento offline.

---

## Comprobar que la sincronización funciona

1. Abra la app en el móvil con una cuenta de persona trabajadora.
2. Abra en el PC, en otra sesión, con la cuenta de administración, en **Plantilla**.
3. Fiche la entrada desde el móvil.
4. El PC debe pasar a **En jornada** en un segundo, sin tocar nada.

Si no cambia, revise en Supabase **Database → Replication** que la
publicación `supabase_realtime` incluye `time_entries`. La migración `0005`
lo hace automáticamente.

---

## Copias de seguridad

El plan gratuito de Supabase **no hace copias automáticas**. El registro de
jornada debe conservarse 4 años (Art. 34.9 ET), así que o contrata un plan
con copias, o programa un volcado periódico:

```bash
pg_dump "postgresql://postgres:CONTRASEÑA@db.xxxxx.supabase.co:5432/postgres" \
  --no-owner --format=custom --file="fichajes-$(date +%F).dump"
```

Guárdelo cifrado y fuera del mismo proveedor.

---

## Alternativa: servidor propio

Si prefiere no depender de Supabase, el esquema es PostgreSQL estándar: no
usa nada propietario salvo `auth.users` y `auth.uid()`, que
`supabase/test/00_supabase_stub.sql` reproduce en veinte líneas. Haría falta
sustituir autenticación y tiempo real por equivalentes propios. Dígamelo y
preparo el despliegue con Docker.
