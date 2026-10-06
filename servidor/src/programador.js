#!/usr/bin/env node
/**
 * PROGRAMADOR DE COPIAS Y SELLOS
 *
 * Corre dentro de su propio contenedor y lanza cada noche la copia cifrada y
 * el sello firmado. Sustituye a las tareas de `cron` que pedía la guía:
 *
 *   · En Windows no existe `cron`, y el Programador de tareas es otro mundo.
 *   · Una tarea que hay que acordarse de configurar es una tarea que alguien
 *     olvidará, y el registro tiene que conservarse cuatro años.
 *
 * Así las copias empiezan a hacerse el mismo día de la instalación, sin que
 * nadie tenga que hacer nada, y se reinician solas con el equipo.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = dirname(fileURLToPath(import.meta.url))
const RUTA_COPIAS = process.env.RUTA_COPIAS ?? '/datos/copias'

// Horas de madrugada: nadie está fichando y el equipo está ocioso.
const HORA_COPIA = { h: 2, m: 30 }
const HORA_SELLO = { h: 2, m: 45 }

function registro(mensaje) {
  console.log(`[${new Date().toLocaleString('es-ES')}] ${mensaje}`)
}

function ejecutar(accion) {
  return new Promise((resolve) => {
    registro(`→ ${accion}`)
    const hijo = spawn('node', [join(raiz, 'respaldo.js'), accion], {
      stdio: 'inherit',
      env: process.env,
    })
    hijo.on('close', (codigo) => {
      if (codigo === 0) registro(`✓ ${accion} terminado`)
      // Un fallo de copia tiene que verse en el registro aunque nadie esté
      // mirando: es lo primero que se consulta cuando algo va mal.
      else registro(`✖ ${accion} HA FALLADO (código ${codigo}). Revise este registro.`)
      resolve(codigo)
    })
  })
}

/** ¿Hay alguna copia de las últimas 24 horas? */
function hayCopiaReciente() {
  if (!existsSync(RUTA_COPIAS)) return false
  const limite = Date.now() - 24 * 3600 * 1000
  return readdirSync(RUTA_COPIAS).some(
    (f) => f.endsWith('.dump.enc') && statSync(join(RUTA_COPIAS, f)).mtimeMs > limite,
  )
}

const hechoHoy = { copia: '', sello: '' }
const hoy = () => new Date().toLocaleDateString('es-ES')

async function revisar() {
  const ahora = new Date()
  const minutos = ahora.getHours() * 60 + ahora.getMinutes()

  if (minutos >= HORA_COPIA.h * 60 + HORA_COPIA.m && hechoHoy.copia !== hoy()) {
    hechoHoy.copia = hoy()
    await ejecutar('--copia')
  }
  if (minutos >= HORA_SELLO.h * 60 + HORA_SELLO.m && hechoHoy.sello !== hoy()) {
    hechoHoy.sello = hoy()
    await ejecutar('--sello')
  }
}

registro('programador de copias en marcha (copia 02:30 · sello 02:45)')

// Si el equipo estuvo apagado a la hora de la copia —un fin de semana, un
// corte de luz—, se hace una al arrancar en vez de esperar a la madrugada
// siguiente con el registro sin respaldo.
if (!hayCopiaReciente()) {
  registro('no hay copia de las últimas 24 h: se hace una ahora')
  await ejecutar('--copia')
  await ejecutar('--sello')
}

// Se marca lo de hoy como hecho si ya pasó la hora, para no repetir.
const ahora = new Date()
const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes()
if (minutosAhora >= HORA_COPIA.h * 60 + HORA_COPIA.m) hechoHoy.copia = hoy()
if (minutosAhora >= HORA_SELLO.h * 60 + HORA_SELLO.m) hechoHoy.sello = hoy()

setInterval(() => void revisar(), 60_000)
