# Cumplimiento normativo

Cómo satisface esta aplicación cada obligación del registro de jornada, y
dónde está exactamente el código que lo garantiza.

> Este documento describe decisiones técnicas de diseño. No es asesoramiento
> jurídico: la calificación definitiva de las horas y las particularidades del
> convenio aplicable corresponden al departamento laboral de cada empresa.

---

## 1. Marco normativo aplicado

| Norma | Obligación | Implementación |
|---|---|---|
| Art. 34.9 ET | Registro diario de jornada con hora de inicio y fin | Colección `time_entries` con eventos `clock_in` / `break_start` / `break_end` / `clock_out` |
| Art. 34.9 ET | Conservación durante 4 años | `companies.retention_years`, que las reglas impiden bajar de 4, y ausencia total de ruta de borrado |
| Art. 34.9 ET | Puesta a disposición de la plantilla, la RLT y la ITSS | Rol `inspector`, vista `/inspeccion` y exportación PDF/Excel |
| RDL 8/2019 | Registro objetivo y fiable | `recorded_at` sellado por el servidor (`request.time`), exigido por regla |
| Art. 35 ET | Distinción de horas extraordinarias | Desglose ordinarias/extraordinarias en informes |
| RGPD art. 5.1.c | Minimización de datos | Las reglas acotan cada lectura a su titular o a su empresa; sin geolocalización por defecto |
| RGPD art. 7 | Consentimiento explícito | `profiles.geo_consent` + `geo_consent_at`, revocable |
| LOPDGDD art. 90 | Información previa sobre geolocalización | `companies.geolocation_notice` obligatorio por regla para poder activarla |

Todo lo anterior vive en **`firestore.rules`**, que se evalúa en el servidor de
Google. No es validación de interfaz: no se puede esquivar desde la consola del
navegador, con `curl`, ni con un SDK modificado.

---

## 2. Inalterabilidad

El registro horario está modelado como un **libro de asientos** (*append-only
ledger*). Un fichaje nunca se actualiza ni se borra.

### La barrera principal: no existe la operación

```
match /time_entries/{entryId} {
  allow get, list: …
  allow create:    …
  // NO hay allow update. NO hay allow delete.
}
```

Esto no es una omisión: es el núcleo de la garantía. En Firestore, **lo que no
está explícitamente permitido está denegado**. No hay una regla que prohíba
modificar un fichaje — es que la operación no existe para nadie: ni para la
persona trabajadora, ni para administración, ni para quien abra la consola del
navegador con la sesión de un administrador.

La regla comodín final cierra cualquier ruta no contemplada:

```
match /{document=**} {
  allow read, write: if false;
}
```

### La hora de grabación la pone el servidor

```
function selladoPorElServidor(datos) {
  return datos.recorded_at == request.time;
}
```

`request.time` es el reloj de Google en el instante de la escritura, y la regla
**exige** que el documento lo lleve. Un móvil con la hora cambiada no puede
antedatar un fichaje: puede mentir sobre `event_at` (el momento declarado), y
por eso ese campo está acotado a una ventana razonable, pero no sobre cuándo se
grabó realmente. La diferencia entre ambos queda registrada y es auditable.

```
function momentoRazonable(datos) {
  return datos.event_at is timestamp
    && datos.event_at <= request.time + duration.value(5, 'm')
    && datos.event_at >= request.time - duration.value(26, 'h');
}
```

Cinco minutos de adelanto absorben el desfase del reloj del dispositivo; 26
horas de retraso permiten sincronizar un fichaje hecho sin cobertura.

### Qué se perdió al migrar desde PostgreSQL, y por qué

La versión anterior encadenaba cada asiento con el anterior mediante
`SHA-256(hash_anterior || carga_útil)`, de modo que una manipulación por acceso
directo a la base de datos rompía la cadena y era detectable.

En Firestore esa cadena exigiría una **Cloud Function** (plan Blaze) que la
calculase en el servidor. Calcularla en el navegador no probaría nada: el
cliente es justo aquello que no se puede dar por fiable, y una cadena que el
propio manipulador puede recalcular no es una garantía, es decoración.

