import { AlertTriangle, Check, Database, Timer, X } from 'lucide-react'
import { Panel } from '../components/ui'
import { UpdatePrompt } from '../components/UpdatePrompt'
import { buildTime, configStatus } from '../lib/firebase'

/** Recorta valores largos: identifican el proyecto sin llenar la pantalla. */
function resumir(valor: string): string {
  return valor.length > 28 ? `${valor.slice(0, 12)}…${valor.slice(-8)}` : valor
}

/** Fecha de compilación legible; si algo va mal, no rompe la pantalla. */
function compiladoEl(): string | null {
  try {
    return new Date(buildTime).toLocaleString('es-ES', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return null
  }
}

/**
 * Pantalla de configuración incompleta.
 *
 * Aparece cuando no hay backend ni se ha pedido el modo demostración. Es
 * deliberadamente un muro: es preferible que nadie pueda entrar a que la
 * plantilla fiche contra un almacenamiento local que no prueba nada ante una
 * Inspección de Trabajo.
 *
 * Pero un muro que solo repite la lista de variables no ayuda a salir de él:
 * quien ya las ha definido en Vercel y sigue viendo esto no sabe si le falta
 * reconstruir, si se equivocó al escribir un nombre, o si su móvil está
 * mostrando una versión cacheada. Por eso aquí se dice exactamente qué llegó
 * a esta compilación y cuándo se hizo.
 */
export function SetupPage() {
  const faltan = configStatus.filter((v) => !v.value)
  const ninguna = faltan.length === configStatus.length
  const fecha = compiladoEl()

  return (
    <div className="flex min-h-dvh flex-col">
      <UpdatePrompt />

      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-lg">
          <div className="mb-6 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-violet-800 text-white">
              <Timer size={18} strokeWidth={2.4} />
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-900">
              Fichaje MyL
            </span>
          </div>

          <Panel className="overflow-hidden">
            <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-5 py-4">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
              <div>
                <h1 className="text-[15px] font-semibold text-amber-900">
                  Falta conectar la base de datos
                </h1>
                <p className="mt-1 text-[13px] leading-relaxed text-amber-800">
                  La aplicación no arranca sin backend. No se permite fichar contra
                  el navegador: un registro de jornada que vive en el móvil de cada
                  persona no prueba nada ante una Inspección de Trabajo.
                </p>
              </div>
            </div>

            <div className="px-5 py-5">
              <p className="flex items-center gap-2 text-[13px] font-medium text-slate-900">
                <Database size={15} className="text-slate-400" />
                Lo que recibió esta compilación
              </p>

              <ul className="mt-3 divide-y divide-slate-200 rounded-[4px] border border-slate-200">
                {configStatus.map(({ key, value }) => (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {value ? (
                        <Check size={13} className="shrink-0 text-emerald-600" />
                      ) : (
                        <X size={13} className="shrink-0 text-rose-500" />
                      )}
                      <code className="truncate font-mono text-[11.5px] text-slate-700">
                        {key}
                      </code>
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[11.5px] ${
                        value ? 'text-slate-500' : 'font-sans text-rose-600'
                      }`}
                    >
                      {value ? resumir(value) : 'sin definir'}
                    </span>
                  </li>
                ))}
              </ul>

              {ninguna ? (
                <p className="mt-3 text-[12px] leading-relaxed text-slate-600">
                  No llegó <span className="font-medium">ninguna</span> variable. Casi
                  siempre significa que se definieron en Vercel pero{' '}
                  <span className="font-medium">no se ha vuelto a compilar</span>: Vite
                  las incrusta durante el build, así que guardarlas no basta. Lance un{' '}
                  <span className="font-medium">Redeploy</span> sin caché de
                  compilación, y compruebe que están marcadas para el entorno{' '}
                  <span className="font-medium">Production</span>.
                </p>
              ) : (
                <p className="mt-3 text-[12px] leading-relaxed text-slate-600">
                  Faltan {faltan.length} de {configStatus.length}. Revise que el nombre
                  coincida carácter a carácter —mayúsculas y guiones bajos incluidos— y
                  que no haya espacios sobrantes en el valor.
                </p>
              )}

              {fecha && (
                <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
                  Esta versión se compiló el{' '}
                  <span className="font-medium text-slate-600">{fecha}</span>. Si es
                  anterior al momento en que definió las variables, está viendo una
                  compilación antigua: vuelva a desplegar, y en el móvil cierre la
                  aplicación por completo antes de reabrirla.
                </p>
              )}

              <p className="mt-4 border-t border-slate-200 pt-4 text-[12px] leading-relaxed text-slate-500">
                Los pasos completos están en{' '}
                <code className="text-violet-800">docs/DESPLIEGUE.md</code>. Para ver la
                interfaz con datos de ejemplo, sin base de datos, compile con{' '}
                <code className="text-violet-800">VITE_DEMO=true</code>.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
