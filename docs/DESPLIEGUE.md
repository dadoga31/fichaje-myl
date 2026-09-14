# Puesta en producción

Objetivo: que la plantilla fiche desde el móvil, por internet, y que lo que
una persona ficha aparezca **al instante** en el panel de quien supervisa.

```
   Móvil / PC  ──HTTPS──▶  Vercel      (la PWA: HTML, JS, service worker)
                              │
                              └────────▶ Firebase
                                         · Firestore (los fichajes)
                                         · Security Rules (la garantía legal)
                                         · Auth (usuarios reales)
                                         · Sincronización en tiempo real
```

Vercel sirve **solo ficheros estáticos**; no guarda ningún dato de jornada.

---

## 1. Preparar el proyecto de Firebase

En la [consola de Firebase](https://console.firebase.google.com), sobre su
proyecto `fichaje-myl`:

1. **Authentication → Sign-in method → Email/Password → Habilitar.**
   No active el registro público: las cuentas las crea la empresa.
2. **Firestore Database → Crear base de datos.**
   - Modo: **producción** (empezar bloqueado; las reglas se despliegan luego).
   - Ubicación: **eur3 (europe-west)** o **europe-west1** — los datos de
     personal deben quedarse en la UE (RGPD). **Esto no se puede cambiar
     después**, así que elíjalo con cuidado.

## 2. Desplegar las reglas de seguridad

**Este es el paso más importante de todos.** En Firebase, las Security Rules
son lo que hace que un fichaje no se pueda alterar. Sin ellas desplegadas, o
la base está cerrada a todo, o está abierta de par en par.

```bash
npx firebase login
npx firebase use fichaje-myl-9fb51
npx firebase deploy --only firestore:rules,firestore:indexes
```

Compruebe en **Firestore → Reglas** que aparecen las suyas y no las de por
defecto.

## 3. Dar de alta la empresa y a las personas

Necesita la clave de cuenta de servicio: **Configuración del proyecto →
Cuentas de servicio → Generar nueva clave privada**.

> ⚠ Ese JSON es la llave maestra del proyecto: se salta todas las reglas.
> No lo suba al repositorio ni lo ponga en Vercel. Solo vive en su equipo.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/clave-privada.json

# La empresa, una sola vez
node scripts/alta-personas.mjs --empresa "Mi Empresa SL" --cif B12345678
# → anote el company_id que devuelve
```

Prepare el CSV con la plantilla real:

```csv
email,nombre,rol,numero_empleado,nif,horas_semana
ana.perez@miempresa.es,Ana Pérez Ruiz,employee,E-001,12345678Z,40
luis.marin@miempresa.es,Luis Marín Soto,admin,A-001,87654321X,40
```

Roles: `employee` (ficha) · `manager` (además aprueba) · `admin` (además
configura) · `inspector` (solo lectura, para la ITSS o la RLT).

```bash
node scripts/alta-personas.mjs plantilla.csv --dry-run   # solo comprueba
node scripts/alta-personas.mjs plantilla.csv             # crea de verdad
```

Al terminar imprime las **contraseñas iniciales**. No se pueden volver a
consultar: cópielas, repártalas por un canal seguro y pida que las cambien.

> Necesita al menos una persona con rol `admin`, o no habrá quien apruebe
> rectificaciones: nadie puede aprobar las suyas propias.

## 4. Conectar Vercel

En **Settings → Environment Variables**, para *Production*, *Preview* y
*Development*:

| Variable | Dónde se obtiene |
|---|---|
| `VITE_FIREBASE_API_KEY` | Configuración del proyecto → Tus apps |
| `VITE_FIREBASE_AUTH_DOMAIN` | ídem |
| `VITE_FIREBASE_PROJECT_ID` | ídem |
| `VITE_FIREBASE_STORAGE_BUCKET` | ídem |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ídem |
| `VITE_FIREBASE_APP_ID` | ídem |

Esta configuración **es pública por diseño**: viaja en el JavaScript que
descarga cualquier visitante y solo identifica al proyecto. No es una
contraseña. Quien protege los datos son las reglas del paso 2.

Por eso mismo, su **visibilidad en Vercel debe ser «Config», no «Secret»**. El
prefijo `VITE_` es público por definición y Vercel rechaza marcarlo como
secreto: marcarlo no lo ocultaría, solo le haría creer que lo está.

**Nunca ponga en Vercel la clave de cuenta de servicio.**

Después, **Deployments → Redeploy**, y desmarque *Use existing Build Cache*.
Vercel no recoge variables nuevas sin un build nuevo, porque Vite las incrusta
en el JavaScript durante la compilación. Es el paso que más veces se olvida.

### Si el despliegue falla diciendo que falta la configuración

Es deliberado. `scripts/verificar-entorno.mjs` se ejecuta antes de compilar y
**rompe el build** si no encuentra las seis variables, en lugar de publicar una
aplicación que no puede conectarse a nada. El registro de una empresa en la que
nadie puede fichar es peor que un despliegue en rojo.

El propio error enumera cuáles faltan y **qué variables `VITE_*` ha visto el
build**, que es lo que distingue «no las he guardado» de «las he escrito mal».
También detecta espacios sobrantes al copiar el valor, que no se ven en el
formulario y rompen igual que si faltara.

Repasos habituales: que estén en **este** proyecto de Vercel y no en otro de la
misma cuenta, y que estén marcadas para **Production** y no solo para Preview.

## 5. Autorizar el dominio

**Authentication → Settings → Dominios autorizados**: añada su dominio de
Vercel. Sin esto, el inicio de sesión falla.

---

## Cómo se accede

- **Personas trabajadoras**: abren `https://su-dominio` en el móvil, entran con
  su correo y contraseña, y pulsan **Añadir a pantalla de inicio**. A partir de
  ahí se abre como una aplicación y ficha aunque se quede sin cobertura.
- **Administración**: el mismo enlace desde el PC.

La instalación y el modo sin conexión **exigen HTTPS**. Con Vercel ya lo tiene.

---

## Comprobar que la sincronización funciona

1. Abra la app en el móvil con una cuenta de persona trabajadora.
2. En el PC, con la cuenta de administración, entre en **Plantilla**.
3. Fiche la entrada desde el móvil.
4. El PC debe pasar a **En jornada** en un segundo, sin tocar nada.

---

## Qué cambia respecto a la versión PostgreSQL

La migración a Firebase conserva las garantías legales, pero las apoya en
mecanismos distintos. Conviene saber exactamente cuáles:

| Garantía | Antes (PostgreSQL) | Ahora (Firestore) |
|---|---|---|
| No se puede modificar un fichaje | Permisos + triggers | **Security Rules**: no existe ninguna regla `update`. Sin regla, Firestore deniega |
| No se puede borrar | Ídem | Ídem, tampoco hay regla `delete` |
| Aislamiento entre empresas | Row Level Security | Security Rules por `company_id` |
| Hora de grabación fiable | `now()` del servidor | `request.time` exigido por regla |
| Cuatro ojos en aprobaciones | Función transaccional | Regla: `resource.data.user_id != request.auth.uid` |
| Conservación ≥ 4 años | `CHECK` | Regla sobre `retention_years` |
| **Cadena hash SHA-256** | Encadenada por trigger | **No existe** (ver abajo) |

### La cadena hash: qué se perdió y qué lo sustituye

En PostgreSQL cada asiento sellaba al anterior, de modo que una manipulación
por acceso directo a la base de datos rompía la cadena y era detectable.

En Firestore esa cadena exigiría una **Cloud Function** (plan Blaze, de pago
por uso) que la calculase en el servidor. Calcularla en el navegador no
probaría nada: el cliente es justo lo que no se puede dar por fiable.

Lo que la sustituye, y que es suficiente para el Art. 34.9 ET:

- **Ningún camino de escritura permite modificar ni borrar un asiento.** No es
  que esté prohibido: es que la operación no existe en las reglas.
- **La hora de grabación la impone el servidor**, no el dispositivo.
- Con el plan Blaze puede además activar **Cloud Audit Logs**, que registra
  todo acceso administrativo a los datos.

Si más adelante quiere la cadena hash, dígamelo y preparo la Cloud Function.

---

## Copias de seguridad

Firestore **no hace copias automáticas** en el plan gratuito, y el registro de
jornada debe conservarse 4 años. Con el plan Blaze:

```bash
gcloud firestore export gs://SU-BUCKET/copias/$(date +%F) \
  --collection-ids=time_entries,profiles,companies,correction_requests
```

Prográmelo con Cloud Scheduler y guarde una copia fuera de Google.

---

## Probar las reglas antes de desplegarlas

Las reglas son ahora la garantía legal, así que tienen su propia batería que
las ataca contra el emulador real:

```bash
npm run test:rules
```

38 aserciones que intentan activamente saltarse cada barrera: modificar un
fichaje como administración, antedatarlo, leer datos de otra empresa,
aprobarse la propia rectificación, ascenderse a administrador… Si alguna
pasara, la prueba falla.
