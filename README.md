# Fichaje MyL

PWA de fichaje y registro de jornada laboral conforme al **Art. 34.9 del
Estatuto de los Trabajadores** y al **Real Decreto-ley 8/2019**. Instalable en
móvil y escritorio, funciona sin conexión y trata el registro horario como un
libro de asientos que nadie puede alterar.

---

## La idea de fondo

Un registro de jornada que se puede editar no prueba nada. Por eso aquí los
fichajes **no se actualizan ni se borran jamás**: son asientos de un libro.
Cuando alguien se equivoca, no se sobrescribe nada — se añade un asiento nuevo
que sustituye al anterior, y ambos quedan almacenados con el motivo, el autor y
el momento de la rectificación.

Tres barreras independientes lo garantizan, y las tres están probadas:

1. **Permisos** — `UPDATE`, `DELETE` y `TRUNCATE` revocados; sin política RLS,
   PostgreSQL deniega.
2. **Triggers** — bloqueo incondicional que alcanza también al propietario de
   la tabla y a `service_role`.
3. **Cadena hash SHA-256** — cada asiento sella el anterior. Manipular la base
   de datos por fuera de la aplicación rompe la cadena, y `verify_ledger()` lo
   detecta.

Detalle completo en [`docs/CUMPLIMIENTO.md`](docs/CUMPLIMIENTO.md).

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # y rellene URL y anon key
npm run dev                    # http://localhost:5173
```

**Sin credenciales la aplicación no arranca**: muestra una pantalla de
configuración y bloquea el acceso. Es deliberado — un registro de jornada que
vive en el `localStorage` de cada móvil no prueba nada ante una Inspección, así
que es preferible que nadie entre a que la plantilla fiche contra el navegador.

Para ver la interfaz con datos de ejemplo, sin base de datos y sin valor legal:

```bash
npm run dev:demo
```

### Despliegue en producción

Guía completa en **[`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)**: crear el
proyecto de Supabase, aplicar las migraciones, dar de alta la empresa y a las
personas reales, y conectar Vercel.

### Migraciones

Se aplican en orden desde el editor SQL de Supabase:

```
supabase/migrations/0001_schema.sql            Tablas y tipos
supabase/migrations/0002_immutability.sql      Inalterabilidad, sellado, auditoría
supabase/migrations/0003_rls.sql               Row Level Security
supabase/migrations/0004_operations.sql        RPC transaccionales y vistas
supabase/migrations/0005_realtime_y_altas.sql  Tiempo real y alta de personas
```

Las personas se dan de alta desde un CSV; el perfil se crea solo:

```bash
export SUPABASE_URL=https://xxxxx.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...                   # clave service_role
node scripts/alta-personas.mjs plantilla.csv --dry-run
node scripts/alta-personas.mjs plantilla.csv
```

### Pruebas de cumplimiento

Se ejecutan contra cualquier PostgreSQL local, sin necesidad de Supabase:

```bash
./supabase/test/run-tests.sh
```

39 aserciones que intentan romper activamente cada garantía legal.

---

## Ramas

| Rama | Para qué |
|---|---|
| `main` | Lo publicado. Solo recibe cambios ya probados, por fusión desde `dev`. |
| `dev` | Rama de trabajo. Aquí se integra y se prueba todo antes de publicar. |

Trabajo del día a día:

```bash
git checkout dev
# … cambios …
npm run build            # typecheck + build deben pasar
./supabase/test/run-tests.sh   # si se ha tocado SQL
git commit -am "…" && git push
```

Publicar en `main` cuando `dev` esté verde:

```bash
git checkout main
git merge --no-ff dev    # --no-ff deja constancia de qué se publicó y cuándo
git push
git checkout dev         # volver a la rama de trabajo
```

Para cambios grandes, ramifique desde `dev` (`git checkout -b feature/x dev`) y
fusione de vuelta a `dev`, no a `main`.

---

## Roles

| Rol | Qué puede hacer |
|---|---|
| `employee` | Fichar, ver su historial, solicitar rectificaciones |
| `manager` | Lo anterior + panel de plantilla, aprobaciones e informes |
| `admin` | Lo anterior + configuración de la empresa |
| `inspector` | **Solo lectura** de toda la empresa, para la ITSS o la RLT |

---

## Funcionalidad

**Persona trabajadora**
La pantalla de fichaje ocupa una sola pantalla y no se desplaza: contador de
jornada en vivo, reloj, y un botón de acción según el estado que exige
mantener la pulsación. Todo lo demás —historial en calendario con el detalle
de cada día y sus rectificaciones, y solicitud de correcciones— vive en sus
propias secciones.

**Administración**
Panel en vivo del estado de la plantilla, bandeja de aprobaciones con la regla
de los cuatro ojos, registro de auditoría e informes mensuales individuales o
colectivos en PDF normalizado y Excel.

**Inspección**
Libro completo incluidos los asientos sustituidos, certificado de integridad de
la cadena hash y exportación inmediata.

---

## Arquitectura

```
src/
├── lib/
│   ├── api.ts           Capa de datos: despacha a Supabase o al backend demo
│   ├── demo.ts          Backend en memoria con las mismas reglas del servidor
│   ├── offlineQueue.ts  Cola de fichajes sin conexión (IndexedDB)
│   ├── time.ts          Cómputo de jornada, espejo de daily_summary() en SQL
│   ├── exportPdf.ts     Informe mensual normalizado (jsPDF)
│   ├── exportExcel.ts   Informe .xlsx nativo
│   └── zip.ts           Escritor ZIP propio: .xlsx sin dependencias pesadas
├── components/          PunchPanel (fichaje), Layout, primitivas de UI
├── pages/               Una por ruta
└── hooks/               Reloj, conectividad, geolocalización
```

**Stack:** React 19 · TypeScript · Vite · Tailwind CSS v4 · vite-plugin-pwa ·
Supabase (PostgreSQL + RLS) · lucide-react.

Los generadores de PDF y Excel se cargan bajo demanda: la pantalla de fichaje
no arrastra medio megabyte de dependencias que casi nadie usa desde el móvil.

---

## Sincronización en tiempo real

Cada fichaje llega empujado por el servidor a través de Supabase Realtime: lo
que una persona ficha aparece en el panel de quien supervisa en el mismo
instante, sin recargar. La difusión respeta la RLS de cada suscriptor —la
persona trabajadora solo recibe sus propios fichajes; administración, los de su
empresa—, así que sincronizar no abre ningún agujero de privacidad.

Si el WebSocket se cae (un móvil que se duerme, una red inestable), un sondeo
de 60 segundos recupera el estado sin que nadie tenga que recargar.

---

## Sin conexión

La PWA cachea la aplicación y permite fichar sin cobertura. El fichaje se
guarda con **su hora real** en IndexedDB y se reenvía al recuperar la red,
marcado como diferido. El servidor sella la hora de grabación con su propio
reloj, así que la diferencia entre cuándo ocurrió y cuándo se registró queda
documentada.

---

## Diseño

Estética *Minimal Stark*: bordes finos, radios contenidos, alta densidad
informativa y tipografía tabular en toda cifra que deba compararse. El morado
corporativo (`#6B21A8`) se reserva para la acción y el estado; el color de
estado —verde en jornada, naranja en pausa, gris fuera de jornada— nunca es la
única señal, siempre va acompañado de texto.

Los iconos de la PWA se generan con `node scripts/generate-icons.mjs`, que
rasteriza el logotipo y codifica los PNG sin librerías gráficas.

---

## Licencia

Uso interno. Verifique con su departamento laboral la adecuación al convenio
colectivo aplicable antes de desplegarlo en producción.