Lo que la sustituye y basta para el Art. 34.9 ET: ningún camino de escritura
permite modificar ni borrar un asiento, y la hora de grabación la impone el
servidor. Quien quiera además la detección de manipulación por consola
administrativa tiene, en el plan Blaze, los **Cloud Audit Logs** de Google, que
registran todo acceso administrativo a los datos. La Cloud Function que
restaure la cadena hash está pendiente y es opcional.

Por eso `verifyLedger()` en `src/lib/api.ts` devuelve 0 con un comentario que
lo explica, y la pantalla de Inspección ya no afirma verificar una cadena que
no existe: dice lo que el sistema sí garantiza.

---

## 3. Cómo se rectifica un fichaje sin romper la inalterabilidad

Un error de fichaje es inevitable, y la ley no exige que sea inmutable *el
hecho*, sino que lo sea *el registro*. La rectificación se modela como un
asiento **nuevo** que sustituye al anterior:

```
asiento A  17:27  Salida        ← permanece almacenado para siempre
     ▲
     │ supersedes_id
asiento B  18:37  Salida  (origin = 'correction', reason = '…')
```

La función `vigentes()` de `src/lib/firestore.ts` descarta los asientos
sustituidos al mostrar el historial; la colección conserva ambos. La vista de
Inspección usa `getRawEntries()`, que devuelve el libro íntegro: el asiento
original junto a la rectificación que lo reemplazó, con su motivo y su autor.

**No hay una colección de auditoría separada, y es deliberado.** Un registro de
auditoría paralelo a los datos puede desincronizarse del hecho que audita. Aquí
la auditoría *son* los propios asientos: `fbGetAudits()` la deriva recorriendo
los `supersedes_id`, y por tanto no puede contradecir al libro porque es el
libro.

| Campo del asiento de corrección | Contenido |
|---|---|
| `supersedes_id` | Identificador del asiento al que sustituye |
| `event_at` del sustituido | Hora original: **17:27** |
| `event_at` del nuevo | Hora rectificada: **18:37** |
| `reason` | Motivo alegado (mínimo 10 caracteres, exigido por regla) |
| `created_by` | Quién lo autorizó |
| `recorded_at` | Momento de la rectificación, sellado por el servidor |

Garantías adicionales, todas verificadas por la batería de pruebas:

- Una rectificación **sin motivo documentado** de al menos 10 caracteres se
  rechaza en el servidor.
- Una rectificación **no puede cambiar de titular ni de empresa**: la regla lee
  el asiento sustituido y compara `user_id` y `company_id`.
- Solo `admin` y `manager` pueden rectificar. Una persona trabajadora **no
  puede corregirse a sí misma** ni siquiera declarando `origin = 'correction'`.
- **Regla de los cuatro ojos**: nadie aprueba su propia solicitud, ni siquiera
  con perfil de administración (`resource.data.user_id != request.auth.uid`).
- Al resolver una solicitud **no se puede reescribir lo solicitado**: la regla
  exige que `user_id`, `requested_event_at`, `requested_type` y `reason` sigan
  siendo los mismos que cuando se pidió.

---

## 4. Aislamiento de datos

| Perfil | Alcance |
|---|---|
| `employee` | Solo sus propios fichajes y solicitudes |
| `manager` | Su empresa: lectura, aprobación de rectificaciones |
| `admin` | Su empresa: además, configuración y alta manual |
| `inspector` | Su empresa en **solo lectura**; no puede fichar ni escribir |

El rol y la empresa se leen del documento `profiles/{uid}`, no de nada que
envíe el cliente. Las reglas impiden que alguien **se ascienda a sí mismo**: la
auto-edición del perfil está acotada a dos campos exactos,

```
request.resource.data.diff(resource.data).affectedKeys()
  .hasOnly(['geo_consent', 'geo_consent_at'])
```

de modo que cambiarse el rol, la empresa, la jornada contratada o el estado de
alta queda fuera del camino permitido. Las altas las crea el Admin SDK desde
`scripts/alta-personas.mjs` (`allow create: if false` para el cliente).

Un administrador de otra empresa no recibe un error de interfaz: recibe una
denegación del servidor. El aislamiento es estructural.

---

## 5. Geolocalización

Desactivada por defecto (`geolocation_policy = 'disabled'`). Para activarla
deben cumplirse **a la vez**:

