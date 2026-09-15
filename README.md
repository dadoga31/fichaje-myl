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

Lo garantiza **PostgreSQL**, no el código de la aplicación:

1. **Los permisos de `UPDATE` y `DELETE` sobre `time_entries` están revocados**,
   y un disparador incondicional bloquea la operación incluso para el dueño de
   la tabla. La aplicación atiende a la plantilla con un rol que sencillamente
   no puede alterar un fichaje.
2. **Cada asiento se encadena al anterior** con `SHA-256(hash_anterior ||
   carga)`. Manipular una fila por acceso directo a la base de datos rompe la
   cadena, y `verify_ledger()` lo delata señalando el asiento exacto.
3. **La hora de grabación la pone el servidor**, no el dispositivo.
4. **Aislamiento por empresa y por persona** con Row Level Security, y rol de
   Inspección de solo lectura.

La cadena de hashes es la pieza que hace defendible instalar esto en el equipo
del propio cliente: ahí el administrador de la máquina sí puede abrir
PostgreSQL, pero no puede hacerlo sin dejar rastro.

Detalle completo en [`docs/CUMPLIMIENTO.md`](docs/CUMPLIMIENTO.md).

---

## Dónde vive

En el **PC de la empresa**. No hay nube: los fichajes se escriben y se quedan
en el disco de ese equipo. La plantilla llega desde su móvil, dentro y fuera de
la oficina, a través de un túnel de Cloudflare que publica la aplicación **sin
abrir ningún puerto** en el equipo.

```
  Móvil / PC  ──HTTPS──▶  Cloudflare  ──túnel──▶   PC DE LA OFICINA
                                                   ├── aplicación (PWA + API)
                                                   └── PostgreSQL  ← los datos
```

Instalación completa en **[`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)**.

```bash
cp .env.example .env     # rellene contraseñas y token del túnel
docker compose up -d
docker compose exec aplicacion node src/migrar.js
docker compose exec aplicacion node src/alta.js --empresa "Mi Empresa SL" --cif B12345678
```

### Desarrollo

```bash
npm install && npm run dev      # interfaz, contra el servidor en :3000
cd servidor && npm install && npm start
```

Para ver la interfaz con datos de ejemplo, sin base de datos y sin valor legal:

```bash
npm run dev:demo
```

### Pruebas de cumplimiento

```bash
psql -d fichaje_test -f servidor/sql/pruebas_cumplimiento.sql
```

40 aserciones contra PostgreSQL, cada una intentando saltarse activamente una
barrera legal: modificar un fichaje como administración, borrarlo como
superusuario, antedatarlo, leer datos de otra empresa, aprobarse la propia
rectificación… incluida la que más importa aquí: **manipular la base de datos
por fuera de la aplicación y comprobar que la cadena de hashes lo detecta**.

### Copias de seguridad

No son opcionales: el registro debe conservarse cuatro años y vive en un solo
equipo.

```bash
node src/respaldo.js --copia   # volcado cifrado, al disco local
node src/respaldo.js --sello   # resumen firmado y fechado, para sacar fuera
```

La copia sirve para **restaurar**; el sello sirve para **probar**. El sello es
un resumen diminuto con la cabeza de la cadena, firmado, pensado para salir de
la oficina cada día: si alguien altera el registro, dejará de coincidir con lo
que quedó sellado fuera.

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
│   ├── api.ts           Capa de datos: despacha al servidor o al backend demo
│   ├── servidor.ts      Cliente de la API del servidor de la empresa
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
Fastify · PostgreSQL 16 · Docker · Cloudflare Tunnel.

Los generadores de PDF y Excel se cargan bajo demanda: la pantalla de fichaje
no arrastra medio megabyte de dependencias que casi nadie usa desde el móvil.

---

## Sincronización en tiempo real

Lo que una persona ficha aparece en el panel de quien supervisa en el mismo
instante, sin recargar. PostgreSQL emite un aviso con `NOTIFY` y el servidor lo
reenvía por SSE a los navegadores conectados.

Por ese canal viaja **solo** el identificador de la empresa y el de la persona
afectada, nunca datos de jornada: el navegador que recibe el aviso vuelve a
pedir lo que le corresponda, y esa petición pasa otra vez por la RLS. Difundir
el contenido habría sido más rápido y habría abierto un camino por el que salen
datos sin control de permisos.

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
