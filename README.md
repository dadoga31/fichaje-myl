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

Lo garantizan las **Security Rules de Firestore**, que se evalúan en el
servidor de Google y no se pueden esquivar desde el cliente:

1. **No existe ninguna regla `update` ni `delete`** sobre `time_entries`. No es
   que esté prohibido modificar un fichaje: es que la operación no existe. Sin
   regla, Firestore deniega.
2. **La hora de grabación la sella el servidor** (`request.time`), no el
   dispositivo: un móvil con la hora cambiada no puede antedatar nada.
3. **Aislamiento por empresa y por persona**, con rol de Inspección de solo
   lectura.

Detalle completo en [`docs/CUMPLIMIENTO.md`](docs/CUMPLIMIENTO.md).

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # y rellene la configuración de Firebase
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

Guía completa en **[`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)**: preparar
Firestore y Auth, desplegar las reglas, dar de alta la empresa y a las personas
reales, y conectar Vercel.

### Reglas de seguridad

`firestore.rules` es **la garantía legal** de esta aplicación. Se despliega
aparte del frontend:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes
```

### Alta de la empresa y las personas

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/clave-privada.json

node scripts/alta-personas.mjs --empresa "Mi Empresa SL" --cif B12345678
node scripts/alta-personas.mjs plantilla.csv --dry-run
node scripts/alta-personas.mjs plantilla.csv
```

### Pruebas de cumplimiento

```bash
npm run test:rules
```

38 aserciones contra el emulador real de Firestore, cada una intentando
saltarse activamente una barrera legal: modificar un fichaje como
administración, antedatarlo, leer datos de otra empresa, aprobarse la propia
rectificación, ascenderse a administrador…

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
npm run test:rules       # si se han tocado las reglas de seguridad
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
Libro completo incluidos los asientos sustituidos junto a las rectificaciones
que los reemplazaron, con su motivo y su autor, y exportación inmediata.

---

## Arquitectura

```
src/
├── lib/
│   ├── api.ts           Capa de datos: despacha a Firestore o al backend demo
│   ├── firebase.ts      Inicialización y detección de configuración
│   ├── firestore.ts     Adaptador de Firestore
│   ├── demo.ts          Backend en memoria con las mismas reglas del servidor
│   ├── offlineQueue.ts  Cola de fichajes sin conexión (IndexedDB)
│   ├── time.ts          Cómputo de jornada, compartido por cliente y resúmenes
│   ├── exportPdf.ts     Informe mensual normalizado (jsPDF)
│   ├── exportExcel.ts   Informe .xlsx nativo
│   └── zip.ts           Escritor ZIP propio: .xlsx sin dependencias pesadas
├── components/          PunchPanel (fichaje), Layout, primitivas de UI
├── pages/               Una por ruta
└── hooks/               Reloj, conectividad, geolocalización
```

**Stack:** React 19 · TypeScript · Vite · Tailwind CSS v4 · vite-plugin-pwa ·
Firebase (Firestore + Auth + Security Rules) · lucide-react.

Los generadores de PDF y Excel se cargan bajo demanda: la pantalla de fichaje
no arrastra medio megabyte de dependencias que casi nadie usa desde el móvil.

---

## Sincronización en tiempo real

Cada fichaje llega empujado por Firestore: lo que una persona ficha aparece en
el panel de quien supervisa en el mismo instante, sin recargar. La difusión
respeta las Security Rules de cada suscriptor —la persona trabajadora solo
recibe sus propios fichajes; administración, los de su empresa—, así que
sincronizar no abre ningún agujero de privacidad.

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

## Diseño — sistema «Aurora»

Cristal esmerilado blanco flotando sobre luz morada. Dos ideas lo sostienen:

**La luz responde al estado.** El fondo de la aplicación cambia de tono con la
jornada —verde en jornada, ámbar en pausa, morado en reposo—, de modo que la
pantalla dice en qué situación estás antes de leer una sola palabra. El color
nunca va solo: siempre lo acompañan texto e icono.

**El anillo es reloj y progreso a la vez.** Sustituye a la barra plana porque
es la forma que ya significa «tiempo», y su trazo se colorea con el mismo
código que la luz del fondo.

| Elemento | Decisión |
|---|---|
| Tinta | `#1B0A33`, negro violáceo — nunca gris lavado |
| Neutros | Toda la escala gris está teñida hacia el violeta: un gris puro delataría que el color se heredó en vez de elegirse |
| Radios | 28 px en superficies héroe · 16 px en tarjetas · 10 px en controles. Que no sea todo igual es lo que evita el aspecto de plantilla |
| Sombras | Moradas y difusas, jamás grises |
| Tipografía | Bricolage Grotesque (display y reloj) + Plus Jakarta Sans (interfaz), autoalojadas para que la PWA se vea igual sin conexión |

El reloj gira cada cifra por separado y solo la que cambia. Su animación nunca
baja de opacidad 0.35: partiendo de invisible, el dígito de los segundos pasaba
media vida en blanco y parecía un fallo de renderizado.

Con `prefers-reduced-motion` la interfaz se queda quieta pero completa: la
aurora se congela en una posición, no desaparece.

Los iconos de la PWA se generan con `node scripts/generate-icons.mjs`, que
rasteriza el logotipo y codifica los PNG sin librerías gráficas.

---

## Licencia

Uso interno. Verifique con su departamento laboral la adecuación al convenio
colectivo aplicable antes de desplegarlo en producción.
