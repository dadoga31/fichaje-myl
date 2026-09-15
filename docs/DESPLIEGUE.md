# Instalación en el PC de la empresa

Guía para dejar la aplicación funcionando en un ordenador de la oficina del
cliente, accesible desde el móvil de cualquier persona de la plantilla y con
los datos guardados en ese mismo equipo.

```
  Móvil / PC  ──HTTPS──▶  Cloudflare  ──túnel──▶   PC DE LA OFICINA
                                                   ├── aplicación (PWA + API)
                                                   └── PostgreSQL  ← los datos
```

Por el túnel pasa **el tráfico**, no el almacenamiento: los fichajes se
escriben y se quedan en el disco de ese PC.

---

## Antes de empezar

**El equipo.** Cualquier ordenador con Docker que pueda quedarse encendido:
un mini-PC vale de sobra. Con 4 GB de RAM y 20 GB libres va holgado para una
plantilla de cien personas y cuatro años de registro.

**Debe estar encendido siempre.** Si está apagado, nadie puede fichar. Merece
la pena configurar en la BIOS el arranque automático tras un corte de luz, y
conectarlo a un SAI si la oficina tiene cortes.

**Tres cosas que instalar**: Docker, una cuenta gratuita de Cloudflare y un
dominio (vale un subdominio de uno que ya tenga el cliente).

---

## 1. Traer el proyecto y configurarlo

```bash
git clone https://github.com/dadoga31/fichaje-myl.git
cd fichaje-myl
cp .env.example .env
```

Edite `.env` y rellene:

| Variable | Qué poner |
|---|---|
| `POSTGRES_PASSWORD` | Contraseña del superusuario de la base de datos. Genérela larga y guárdela |
| `PGPASSWORD` | Contraseña del usuario con el que la aplicación atiende a la plantilla |
| `CLAVE_COPIAS` | Frase para cifrar las copias. **Mínimo 16 caracteres** |
| `TOKEN_TUNEL` | Testigo del túnel; se obtiene en el paso 3 |

> **`CLAVE_COPIAS` en un gestor de contraseñas, hoy.** Sin ella las copias de
> seguridad no se pueden restaurar, y entonces no son copias de nada.

---

## 2. Arrancar

```bash
docker compose up -d
docker compose logs -f aplicacion    # Ctrl-C para salir del registro
```

Cree el usuario de base de datos de la aplicación y aplique el esquema:

```bash
docker compose exec postgres psql -U postgres -d fichaje \
  -c "create role fichaje_app login password 'LA_QUE_PUSO_EN_PGPASSWORD'"

docker compose exec aplicacion node src/migrar.js

docker compose exec postgres psql -U postgres -d fichaje \
  -c "grant authenticated, service_role to fichaje_app"
```

El orden importa: `migrar.js` es quien crea los roles `authenticated` y
`service_role`, así que el `grant` va después.

---

## 3. Publicarlo en internet

En el panel de **Cloudflare Zero Trust** → *Networks* → *Tunnels* →
*Create a tunnel* → *Cloudflared*:

1. Póngale nombre (`fichaje-oficina`, por ejemplo).
2. Copie el **token** y péguelo en `TOKEN_TUNEL` del fichero `.env`.
3. En *Public hostnames*, añada su dominio —`fichaje.suempresa.es`— apuntando
   al servicio `http://aplicacion:3000`.

```bash
docker compose up -d tunel
```

Cloudflare emite el certificado HTTPS solo. A partir de aquí la aplicación es
accesible desde cualquier móvil, dentro y fuera de la oficina.

**El equipo no tiene ningún puerto abierto hacia internet.** `cloudflared`
abre una conexión de salida; nadie puede iniciar una conexión hacia el PC.
Eso es lo que hace que instalar esto en una oficina no sea temerario.

---

## 4. Dar de alta la empresa y a las personas

```bash
docker compose exec aplicacion node src/alta.js --empresa "Mi Empresa SL" --cif B12345678
```

Anote el `company_id` que imprime. Prepare un CSV:

```csv
email,nombre,rol,numero_empleado,nif,horas_semana
ana.perez@miempresa.es,Ana Pérez Ruiz,employee,E-001,12345678Z,40
luis.marin@miempresa.es,Luis Marín Soto,admin,A-001,87654321X,40
```

