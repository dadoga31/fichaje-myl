# Instalación en el PC de la empresa

Guía para dejar la aplicación funcionando en un ordenador de la oficina,
accesible desde el móvil de cualquier persona de la plantilla y con los datos
guardados en ese mismo equipo.

```
  Móvil / PC  ──HTTPS──▶  Cloudflare  ──túnel──▶   PC DE LA OFICINA
                                                   ├── aplicación (PWA + API)
                                                   ├── PostgreSQL  ← los fichajes
                                                   └── ./datos     ← copias y sellos
```

Por el túnel pasa **el tráfico**, no el almacenamiento: los fichajes se
escriben y se quedan en el disco de ese PC.

**Son cuatro comandos.** El esquema de la base de datos, el usuario de la
aplicación y las copias nocturnas se preparan solos; no hay que tocar
PostgreSQL ni configurar tareas programadas.

---

## Antes de empezar

**El equipo.** Cualquier ordenador que pueda quedarse encendido: un mini-PC
vale de sobra. Con 4 GB de RAM y 20 GB libres va holgado para una plantilla
de cien personas y cuatro años de registro.

**Debe estar encendido siempre, y no puede suspenderse.** Si el equipo duerme,
nadie puede fichar. En Windows: *Configuración → Sistema → Inicio/apagado →
Suspender: Nunca*. Merece la pena activar en la BIOS el arranque automático
tras un corte de luz, y conectarlo a un SAI si la oficina tiene cortes.

