#!/usr/bin/env node
/**
 * Genera los iconos PNG de la PWA sin depender de ninguna librería gráfica:
 * rasteriza el logotipo (reloj sobre fondo morado) y codifica el PNG a mano
 * con zlib, que ya viene en Node.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/icons')

const BRAND = [107, 33, 168] // #6B21A8
const WHITE = [255, 255, 255]

// --- Codificador PNG ---------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, rgba) {
  // Cada fila lleva un byte de filtro (0 = ninguno) por delante.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // profundidad de bit
  ihdr[9] = 6 // color RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- Rasterización con antialiasing por supermuestreo -------------------
const SS = 4 // 4x4 muestras por píxel

function drawIcon(size, { maskable }) {
  // En un icono "maskable" el sistema recorta hasta un 20 % por cada lado,
  // así que el dibujo se encoge para caber en la zona segura.
  const inset = maskable ? size * 0.14 : 0
  const cornerRadius = maskable ? size / 2 : size * 0.22
  const cx = size / 2
  const cy = size / 2

  const faceRadius = (size / 2 - inset) * 0.58
  const ringWidth = size * (maskable ? 0.055 : 0.062)
  const handWidth = ringWidth * 0.92

  // Manecillas apuntando a las 10:10, la hora canónica de los relojes.
  const hands = [
    { angle: -Math.PI / 2, length: faceRadius * 0.52 }, // minutero arriba
    { angle: Math.PI / 6, length: faceRadius * 0.42 }, // horario
  ]

  const buf = Buffer.alloc(size * size * 4)

  const distanceToSegment = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1
    const dy = y2 - y1
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq))
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0
      let fgHits = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS

          // Fondo: rectángulo redondeado.
          const qx = Math.abs(px - cx) - (size / 2 - cornerRadius)
          const qy = Math.abs(py - cy) - (size / 2 - cornerRadius)
          const inBackground =
            Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - cornerRadius <= 0
          if (!inBackground) continue
          bgHits++

          // Aro del reloj.
          const r = Math.hypot(px - cx, py - cy)
          let isWhite = Math.abs(r - faceRadius) <= ringWidth / 2

          // Manecillas.
          if (!isWhite) {
            for (const hand of hands) {
              const ex = cx + Math.cos(hand.angle) * hand.length
              const ey = cy + Math.sin(hand.angle) * hand.length
              if (distanceToSegment(px, py, cx, cy, ex, ey) <= handWidth / 2) {
                isWhite = true
                break
              }
            }
          }

          if (isWhite) fgHits++
        }
      }

      const total = SS * SS
      const alpha = bgHits / total
      const white = fgHits / total
      const idx = (y * size + x) * 4

      if (alpha === 0) {
        buf[idx + 3] = 0
        continue
      }

      // El blanco se mezcla sobre el morado en proporción a la cobertura.
      const mix = white / alpha
      for (let c = 0; c < 3; c++) {
        buf[idx + c] = Math.round(BRAND[c] * (1 - mix) + WHITE[c] * mix)
      }
      buf[idx + 3] = Math.round(alpha * 255)
    }
  }

  return encodePng(size, size, buf)
}

mkdirSync(OUT, { recursive: true })

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
]

for (const target of targets) {
  const png = drawIcon(target.size, { maskable: target.maskable })
  writeFileSync(resolve(OUT, target.file), png)
  console.log(`  ${target.file}  ${(png.length / 1024).toFixed(1)} KB`)
}

// Apple no usa el manifest: necesita su propio icono opaco de 180 px.
writeFileSync(resolve(ROOT, 'public/apple-touch-icon.png'), drawIcon(180, { maskable: false }))
console.log('  apple-touch-icon.png')
