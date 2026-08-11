/**
 * INFORME MENSUAL EN PDF
 *
 * Documento normalizado, listo para imprimir, entregar a la persona
 * trabajadora, a la RLT o a la Inspección de Trabajo. Incluye lo que el
 * Art. 34.9 ET y el criterio técnico de la ITSS esperan encontrar:
 * identificación de empresa y persona, día a día con horas de inicio y fin,
 * total mensual, desglose de ordinarias y extraordinarias, y constancia
 * expresa de las rectificaciones practicadas.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Company, DailySummary, Profile } from './types'
import { MONTHS_ES, formatDuration, toDecimalHours } from './time'

const BRAND: [number, number, number] = [107, 33, 168] // #6B21A8
const INK: [number, number, number] = [15, 23, 42]
const MUTED: [number, number, number] = [100, 116, 139]

export interface PersonReport {
  profile: Profile
  summaries: DailySummary[]
}

export interface MonthlyReportInput {
  company: Company
  people: PersonReport[]
  year: number
  month: number // 0-11
  generatedBy: string
}

function hhmm(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function timeOnly(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

export async function downloadMonthlyPdf(input: MonthlyReportInput): Promise<void> {
  const { company, people, year, month, generatedBy } = input
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const monthLabel = `${MONTHS_ES[month]} ${year}`

  people.forEach((person, index) => {
    if (index > 0) doc.addPage()

    // --- Cabecera -----------------------------------------------------
    doc.setFillColor(...BRAND)
    doc.rect(0, 0, pageWidth, 26, 'F')

    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('REGISTRO DE JORNADA LABORAL', 14, 11)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(
      'Artículo 34.9 del Estatuto de los Trabajadores · Real Decreto-ley 8/2019',
      14,
      17,
    )
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(monthLabel.toUpperCase(), pageWidth - 14, 13, { align: 'right' })

    // --- Identificación ------------------------------------------------
    doc.setTextColor(...INK)
    let y = 36

    const identity: Array<[string, string]> = [
      ['Empresa', `${company.name} · CIF ${company.cif}`],
      [
        'Persona trabajadora',
        `${person.profile.full_name}${person.profile.nif ? ` · NIF ${person.profile.nif}` : ''}`,
      ],
      [
        'Nº de empleado',
        `${person.profile.employee_number ?? '—'} · Jornada contratada: ${person.profile.contract_hours} h/semana`,
      ],
    ]

    doc.setFontSize(8)
    for (const [label, value] of identity) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...MUTED)
      doc.text(label.toUpperCase(), 14, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...INK)
      doc.setFontSize(9.5)
      doc.text(value, 52, y)
      doc.setFontSize(8)
      y += 6
    }

    // --- Totales -------------------------------------------------------
    const totalSeconds = person.summaries.reduce((acc, s) => acc + s.worked_seconds, 0)
    const totalBreaks = person.summaries.reduce((acc, s) => acc + s.break_seconds, 0)
    const daysWorked = person.summaries.filter((s) => s.worked_seconds > 0).length

    // Jornada de referencia del periodo: días efectivamente trabajados por la
    // jornada diaria media del contrato. El exceso se informa como
    // extraordinario a efectos del Art. 35 ET, sin prejuzgar su calificación
    // definitiva, que depende del convenio aplicable.
    const referenceSeconds = (person.profile.contract_hours / 5) * 3600 * daysWorked
    const ordinary = Math.min(totalSeconds, referenceSeconds)
    const overtime = Math.max(0, totalSeconds - referenceSeconds)

    y += 2
    const boxes: Array<[string, string]> = [
      ['Días con jornada', String(daysWorked)],
      ['Horas ordinarias', `${hhmm(ordinary)} (${toDecimalHours(ordinary)} h)`],
      ['Horas extraordinarias', `${hhmm(overtime)} (${toDecimalHours(overtime)} h)`],
      ['Total trabajado', `${hhmm(totalSeconds)} (${toDecimalHours(totalSeconds)} h)`],
    ]

    const boxWidth = (pageWidth - 28) / 4
    boxes.forEach(([label, value], i) => {
      const x = 14 + i * boxWidth
      doc.setDrawColor(226, 232, 240)
      doc.setFillColor(248, 250, 252)
      doc.rect(x, y, boxWidth - 2, 14, 'FD')
      doc.setFontSize(6.5)
      doc.setTextColor(...MUTED)
      doc.setFont('helvetica', 'bold')
      doc.text(label.toUpperCase(), x + 3, y + 5)
      doc.setFontSize(10)
      doc.setTextColor(...INK)
      doc.text(value, x + 3, y + 11)
    })
    y += 20

    // --- Detalle diario ------------------------------------------------
    const rows = person.summaries.map((s) => {
      const date = new Date(`${s.work_date}T12:00:00`)
      return [
        date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }),
        date.toLocaleDateString('es-ES', { weekday: 'short' }),
        timeOnly(s.first_in),
        timeOnly(s.last_out),
        s.break_seconds > 0 ? formatDuration(s.break_seconds) : '—',
        hhmm(s.worked_seconds),
        String(toDecimalHours(s.worked_seconds)).replace('.', ','),
        [s.has_corrections ? 'Rectificado' : '', s.is_open ? 'Sin cierre' : '']
          .filter(Boolean)
          .join(' · ') || '',
      ]
    })

    autoTable(doc, {
      startY: y,
      head: [['Fecha', 'Día', 'Entrada', 'Salida', 'Pausas', 'Jornada', 'Horas', 'Incidencias']],
      body: rows,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 1.8,
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        textColor: INK,
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: INK,
        fontStyle: 'bold',
        fontSize: 7.5,
      },
      columnStyles: {
        0: { cellWidth: 16 },
        1: { cellWidth: 12 },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 18, halign: 'center' },
        5: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
        6: { cellWidth: 16, halign: 'right' },
        7: { cellWidth: 'auto', textColor: MUTED, fontSize: 7 },
      },
      foot: [
        [
          { content: 'TOTAL DEL MES', colSpan: 4, styles: { halign: 'right' } },
          formatDuration(totalBreaks),
          hhmm(totalSeconds),
          String(toDecimalHours(totalSeconds)).replace('.', ','),
          '',
        ],
      ],
      footStyles: {
        fillColor: [243, 232, 255],
        textColor: [88, 28, 135],
        fontStyle: 'bold',
        fontSize: 8,
      },
      didDrawPage: () => {
        const h = doc.internal.pageSize.getHeight()
        doc.setFontSize(6.5)
        doc.setTextColor(...MUTED)
        doc.setFont('helvetica', 'normal')
        doc.text(
          `Documento generado el ${new Date().toLocaleString('es-ES')} por ${generatedBy}. ` +
            `Registro conservado ${company.retention_years} años a disposición de la persona trabajadora, ` +
            'la representación legal y la Inspección de Trabajo y Seguridad Social.',
          14,
          h - 12,
          { maxWidth: pageWidth - 28 },
        )
        doc.text(
          'Los fichajes son inalterables. Toda rectificación consta en el historial de auditoría con su motivo y autor.',
          14,
          h - 6,
          { maxWidth: pageWidth - 28 },
        )
      },
    })

    // --- Firmas ---------------------------------------------------------
    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y

    if (finalY < doc.internal.pageSize.getHeight() - 40) {
      const signY = finalY + 14
      doc.setDrawColor(148, 163, 184)
      doc.setLineWidth(0.2)
      doc.line(16, signY + 12, 86, signY + 12)
      doc.line(pageWidth - 86, signY + 12, pageWidth - 16, signY + 12)
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text('Firma de la persona trabajadora', 16, signY + 16)
      doc.text('Sello y firma de la empresa', pageWidth - 86, signY + 16)
    }
  })

  const suffix =
    people.length === 1
      ? people[0].profile.full_name.replace(/\s+/g, '-').toLowerCase()
      : 'plantilla'

  doc.save(`registro-jornada_${year}-${String(month + 1).padStart(2, '0')}_${suffix}.pdf`)
}
