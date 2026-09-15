import { useEffect, useState, type FormEvent } from 'react'
import { Building2, Database, KeyRound, MapPin, RotateCcw, ShieldCheck, Smartphone } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { PageHeader } from '../components/Layout'
import {
  Badge,
  Button,
  Field,
  MicroLabel,
  Notice,
  Panel,
  PanelHeader,
  Tabs,
  cx,
  inputClass,
} from '../components/ui'
import { changePassword, updateGeoConsent } from '../lib/api'
import { resetDemo } from '../lib/demo'
import { ROLE_LABEL } from '../lib/types'

export function SettingsPage() {
  const { session, refresh, isDemo } = useSession()
  const profile = session!.profile
  const company = session!.company

  const [busy, setBusy] = useState(false)
  const [installEvent, setInstallEvent] = useState<Event | null>(null)
  const [tab, setTab] = useState<'cuenta' | 'privacidad' | 'app'>('cuenta')

  // Cambio de contraseña. Hasta ahora la aplicación repartía contraseñas
  // provisionales y no ofrecía ninguna forma de cambiarlas, lo que obligaba a
  // hacerlo desde la consola del servidor: inservible para una plantilla.
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [avisoClave, setAvisoClave] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null)
  const [cambiando, setCambiando] = useState(false)

  async function enviarCambio(evento: FormEvent) {
    evento.preventDefault()
    if (nueva !== repetida) {
      setAvisoClave({ tono: 'error', texto: 'Las dos contraseñas nuevas no coinciden.' })
      return
    }
    setCambiando(true)
    setAvisoClave(null)
    try {
      await changePassword(actual, nueva)
      setActual('')
      setNueva('')
      setRepetida('')
      setAvisoClave({
        tono: 'ok',
        texto: 'Contraseña cambiada. Se han cerrado sus sesiones en otros dispositivos.',
      })
    } catch (error) {
      setAvisoClave({
        tono: 'error',
        texto: error instanceof Error ? error.message : 'No se ha podido cambiar.',
      })
    } finally {
      setCambiando(false)
    }
  }

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
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Ajustes y privacidad"
        description="Su cuenta, la configuración de su empresa y el tratamiento de sus datos de jornada."
      />

      <Tabs
        tabs={[
          { id: 'cuenta' as const, label: 'Cuenta y empresa' },
          { id: 'privacidad' as const, label: 'Privacidad' },
          { id: 'app' as const, label: 'Aplicación' },
        ]}
        active={tab}
        onChange={setTab}
        className="surface mb-2.5 rounded-[10px] border-b-0"
      />

      <div
        className={cx(
          'grid min-h-0 flex-1 content-start gap-3 overflow-y-auto lg:grid-cols-2',
          tab !== 'cuenta' && 'hidden',
        )}
      >
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

        {/* --- Contraseña -------------------------------------------------- */}
        {!isDemo && (
          <Panel className="h-fit">
            <PanelHeader title="Su contraseña" />
            <form onSubmit={(e) => void enviarCambio(e)} className="flex flex-col gap-2.5 px-4 py-3">
              <Field label="Contraseña actual" htmlFor="clave-actual">
                <input
                  id="clave-actual"
                  type="password"
                  autoComplete="current-password"
                  className={inputClass}
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                />
              </Field>
              <Field
                label="Contraseña nueva"
                htmlFor="clave-nueva"
                hint="Mínimo 10 caracteres."
                required
              >
                <input
                  id="clave-nueva"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  className={inputClass}
                  value={nueva}
                  onChange={(e) => setNueva(e.target.value)}
                />
              </Field>
              <Field label="Repita la nueva" htmlFor="clave-repetida" required>
                <input
                  id="clave-repetida"
                  type="password"
                  autoComplete="new-password"
                  required
                  className={inputClass}
                  value={repetida}
                  onChange={(e) => setRepetida(e.target.value)}
                />
              </Field>

              {avisoClave && (
                <Notice tone={avisoClave.tono === 'ok' ? 'ok' : 'error'}>{avisoClave.texto}</Notice>
              )}

              <Button type="submit" variant="primary" size="sm" disabled={cambiando}>
                <KeyRound size={14} />
                {cambiando ? 'Cambiando…' : 'Cambiar contraseña'}
              </Button>
            </form>
          </Panel>
        )}
      </div>

      <div
        className={cx(
          'grid min-h-0 flex-1 content-start gap-3 overflow-y-auto lg:grid-cols-2',
          tab !== 'privacidad' && 'hidden',
        )}
      >
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
                      ? 'border-violet-200 bg-violet-50'
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
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-violet-700" />
              Sus fichajes son inalterables: nadie, tampoco la administración de su
              empresa, puede modificarlos ni borrarlos. Toda rectificación queda
              documentada con su motivo y su autor, y usted puede consultarla en su
              historial.
            </p>
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
              <Database size={15} className="mt-0.5 shrink-0 text-violet-700" />
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

      </div>

      <div
        className={cx(
          'grid min-h-0 flex-1 content-start gap-3 overflow-y-auto',
          tab !== 'app' && 'hidden',
        )}
      >
        {/* --- Aplicación --------------------------------------------------- */}
        <Panel className="h-fit">
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
                garantizan las reglas de seguridad de Firestore, que se evalúan en el
                servidor: el cliente nunca es la garantía.
              </Notice>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