```bash
docker compose cp plantilla.csv aplicacion:/tmp/plantilla.csv
docker compose exec -e FICHAJE_COMPANY_ID=<el-id> aplicacion node src/alta.js /tmp/plantilla.csv --dry-run
docker compose exec -e FICHAJE_COMPANY_ID=<el-id> aplicacion node src/alta.js /tmp/plantilla.csv
```

Imprime las contraseñas iniciales **una sola vez**. Repártalas por un canal
seguro; cada persona la cambia desde *Ajustes → Su contraseña*.

Roles: `employee`, `manager`, `admin`, `inspector`.

---

## 5. Copias de seguridad — no es opcional

El registro debe conservarse cuatro años. Si ese PC se estropea sin copias,
desaparece la prueba entera. Programe las dos tareas con `cron`:

```cron
# Copia completa cifrada, al disco del propio equipo, cada noche
30 2 * * *  cd /ruta/fichaje-myl && docker compose exec -T aplicacion node src/respaldo.js --copia

# Sello diario firmado, para SACAR de la oficina
45 2 * * *  cd /ruta/fichaje-myl && docker compose exec -T aplicacion node src/respaldo.js --sello
```

### Por qué son dos cosas distintas

**La copia sirve para restaurar.** Es el volcado completo, cifrado, en el
disco del PC. Protege contra el borrado accidental y el fallo del disco. No
protege contra un incendio ni contra un ransomware que alcance la carpeta.

**El sello sirve para probar.** Es un resumen diminuto —cuántos asientos hay
y cuál es la cabeza de la cadena de hashes— firmado y fechado. No permite
restaurar nada: permite demostrar, meses después, qué decía el libro en una
fecha concreta.

Ahí está la clave de instalar esto en la oficina del cliente. En ese equipo,
quien tenga administrador **puede** abrir PostgreSQL y editar una fila. Lo
que no puede es cambiar lo que ya salió firmado y fechado de la oficina. Si
alguien altera el registro, la cabeza de la cadena dejará de coincidir con la
que quedó sellada fuera ese día, y quedará a la vista.

**Saque el fichero de sellos de la oficina todos los días** —correo, disco
externo, almacenamiento en la nube—. Su valor está en existir en otro sitio.

Copie también la **clave pública** (`/datos/sellos/clave-publica.pem`) y
guárdela aparte: es lo que permite a una asesoría o a un perito comprobar los
sellos sin depender del equipo que los produjo.

```bash
# Comprobar las firmas de un fichero de sellos
docker compose exec aplicacion node src/respaldo.js --verificar /datos/sellos/sellos-2026.jsonl
```

### Restaurar una copia

```bash
# Descifrar (pide la CLAVE_COPIAS)
openssl enc -d -aes-256-gcm -in fichaje-XXXX.dump.enc -out fichaje.dump ...
docker compose exec -T postgres pg_restore -U postgres -d fichaje --clean < fichaje.dump
```

> Pruebe una restauración **antes** de necesitarla. Una copia que nunca se ha
> restaurado es una suposición, no una copia de seguridad.

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

La aplicación atiende a la plantilla con un rol de base de datos que **no
tiene permiso** para modificar ni borrar un fichaje. Un fallo en el código
del servidor no basta para alterar el registro: quien lo impide es el motor
de base de datos.

```bash
# Comprobar el esquema completo sobre una base de datos desechable
docker compose exec postgres psql -U postgres -c "create database prueba"
# … aplicar migraciones y ejecutar sql/pruebas_cumplimiento.sql
```

40 aserciones que intentan **activamente** romper cada garantía.

---

## Mantenimiento

```bash
docker compose logs -f aplicacion     # ver qué pasa
docker compose restart aplicacion     # reiniciar
docker compose pull && docker compose up -d --build   # actualizar
docker compose exec aplicacion node src/migrar.js     # tras actualizar
```

**Comprobación mensual recomendada.** Entre con un perfil de administración
en *Inspección* y confirme que la integridad del libro sale sin anomalías. Es
un vistazo de diez segundos que detecta una manipulación antes de que pasen
meses.