1. La empresa la habilita y **publica un aviso informativo**. La regla de
   `companies` impide activarla sin un aviso de más de 20 caracteres.
2. La persona trabajadora **consiente expresamente** (`profiles.geo_consent`),
   y puede retirarlo desde Ajustes.

Se registra únicamente el punto del instante del fichaje, nunca un rastro
continuo. Con política `optional`, negarse o que falle el GPS **no impide
fichar**: la obligación legal es el registro horario, no la ubicación.

> **Limitación conocida.** En PostgreSQL un `CHECK` impedía almacenar
> coordenadas sin consentimiento. Esa comprobación vive ahora en el cliente
> (`fbPunch()` solo adjunta coordenadas si la política y el consentimiento lo
> permiten), no en las reglas, porque comprobarla en el servidor exigiría una
> lectura extra del perfil en cada fichaje. El riesgo es acotado —solo afecta a
> quien manipule su propio dispositivo para enviar su propia ubicación— pero
> conviene conocerlo. Si le preocupa, la solución es una Cloud Function de
> validación previa a la escritura.

---

## 6. Conservación y supresión

`retention_years` no admite valores inferiores a 4, y la regla de `companies`
rechaza cualquier intento de bajarlo. No existe ninguna ruta de borrado de
asientos: ni automática, ni administrativa, ni manual desde la aplicación.
Depurar el libro pasado el plazo legal exige acceso de administración del
proyecto con el Admin SDK, es decir, un acto humano documentado y fuera de la
aplicación, que es exactamente lo que debe ser.

Ante un ejercicio del derecho de supresión (RGPD art. 17), la supresión de los
fichajes **no procede** mientras dure el plazo legal de conservación
(art. 17.3.b RGPD: tratamiento necesario para cumplir una obligación legal).

Firestore **no hace copias de seguridad automáticas en el plan gratuito**, y el
registro debe conservarse cuatro años. El procedimiento de exportación
periódica está en [`DESPLIEGUE.md`](DESPLIEGUE.md#copias-de-seguridad) y no es
opcional: es parte del cumplimiento.

---

## 7. Trazabilidad de accesos

`access_logs` registra quién consulta o exporta qué periodo y de quién
(`export_pdf`, `export_xlsx`, `view_inspection`). Es de **solo añadir**: sus
reglas tampoco contemplan `update` ni `delete`, y solo administración puede
leerlo. Alimenta el registro de actividades de tratamiento y permite responder
a la RLT sobre el uso que la empresa hace de los datos de jornada.

---

## 8. Fichaje sin conexión

Un fichaje no puede perderse por falta de cobertura. Si la escritura falla, el
evento se guarda en IndexedDB con **su hora real** y se reenvía al recuperar la
red, marcado como `employee_offline`. El servidor sella `recorded_at` con su
propio reloj, de modo que la diferencia entre *cuándo ocurrió* y *cuándo se
registró* queda documentada y es auditable.

La regla acota el desfase admisible a 5 minutos de adelanto y 26 horas de
retraso: suficiente para una jornada completa sin cobertura, insuficiente para
inventarse una semana.

---

## 9. Verificación

Las garantías anteriores no se afirman: se prueban. `test/reglas.test.mjs`
contiene **38 aserciones** que se ejecutan contra el **emulador real de
Firestore** —no contra un simulacro— y que intentan **activamente** romper cada
garantía, fallando ruidosamente si lo consiguen.

```bash
npm run test:rules
```

Cubre, entre otras: modificar un fichaje como administración, como responsable
y como persona trabajadora; borrarlo; antedatar `recorded_at`; declarar un
`event_at` futuro o de hace 40 horas; fichar en nombre de otra persona; leer
datos de otra empresa; rectificar sin motivo; rectificar cambiando de titular;
autocorregirse siendo empleado; escribir con perfil de inspección; aprobar la
propia solicitud; reescribir lo solicitado al resolverlo; ascenderse a
administrador; cambiarse de empresa o de jornada contratada; bajar la
conservación por debajo de 4 años; activar la geolocalización sin aviso previo;
y alterar o borrar un registro de acceso.

Cada una de esas aserciones espera un **fallo de permisos del servidor**. Si
alguna dejara de fallar, la prueba se rompe.