**Instale Docker.** En Windows y Mac, [Docker Desktop](https://www.docker.com/products/docker-desktop/),
y en sus ajustes active **«Start Docker Desktop when you sign in»**: sin eso,
tras un reinicio del PC la aplicación no vuelve sola. En Linux, Docker Engine.

**Para producción, además**: una cuenta gratuita de Cloudflare y un dominio
(vale un subdominio de uno que ya tenga el cliente). **Para probar no hace
falta ninguna de las dos cosas.**

---

## 1. Traer el proyecto

```bash
git clone https://github.com/dadoga31/fichaje-myl.git
cd fichaje-myl
```

Sin `git`: en GitHub, *Code → Download ZIP*, descomprímalo y abra una terminal
(en Windows, PowerShell) dentro de la carpeta.

## 2. Generar la configuración

```bash
docker run --rm -v "${PWD}:/w" -w /w node:22-alpine node servidor/src/configurar.js
```

El mismo comando funciona en PowerShell, en Mac y en Linux. Crea el fichero
`.env` con contraseñas aleatorias y le muestra una frase, **`CLAVE_COPIAS`**:

> **Apúntela ahora en un gestor de contraseñas.** Es la llave de las copias
> de seguridad. Si el PC se pierde y la frase solo estaba en él, las copias no
> se pueden abrir y no sirven de nada.

Si ya existe un `.env`, el configurador se niega a sobrescribirlo, y es a
propósito: sus contraseñas quedan grabadas en la base de datos la primera vez
que arranca, y cambiarlas después dejaría a la aplicación sin acceso a su
propio registro.

## 3. Arrancar en modo pruebas

```bash
docker compose --profile pruebas up -d --build
```

La primera vez tarda unos minutos (compila la aplicación). Después:

```bash
docker compose logs tunel-pruebas | grep trycloudflare
```

Verá una dirección como `https://palabras-al-azar.trycloudflare.com`. **Ábrala
en cualquier móvil**, dentro o fuera de la oficina: es la aplicación.

> Esa dirección es **temporal**: cambia cada vez que se reinicia el túnel y
> Cloudflare no garantiza su disponibilidad. Sirve para probar con los
> móviles, no para que la plantilla fiche a diario. Para eso está el paso 6.

Desde el propio PC también puede abrir `http://localhost:3000`.

## 4. Dar de alta la empresa y a las personas

```bash
docker compose run --rm admin node src/alta.js --empresa "Mi Empresa SL" --cif B12345678
```

Prepare un CSV y guárdelo **en la carpeta `datos`** del proyecto como
`datos/plantilla.csv`:

```csv
email,nombre,rol,numero_empleado,nif,horas_semana
ana.perez@miempresa.es,Ana Pérez Ruiz,employee,E-001,12345678Z,40
luis.marin@miempresa.es,Luis Marín Soto,admin,A-001,87654321X,40
```

```bash
docker compose run --rm admin node src/alta.js /datos/plantilla.csv --dry-run
docker compose run --rm admin node src/alta.js /datos/plantilla.csv
```

Imprime las contraseñas iniciales **una sola vez**. Cada persona la cambia en
*Ajustes → Su contraseña*.

**Borre `datos/plantilla.csv` en cuanto termine el alta.** Contiene nombres,
correos y NIF de toda la plantilla, y esa carpeta es la que se lleva fuera de
la oficina con las copias.

Roles: `employee`, `manager`, `admin`, `inspector`. Con una sola empresa dada
de alta, el script la detecta solo.

---

## 5. Fase de pruebas

Pruebe todo lo que quiera: fichar desde varios móviles a la vez, el panel en
vivo, las pausas, las jornadas que cruzan medianoche, fichar sin cobertura,
pedir y aprobar correcciones, los informes, la vista de Inspección.

Lo que **no** podrá es editar ni borrar un fichaje desde la aplicación. No
está escondido: la operación no existe, y el usuario de base de datos de la
aplicación recibe *permission denied* si lo intenta. Compruébelo —es justo lo
que compra el cliente— y use el circuito de rectificación, que es la vía
legal: la persona solicita el cambio, administración lo aprueba, y quedan el
asiento original y el nuevo, con su motivo y su autor.

### Volver a empezar

```bash
docker compose run --rm admin node src/reiniciar.js --confirmo
```

Tantas veces como quiera. Deja la base recién instalada —sin empresas, sin
personas, sin fichajes, contadores a uno— y antes de borrar guarda una copia
de rescate. Después repita el paso 4.

### Por qué no se borran fichajes sueltos

Cada asiento guarda el hash del anterior. Si se borraran los de prueba y se
siguiera con la misma base, el primer asiento superviviente apuntaría a un
hash que ya no existe: la cadena quedaría rota **para siempre** y la
aplicación informaría de manipulación durante los cuatro años siguientes.
Ante una inspección, un registro que se autodenuncia como alterado es peor que
no tener registro. Por eso solo existe el reinicio completo.

---

## 6. Paso a producción

### a) El túnel definitivo

En **Cloudflare Zero Trust** → *Networks* → *Tunnels* → *Create a tunnel* →
*Cloudflared*:

1. Póngale nombre (`fichaje-oficina`).
2. Copie el **token** y péguelo en `TOKEN_TUNEL=` dentro del fichero `.env`.
3. En *Public hostnames*, añada su dominio —`fichaje.suempresa.es`— apuntando
   al servicio **`http://aplicacion:3000`**.

### b) Vaciar las pruebas y cerrar el cerrojo

```bash
docker compose --profile pruebas down
docker compose run --rm admin node src/reiniciar.js --confirmo --produccion
docker compose --profile produccion up -d
```

`--produccion` vacía la base y **cierra un cerrojo permanente**: desde ese
momento el script de reinicio se niega a ejecutarse en este equipo. Es
deliberado. Una herramienta capaz de vaciar el registro no puede seguir
disponible donde ese registro ya tiene valor legal. **Usted tampoco podrá
deshacerlo.**

### c) Altas reales

Repita el paso 4 con la empresa y la plantilla reales, y reparta las
contraseñas.

### d) Ese mismo día

- Saque `datos/sellos/clave-publica.pem` de la oficina y guárdela aparte.
- Saque el primer sello (`datos/sellos/sellos-AAAA.jsonl`) fuera de la oficina.

---

## Copias de seguridad

**Se hacen solas.** El servicio `respaldos` las lanza cada noche, y también al
arrancar si el equipo estuvo apagado y no hay copia de las últimas 24 horas.
No hay que configurar ninguna tarea programada.

Todo queda en la carpeta **`datos`** del proyecto, visible en el explorador de
archivos:

| Carpeta | Qué hay | Para qué |
|---|---|---|
| `datos/copias/` | Volcado completo y cifrado, cada noche (últimos 30 días) | **Restaurar** |
| `datos/sellos/` | Resumen diario firmado | **Probar** que el registro no se ha tocado |

**La copia sirve para restaurar.** Protege contra un borrado accidental o un
disco que muere. Cada copia se descifra de prueba nada más hacerse: si algo
fuera mal, se sabe esa noche y no el día que haga falta.

**El sello sirve para probar.** Es un resumen diminuto —cuántos asientos hay y
cuál es la cabeza de la cadena de hashes— firmado y fechado. En este equipo,
quien tenga administrador puede abrir PostgreSQL y editar una fila; lo que no
puede es cambiar lo que ya salió firmado y fechado de la oficina. Si alguien
altera el registro, la cabeza de la cadena dejará de coincidir con la que
quedó sellada fuera.

### Lo único que tiene que hacer usted

**Sacar la carpeta `datos` de la oficina con regularidad** —un disco USB que
se lleva a casa, una carpeta sincronizada con la nube, el correo—. Las copias
van cifradas, así que pueden viajar por cualquier sitio. Todo lo que solo
existe dentro de este PC desaparece con él: un robo, un incendio o un
ransomware se llevarían a la vez el registro y sus copias.

### Comprobar que se están haciendo

```bash
docker compose logs --tail 30 respaldos
```

Si una copia falla, ahí aparece en mayúsculas. Merece la pena mirarlo una vez
por semana.

### Restaurar una copia

Por defecto se restaura en una base **nueva**, sin tocar la que está en uso:
lo normal es querer ver qué había, no sobrescribir lo que hay.

```bash
docker compose run --rm admin node src/respaldo.js \
  --restaurar /datos/copias/fichaje-AAAA-MM-DDTHH-MM-SS.dump.enc --en comprobacion
```

Pide la `CLAVE_COPIAS` del `.env` (si el PC original se perdió, ponga en el
`.env` nuevo la que guardó en el gestor de contraseñas). Comprueba la etiqueta
de autenticación, crea la base `comprobacion` y le carga los datos.

> **Haga una restauración de prueba durante la fase de pruebas.** Una copia
> que nunca se ha restaurado es una suposición, no una copia de seguridad.

### Comprobar los sellos

```bash
docker compose run --rm admin node src/respaldo.js --verificar /datos/sellos/sellos-2026.jsonl
```

---

## Qué garantiza cada capa

| Garantía | Quién la impone |
|---|---|
| Un fichaje no se modifica ni se borra | Permisos revocados + disparadores de PostgreSQL |
| Detectar manipulación directa en base de datos | Cadena de hashes SHA-256 + `verify_ledger()` |
| Cada persona solo ve lo suyo; administración, su empresa | Row Level Security |
| La hora de grabación no la pone el dispositivo | `now()` del servidor |
| Cuatro ojos en las aprobaciones | Función `review_correction()` |
| Conservación ≥ 4 años | Restricción `CHECK` |

La aplicación atiende a la plantilla con un usuario de base de datos que **no
tiene permiso** para modificar ni borrar un fichaje. Las tareas que necesitan
más privilegios —preparar el esquema, copias, altas— corren en servicios
aparte y nunca dentro de la aplicación.

---

## Mantenimiento

```bash
docker compose ps                              # qué está en marcha
docker compose logs -f aplicacion              # qué está pasando
docker compose --profile produccion restart    # reiniciar todo

# Actualizar a una versión nueva (el esquema se migra solo al arrancar)
git pull
docker compose --profile produccion up -d --build
```

**Comprobación mensual.** Entre con un perfil de administración en
*Inspección* y confirme que la integridad del libro sale sin anomalías. Diez
segundos que detectan una manipulación antes de que pasen meses.

### Dónde viven los datos

- **Los fichajes**: en el volumen de Docker `fichaje-myl_datos_postgres`.
  En Windows y Mac está dentro del disco virtual de Docker Desktop.
  **No use nunca «Reset to factory defaults» ni «Clean / Purge data» en Docker
  Desktop, ni `docker compose down -v`**: borran ese volumen, y con él el
  registro. Para eso existen las copias de `datos/copias`.
- **Copias y sellos**: en la carpeta `datos` del proyecto.
- **Las contraseñas**: en `.env`. Sin él, una copia restaurada no arranca.
  Guárdelo también fuera del equipo, en un sitio seguro.
