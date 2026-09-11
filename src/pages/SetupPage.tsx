import { AlertTriangle, Database, Timer } from 'lucide-react'
import { Panel } from '../components/ui'

/**
 * Pantalla de configuración incompleta.
 *
 * Aparece cuando no hay backend ni se ha pedido el modo demostración. Es
 * deliberadamente un muro: es preferible que nadie pueda entrar a que la
 * plantilla fiche contra un almacenamiento local que no prueba nada ante una
 * Inspección de Trabajo.
 */
export function SetupPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-brand-800 text-white">
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
              Defina estas dos variables de entorno y vuelva a desplegar
            </p>

            <pre className="mt-3 overflow-x-auto rounded-[4px] border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-slate-700">
{`VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
            </pre>

            <p className="mt-3 text-[12px] leading-relaxed text-slate-600">
              En Vercel: <span className="font-medium">Settings → Environment Variables</span>.
              Después hay que volver a desplegar para que el build las recoja.
            </p>

            <p className="mt-4 border-t border-slate-200 pt-4 text-[12px] leading-relaxed text-slate-500">
              Los pasos completos están en <code className="text-brand-800">docs/DESPLIEGUE.md</code>.
              Para ver la interfaz con datos de ejemplo, sin base de datos, compile
              con <code className="text-brand-800">VITE_DEMO=true</code>.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  )
}
