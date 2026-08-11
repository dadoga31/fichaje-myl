/**
 * INFORME MENSUAL EN EXCEL (.xlsx nativo)
 *
 * Una hoja "Resumen" con el total por persona y una hoja de detalle diario por
 * cada trabajador. Se genera en el propio dispositivo, sin enviar datos de
 * jornada a ningún servicio externo (principio de minimización, RGPD).
 */
import type { Company, DailySummary, Profile } from './types'
import { MONTHS_ES, toDecimalHours } from './time'
import { createZip, downloadBlob, escapeXml, type ZipEntry } from './zip'

export interface PersonSheet {
  profile: Profile
  summaries: DailySummary[]
}

type CellValue = string | number | null

interface Sheet {
  name: string
  rows: Array<{ cells: CellValue[]; style?: 'title' | 'header' | 'total' }>
  colWidths: number[]
}

/** Estilos: 0 normal, 1 título, 2 cabecera, 3 total, 4 número con 2 decimales. */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF6B21A8"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF581C87"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF6B21A8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3E8FF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFE2E8F0"/></left><right style="thin"><color rgb="FFE2E8F0"/></right><top style="thin"><color rgb="FFE2E8F0"/></top><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function columnName(index: number): string {
  let name = ''
  let n = index
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

function sheetXml(sheet: Sheet): string {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const styleId =
        row.style === 'title' ? 1 : row.style === 'header' ? 2 : row.style === 'total' ? 3 : 0

      const cells = row.cells
        .map((value, colIndex) => {
          if (value === null || value === '') return ''
          const ref = `${columnName(colIndex)}${rowIndex + 1}`
          if (typeof value === 'number') {
            const s = styleId !== 0 ? styleId : Number.isInteger(value) ? 0 : 4
            return `<c r="${ref}" s="${s}"><v>${value}</v></c>`
          }
          return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
        })
        .join('')

      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')

  const cols = sheet.colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${cols}</cols>
<sheetData>${rows}</sheetData>
</worksheet>`
}

/** Excel prohíbe : \\ / ? * [ ] en los nombres de hoja y los limita a 31 caracteres. */
function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Hoja'
  let candidate = base
  let n = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${n++}`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function buildWorkbook(sheets: Sheet[]): Blob {
  const sheetEntries: ZipEntry[] = sheets.map((sheet, i) => ({
    path: `xl/worksheets/sheet${i + 1}.xml`,
    content: sheetXml(sheet),
  }))

  const workbookSheets = sheets
    .map(
      (sheet, i) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('')

  const workbookRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')

  return createZip([
    {
      path: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides}
</Types>`,
    },
    {
      path: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      path: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${workbookSheets}</sheets>
</workbook>`,
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${workbookRels}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { path: 'xl/styles.xml', content: STYLES_XML },
    ...sheetEntries,
  ])
}

export interface ExcelReportInput {
  company: Company
  people: PersonSheet[]
  year: number
  month: number
  generatedBy: string
}

export function downloadMonthlyExcel(input: ExcelReportInput): void {
  const { company, people, year, month, generatedBy } = input
  const monthLabel = `${MONTHS_ES[month]} ${year}`
  const used = new Set<string>()

  // --- Hoja de resumen -------------------------------------------------
  const summary: Sheet = {
    name: safeSheetName('Resumen', used),
    colWidths: [30, 14, 14, 14, 16, 18, 16],
    rows: [
      { cells: [`Registro de jornada · ${monthLabel}`], style: 'title' },
      { cells: [`${company.name} — CIF ${company.cif}`] },
      { cells: [`Generado el ${new Date().toLocaleString('es-ES')} por ${generatedBy}`] },
      { cells: [] },
      {
        cells: [
          'Persona trabajadora',
          'Nº empleado',
          'NIF',
          'Contrato (h/sem)',
          'Días con jornada',
          'Horas ordinarias',
          'Horas extra',
          'Total horas',
        ],
        style: 'header',
      },
    ],
  }

  for (const person of people) {
    const total = person.summaries.reduce((acc, s) => acc + s.worked_seconds, 0)
    const days = person.summaries.filter((s) => s.worked_seconds > 0).length
    const reference = (person.profile.contract_hours / 5) * 3600 * days
    const ordinary = Math.min(total, reference)
    const overtime = Math.max(0, total - reference)

    summary.rows.push({
      cells: [
        person.profile.full_name,
        person.profile.employee_number ?? '',
        person.profile.nif ?? '',
        person.profile.contract_hours,
        days,
        toDecimalHours(ordinary),
        toDecimalHours(overtime),
        toDecimalHours(total),
      ],
    })
  }

  const grandTotal = people.reduce(
    (acc, p) => acc + p.summaries.reduce((a, s) => a + s.worked_seconds, 0),
    0,
  )
  summary.rows.push({
    cells: ['TOTAL', '', '', '', '', '', '', toDecimalHours(grandTotal)],
    style: 'total',
  })

  // --- Una hoja de detalle por persona ---------------------------------
  const detailSheets: Sheet[] = people.map((person) => {
    const rows: Sheet['rows'] = [
      { cells: [person.profile.full_name], style: 'title' },
      { cells: [`${monthLabel} · Jornada contratada: ${person.profile.contract_hours} h/semana`] },
      { cells: [] },
      {
        cells: [
          'Fecha',
          'Día',
          'Entrada',
          'Salida',
          'Pausas (h)',
          'Trabajado (h)',
          'Incidencias',
        ],
        style: 'header',
      },
    ]

    for (const s of person.summaries) {
      const date = new Date(`${s.work_date}T12:00:00`)
      rows.push({
        cells: [
          s.work_date,
          date.toLocaleDateString('es-ES', { weekday: 'long' }),
          s.first_in
            ? new Date(s.first_in).toLocaleTimeString('es-ES', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—',
          s.last_out
            ? new Date(s.last_out).toLocaleTimeString('es-ES', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—',
          toDecimalHours(s.break_seconds),
          toDecimalHours(s.worked_seconds),
          [s.has_corrections ? 'Rectificado' : '', s.is_open ? 'Sin cierre' : '']
            .filter(Boolean)
            .join(' · '),
        ],
      })
    }

    const total = person.summaries.reduce((acc, s) => acc + s.worked_seconds, 0)
    rows.push({
      cells: ['TOTAL', '', '', '', '', toDecimalHours(total), ''],
      style: 'total',
    })

    return {
      name: safeSheetName(person.profile.full_name, used),
      colWidths: [14, 14, 12, 12, 14, 16, 26],
      rows,
    }
  })

  const suffix =
    people.length === 1
      ? people[0].profile.full_name.replace(/\s+/g, '-').toLowerCase()
      : 'plantilla'

  downloadBlob(
    buildWorkbook([summary, ...detailSheets]),
    `registro-jornada_${year}-${String(month + 1).padStart(2, '0')}_${suffix}.xlsx`,
  )
}
