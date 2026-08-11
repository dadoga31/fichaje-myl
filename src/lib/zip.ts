/**
 * Escritor ZIP mínimo (método STORE, sin compresión).
 *
 * Un .xlsx no es más que un ZIP con XML dentro. Escribirlo a mano evita
 * arrastrar una librería de hojas de cálculo entera al bundle de una PWA que
 * debe cargar rápido en un móvil y funcionar sin conexión. Los informes son
 * texto: sin compresión ocupan algo más, pero siguen siendo de pocos KB.
 */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  path: string
  content: string
}

/** Uint8Array respaldado por un ArrayBuffer real, que es lo que acepta Blob. */
type ByteArray = Uint8Array<ArrayBuffer>

function bytes(length: number): ByteArray {
  return new Uint8Array(new ArrayBuffer(length)) as ByteArray
}

/** Fecha/hora en formato MS-DOS, el que exige la cabecera ZIP. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date:
      ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

export function createZip(entries: ZipEntry[], now: Date = new Date()): Blob {
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(now)

  const localParts: ByteArray[] = []
  const centralParts: ByteArray[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path) as ByteArray
    const dataBytes = encoder.encode(entry.content) as ByteArray
    const crc = crc32(dataBytes)

    // Cabecera local: 30 bytes fijos + nombre.
    const localBytes = bytes(30)
    const local = new DataView(localBytes.buffer)
    local.setUint32(0, 0x04034b50, true) // firma
    local.setUint16(4, 20, true) // versión mínima
    local.setUint16(6, 0x0800, true) // nombres en UTF-8
    local.setUint16(8, 0, true) // método: STORE
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, dataBytes.length, true)
    local.setUint32(22, dataBytes.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true) // sin campos extra

    localParts.push(localBytes, nameBytes, dataBytes)

    // Entrada del directorio central: 46 bytes fijos + nombre.
    const centralBytes = bytes(46)
    const central = new DataView(centralBytes.buffer)
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 0, true)
    central.setUint16(12, time, true)
    central.setUint16(14, date, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, dataBytes.length, true)
    central.setUint32(24, dataBytes.length, true)
    central.setUint16(28, nameBytes.length, true)
    central.setUint32(42, offset, true)

    centralParts.push(centralBytes, nameBytes)
    offset += 30 + nameBytes.length + dataBytes.length
  }

  const centralSize = centralParts.reduce((acc, part) => acc + part.length, 0)

  const endBytes = bytes(22)
  const end = new DataView(endBytes.buffer)
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...localParts, ...centralParts, endBytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Se libera en el siguiente ciclo para no cortar la descarga en Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
