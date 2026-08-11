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
| Art. 34.9 ET | Registro diario de jornada con hora de inicio y fin | Tabla `time_entries` con eventos `clock_in` / `break_start` / `break_end` / `clock_out` |
| Art. 34.9 ET | Conservación durante 4 años | `companies.retention_years` con `CHECK (>= 4)` y sin ruta de borrado |
| Art. 34.9 ET | Puesta a disposición de la plantilla, la RLT y la ITSS | Rol `inspector`, vista `/inspeccion` y exportación PDF/Excel |
| RDL 8/2019 | Registro objetivo y fiable | Sellado en servidor de `recorded_at` + cadena hash SHA-256 |
| Art. 35 ET | Distinción de horas extraordinarias | Desglose ordinarias/extraordinarias en informes |
| RGPD art. 5.1.c | Minimización de datos | RLS: cada persona solo ve lo suyo; sin geolocalización por defecto |
| RGPD art. 7 | Consentimiento explícito | `profiles.geo_consent` + `geo_consent_at`, revocable |
| LOPDGDD art. 90 | Información previa sobre geolocalización | `companies.geolocation_notice` obligatorio por `CHECK` |

---

## 2. Inalterabilidad: tres barreras independientes

El registro horario está modelado como un **libro de asientos** (*append-only
ledger*). Un fichaje nunca se actualiza ni se borra.

### Barrera 1 — Permisos

```sql
revoke update, delete, truncate on public.time_entries from authenticated, anon;
```

No existe ninguna política `FOR UPDATE` ni `FOR DELETE` sobre `time_entries`.
Bajo RLS, la ausencia de política **deniega**.

### Barrera 2 — Triggers

Los permisos no alcanzan al propietario de la tabla ni a `service_role`. Por
eso `deny_mutation()` bloquea la operación de forma incondicional:

```sql
create trigger time_entries_no_update
  before update on public.time_entries
  for each row execute function public.deny_mutation();
```

Verificado en las pruebas: un `UPDATE` ejecutado como superusuario con acceso
directo al SQL es rechazado.

### Barrera 3 — Cadena hash

Cada asiento se sella con `SHA-256(hash_anterior || carga_útil)`, encadenado
por empresa. Manipular una fila por fuera de la aplicación —desactivando los
triggers, por ejemplo— rompe la cadena y `verify_ledger()` lo delata:

```sql
select * from public.verify_ledger('<company_id>');  -- cero filas = íntegro
```

La vista de Inspección ejecuta esta comprobación y muestra el resultado como
un certificado de integridad.

---

## 3. Cómo se rectifica un fichaje sin romper la inalterabilidad

Un error de fichaje es inevitable y la ley no exige que sea inmutable *el
hecho*, sino que lo sea *el registro*. La rectificación se modela como un
asiento **nuevo** que sustituye al anterior:

```
asiento #41  17:27  Salida        ← permanece almacenado para siempre
     ▲
     │ supersedes_id
asiento #52  18:37  Salida  (origin = 'correction', reason = '…')
```

La vista `effective_entries` muestra únicamente el vigente; `time_entries`
conserva ambos. El trigger `audit_time_entry()` escribe automáticamente en
`time_entry_audits`:

| Campo | Contenido |
|---|---|
| `old_event_at` | Hora original: **17:27** |
| `new_event_at` | Hora rectificada: **18:37** |
| `reason` | Motivo alegado + nota de administración |
| `actor_id`, `actor_role` | Quién lo autorizó y con qué perfil |
| `old_snapshot`, `new_snapshot` | Copia íntegra de ambos asientos (`jsonb`) |
| `created_at` | Momento de la rectificación |

Garantías adicionales, todas verificadas por la batería de pruebas:

- Una rectificación **sin motivo documentado** (mínimo 10 caracteres) se rechaza.
- Una rectificación **no puede cambiar de titular** ni de empresa.
- Un asiento ya rectificado **no admite una segunda rectificación paralela**
  (restricción `UNIQUE (supersedes_id)`): la cadena es lineal y auditable.
- **Regla de los cuatro ojos**: nadie aprueba su propia solicitud, ni siquiera
  con perfil de administración.

---

## 4. Aislamiento de datos (RLS)

| Perfil | Alcance |
|---|---|
| `employee` | Solo sus propios fichajes y solicitudes |
| `manager` | Su empresa: lectura, aprobación de rectificaciones |
| `admin` | Su empresa: además, configuración y alta manual |
| `inspector` | Su empresa en **solo lectura**; no puede fichar ni escribir |

Comprobado: un administrador de otra empresa obtiene **cero filas**, no un
error — el aislamiento es estructural, no una comprobación en la interfaz.

La política de auto-edición del perfil está blindada por
`protect_profile_fields()`, que impide que alguien se cambie su propio rol,
empresa, jornada contratada o estado de alta.

---

## 5. Geolocalización

Desactivada por defecto (`geolocation_policy = 'disabled'`). Para activarla
deben cumplirse **a la vez**:

1. La empresa la habilita y **publica un aviso informativo** — un `CHECK` de
   base de datos impide activarla sin él.
2. La persona trabajadora **consiente expresamente** (`profiles.geo_consent`),
   y puede retirarlo desde Ajustes.

Un `CHECK` adicional impide almacenar coordenadas sin `geo_consent = true`.
Se registra únicamente el punto del instante del fichaje, nunca un rastro
continuo. Con política `optional`, negarse o que falle el GPS **no impide
fichar**: la obligación legal es el registro horario, no la ubicación.

---

## 6. Conservación y supresión

`retention_years` no admite valores inferiores a 4. `purge_expired_entries()`
deliberadamente **no borra**: informa de cuántos asientos han superado el
plazo. El borrado real exigiría desactivar los triggers de inalterabilidad, y
eso debe ser un acto humano documentado, no una tarea automática.

Ante un ejercicio del derecho de supresión (RGPD art. 17), la supresión de los
fichajes **no procede** mientras dure el plazo legal de conservación
(art. 17.3.b RGPD: tratamiento necesario para cumplir una obligación legal).

---

## 7. Trazabilidad de accesos

`access_logs` registra quién consulta o exporta qué periodo y de quién
(`export_pdf`, `export_xlsx`, `view_inspection`). Alimenta el registro de
actividades de tratamiento y permite responder a la RLT sobre el uso que la
empresa hace de los datos de jornada.

---

## 8. Fichaje sin conexión

Un fichaje no puede perderse por falta de cobertura. Si la escritura falla, el
evento se guarda en IndexedDB con **su hora real** y se reenvía al recuperar la
red, marcado como `employee_offline`. El servidor sella `recorded_at` con su
propio reloj, de modo que la diferencia entre *cuándo ocurrió* y *cuándo se
registró* queda documentada y es auditable.

La política de inserción acota el desfase admisible: hasta 5 minutos de
adelanto (reloj del móvil) y 24 horas de retraso (sincronización diferida).

---

## 9. Verificación

Las garantías anteriores no se afirman: se prueban. La batería
`supabase/test/01_compliance_test.sql` contiene 35 aserciones que intentan
**activamente** romper cada garantía y fallan ruidosamente si lo consiguen.

```bash
./supabase/test/run-tests.sh
```

Cubre: máquina de estados, cómputo de jornada con pausas, bloqueo de
`UPDATE`/`DELETE`/`TRUNCATE` (incluido superusuario), rectificación con
auditoría completa, aislamiento entre empresas, rol de inspección de solo
lectura, integridad de la cadena hash, detección de manipulación directa en
base de datos, requisitos formales de la rectificación, conservación mínima y
consentimiento de geolocalización.
