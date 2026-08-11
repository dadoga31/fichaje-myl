import { useEffect, useState } from 'react'
import { Building2, Database, MapPin, RotateCcw, ShieldCheck, Smartphone } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { PageHeader } from '../components/Layout'
import { Badge, Button, MicroLabel, Notice, Panel, PanelHeader, cx } from '../components/ui'
import { updateGeoConsent } from '../lib/api'
import { resetDemo } from '../lib/demo'
import { ROLE_LABEL } from '../lib/types'

export function SettingsPage() {
  const { session, refresh, isDemo } = useSession()
  const profile = session!.profile
  const company = session!.company

  const [busy, setBusy] = useState(false)
  const [installEvent, setInstallEvent] = useState<Event | null>(null)

  // La instalación solo puede ofrecerse cuando el navegador lanza el evento;
  // en iOS no existe y se instala desde «Compartir → Añadir a inicio».
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function toggleGeoConsent() {
    setBusy(true)
    try {
      await updateGeoConsent(profile.id, !profile.geo_consent)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Ajustes y privacidad"
        description="Su cuenta, la configuración de su empresa y el tratamiento de sus datos de jornada."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- Cuenta ---------------------------------------------------- */}
        <Panel className="h-fit">
          <PanelHeader title="Su cuenta" />
          <dl className="divide-y divide-slate-100">
            {[
              ['Nombre', profile.full_name],
              ['Correo', profile.email ?? '—'],
              ['Perfil', ROLE_LABEL[profile.role]],
              ['Nº de empleado', profile.employee_number ?? '—'],
              ['Jornada contratada', `${profile.contract_hours} h/semana`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-[13px] text-slate-500">{label}</dt>
                <dd className="text-[13px] font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        {/* --- Empresa --------------------------------------------------- */}
        <Panel className="h-fit">
          <PanelHeader title="Su empresa" />
          <dl className="divide-y divide-slate-100">
            {[
              ['Razón social', company.name],
              ['CIF', company.cif],
              ['Huso horario', company.timezone],
              ['Jornada de referencia', `${company.weekly_hours} h/semana`],
              ['Conservación de registros', `${company.retention_years} años`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-[13px] text-slate-500">{label}</dt>
                <dd className="text-[13px] font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-slate-200 px-4 py-3">
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
              <Building2 size={13} className="mt-px shrink-0 text-slate-400" />
              Estos parámetros los fija la administración de su empresa. La conservación
              no puede configurarse por debajo de los 4 años que exige el Art. 34.9 ET.
            </p>
          </div>
        </Panel>

        {/* --- Geolocalización -------------------------------------------- */}
        <Panel className="h-fit">
          <PanelHeader
            title="Geolocalización"
            action={
              <Badge tone={company.geolocation_policy === 'disabled' ? 'neutral' : 'brand'}>
                {company.geolocation_policy === 'disabled'
                  ? 'Desactivada'
                  : company.geolocation_policy === 'optional'
                    ? 'Opcional'
                    : 'Exigida'}
              </Badge>
            }
          />
          <div className="px-4 py-4">
            {company.geolocation_policy === 'disabled' ? (
              <p className="text-[13px] leading-relaxed text-slate-600">
                Su empresa no registra la ubicación al fichar. No se recoge ningún dato de
                localización, ni siquiera si su dispositivo lo permite.
              </p>
            ) : (
              <>
                {company.geolocation_notice && (
                  <div className="mb-3 rounded-[4px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <MicroLabel>Aviso de su empresa</MicroLabel>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-slate-700">
                      {company.geolocation_notice}
                    </p>
                  </div>
                )}

                <div
                  className={cx(
                    'flex items-start justify-between gap-4 rounded-[4px] border px-3 py-3',
                    profile.geo_consent
                      ? 'border-brand-200 bg-brand-50'
                      : 'border-slate-200 bg-white',
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-slate-900">
                      <MapPin size={14} />
                      {profile.geo_consent
                        ? 'Ha autorizado el registro de su ubicación'
                        : 'No ha autorizado el registro de su ubicación'}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                      Solo se guardan las coordenadas del instante del fichaje, nunca un
                      seguimiento continuo. Puede retirar su consentimiento cuando quiera
                      {company.geolocation_policy === 'optional' && ' y seguir fichando con normalidad'}.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={profile.geo_consent ? 'secondary' : 'primary'}
                    disabled={busy}
                    onClick={() => void toggleGeoConsent()}
                  >
                    {profile.geo_consent ? 'Retirar' : 'Autorizar'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Panel>

        {/* --- Sus derechos ------------------------------------------------ */}
        <Panel className="h-fit">
          <PanelHeader title="Sus datos y sus derechos" />
          <div className="flex flex-col gap-3 px-4 py-4">
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-700" />
              Sus fichajes son inalterables: nadie, tampoco la administración de su
              empresa, puede modificarlos ni borrarlos. Toda rectificación queda
              documentada con su motivo y su autor, y usted puede consultarla en su
              historial.
            </p>
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              <Database size={15} className="mt-0.5 shrink-0 text-brand-700" />
              El registro se conserva {company.retention_years} años a disposición de usted,
              de la representación legal de la plantilla y de la Inspección de Trabajo.
              Puede descargar su resumen mensual desde «Mi historial».
            </p>
            <p className="text-[11px] leading-relaxed text-slate-500">
              Para ejercer sus derechos de acceso, rectificación, supresión, limitación,
              portabilidad u oposición (arts. 15 a 22 del RGPD), diríjase a la
              administración de {company.name}. La supresión de los fichajes no procede
              mientras dure el plazo legal de conservación.
            </p>
          </div>
        </Panel>

        {/* --- Aplicación --------------------------------------------------- */}
        <Panel className="h-fit lg:col-span-2">
          <PanelHeader title="Aplicación" />
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            {installEvent && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  ;(installEvent as unknown as { prompt: () => void }).prompt()
                  setInstallEvent(null)
                }}
              >
                <Smartphone size={14} />
                Instalar en este dispositivo
              </Button>
            )}

            {isDemo && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  resetDemo()
                  window.location.reload()
                }}
              >
                <RotateCcw size={14} />
                Reiniciar datos de demostración
              </Button>
            )}

            <p className="text-[11px] text-slate-500">
              Instale la aplicación para fichar desde la pantalla de inicio, incluso sin
              cobertura: los fichajes se guardan y se envían al recuperar la conexión.
            </p>
          </div>

          {isDemo && (
            <div className="border-t border-slate-200 px-4 py-3">
              <Notice tone="warn">
                Está en modo de demostración con datos ficticios almacenados en este
                navegador. En un despliegue real, la inalterabilidad del registro la
                garantiza PostgreSQL, no el cliente.
              </Notice>
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
