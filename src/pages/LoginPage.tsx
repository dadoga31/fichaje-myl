import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, ShieldCheck, Timer } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { demoApi } from '../lib/demo'
import { ROLE_LABEL, type Profile } from '../lib/types'
import { Button, Field, Notice, Panel, inputClass } from '../components/ui'

export function LoginPage() {
  const { signIn, enterDemo, isDemo } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [demoUsers, setDemoUsers] = useState<Profile[]>([])

  useEffect(() => {
    if (isDemo) setDemoUsers(demoApi.listDemoUsers())
  }, [isDemo])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido iniciar sesión.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* --- Panel de marca (solo escritorio) ---------------------------- */}
      <aside className="grid-backdrop relative hidden flex-col justify-between border-r border-slate-200 bg-white p-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-brand-800 text-white">
            <Timer size={18} strokeWidth={2.4} />
          </span>
          <span className="text-sm font-semibold tracking-tight text-slate-900">Fichaje MyL</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-slate-900">
            El registro de jornada,
            <br />
            <span className="text-brand-800">exacto y a prueba de dudas.</span>
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-600">
            Cada fichaje queda sellado en un libro de asientos que no admite
            modificación ni borrado. Las correcciones no sobrescriben nada: se
            registran aparte, con su motivo y su autor.
          </p>

          <dl className="mt-8 grid gap-px overflow-hidden rounded-[6px] border border-slate-200 bg-slate-200 sm:grid-cols-3">
            {[
              { k: '4 años', v: 'de conservación garantizada' },
              { k: 'SHA-256', v: 'sellado de cada asiento' },
              { k: 'Art. 34.9', v: 'Estatuto de los Trabajadores' },
            ].map((item) => (
              <div key={item.k} className="bg-white px-3.5 py-3">
                <dt className="text-[15px] font-semibold tracking-tight text-slate-900">
                  {item.k}
                </dt>
                <dd className="mt-0.5 text-[11px] leading-snug text-slate-500">{item.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-[11px] text-slate-400">
          Conforme al Real Decreto-ley 8/2019 y al Reglamento (UE) 2016/679.
        </p>
      </aside>

      {/* --- Acceso ------------------------------------------------------- */}
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-7 lg:hidden">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] bg-brand-800 text-white">
              <Timer size={20} strokeWidth={2.4} />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
              Fichaje MyL
            </h1>
            <p className="mt-1 text-[13px] text-slate-600">Registro de jornada laboral</p>
          </div>

          {isDemo ? (
            <>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                Modo de demostración
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
                No hay credenciales de Supabase configuradas, así que la aplicación
                funciona con datos ficticios en este dispositivo. Elija con qué perfil
                desea entrar.
              </p>

              <ul className="mt-5 flex flex-col gap-1.5">
                {demoUsers.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => void enterDemo(user.id)}
                      className="group flex w-full items-center justify-between gap-3 rounded-[4px] border border-slate-200 bg-white px-3.5 py-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-slate-900">
                          {user.full_name}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {ROLE_LABEL[user.role]}
                          {user.employee_number ? ` · ${user.employee_number}` : ''}
                        </span>
                      </span>
                      <ArrowRight
                        size={15}
                        className="shrink-0 text-slate-300 transition-colors group-hover:text-brand-700"
                      />
                    </button>
                  </li>
                ))}
              </ul>

              <p className="mt-5 text-[11px] leading-relaxed text-slate-500">
                Los datos de demostración se guardan solo en este navegador. Para un
                despliegue real, configure <code className="text-brand-800">VITE_SUPABASE_URL</code>{' '}
                y <code className="text-brand-800">VITE_SUPABASE_ANON_KEY</code>.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                Acceda a su cuenta
              </h2>
              <p className="mt-1.5 text-[13px] text-slate-600">
                Use el correo corporativo que le facilitó su empresa.
              </p>

              <Panel className="mt-6 p-5">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <Field label="Correo electrónico" htmlFor="email" required>
                    <input
                      id="email"
                      type="email"
                      autoComplete="username"
                      required
                      className={inputClass}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nombre@empresa.es"
                    />
                  </Field>

                  <Field label="Contraseña" htmlFor="password" required>
                    <input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      className={inputClass}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>

                  {error && <Notice tone="error">{error}</Notice>}

                  <Button type="submit" variant="primary" disabled={busy}>
                    {busy ? 'Comprobando…' : 'Entrar'}
                  </Button>
                </form>
              </Panel>
            </>
          )}

          <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
            <ShieldCheck size={14} className="mt-px shrink-0 text-slate-400" />
            Sus fichajes solo son visibles para usted y para el personal autorizado de su
            empresa. Ningún registro puede ser alterado ni eliminado.
          </p>
        </div>
      </div>
    </div>
  )
}
