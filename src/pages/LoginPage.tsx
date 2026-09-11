import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Fingerprint, ShieldCheck, Timer } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { demoApi } from '../lib/demo'
import { ROLE_LABEL, type Profile } from '../lib/types'
import { Aurora, Button, Field, Notice, cx, inputClass } from '../components/ui'

/**
 * ACCESO
 *
 * Primera impresión de la aplicación: aquí se decide si parece un producto
 * cuidado o una herramienta interna. La composición es asimétrica a
 * propósito —el argumento a la izquierda, la acción a la derecha— para huir
 * del bloque centrado de siempre.
 */
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
    <div className="relative min-h-dvh">
      <Aurora status="off" />

      <div className="mx-auto grid min-h-dvh max-w-6xl items-center gap-8 px-5 py-10 lg:grid-cols-[1.05fr_minmax(0,26rem)] lg:gap-16 lg:px-8">
        {/* --- Argumento ------------------------------------------------- */}
        <section className="rise">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-[linear-gradient(140deg,var(--color-violet-500),var(--color-violet-700))] text-white shadow-[0_8px_22px_-6px_rgb(124_58_237/0.6)]">
              <Timer size={20} strokeWidth={2.5} />
            </span>
            <span className="font-display text-[17px] font-bold tracking-tight text-ink">
              Fichaje
            </span>
          </div>

          <h1 className="mt-8 font-display text-[clamp(2.4rem,7vw,4rem)] leading-[0.98] font-bold tracking-[-0.045em] text-ink">
            Fichar deja de
            <br />
            ser un
            {/* El degradado recae en UNA palabra: subrayar todo no subraya nada. */}
            <span className="bg-[linear-gradient(110deg,var(--color-violet-700),var(--color-violet-400))] bg-clip-text text-transparent">
              {' '}
              trámite
            </span>
            .
          </h1>

          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
            Un gesto y listo. Por detrás, cada fichaje queda sellado en un libro
            que nadie puede modificar ni borrar — ni siquiera quien administra.
          </p>

          <dl
            className="rise mt-8 grid max-w-lg grid-cols-3 gap-2 sm:gap-2.5"
            style={{ animationDelay: '140ms' }}
          >
            {[
              { k: '4 años', v: 'de conservación garantizada' },
              { k: 'SHA-256', v: 'sella cada asiento' },
              { k: 'Art. 34.9', v: 'del Estatuto de los Trabajadores' },
            ].map((item) => (
              <div key={item.k} className="glass rounded-[14px] px-3 py-2.5 sm:px-3.5 sm:py-3">
                <dt className="font-display text-[14px] font-bold tracking-tight text-violet-800 sm:text-[17px]">
                  {item.k}
                </dt>
                <dd className="mt-1 text-[10px] leading-snug text-ink-soft sm:text-[11px]">
                  {item.v}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 hidden text-[11px] text-ink-faint lg:block">
            Conforme al Real Decreto-ley 8/2019 y al Reglamento (UE) 2016/679.
          </p>
        </section>

        {/* --- Acceso ------------------------------------------------------ */}
        <section className="rise" style={{ animationDelay: '90ms' }}>
          <div className="glass-strong rounded-[24px] p-5 sm:p-6">
            {isDemo ? (
              <>
                <div className="flex items-center gap-2">
                  <Fingerprint size={16} className="text-violet-500" />
                  <h2 className="font-display text-[17px] font-bold tracking-tight text-ink">
                    Elige un perfil
                  </h2>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                  Demostración con datos de ejemplo. Cada perfil ve la aplicación
                  desde su rol.
                </p>

                <ul className="mt-5 flex flex-col gap-2">
                  {demoUsers.map((user, i) => (
                    <li key={user.id} className="rise" style={{ animationDelay: `${140 + i * 45}ms` }}>
                      <button
                        type="button"
                        onClick={() => void enterDemo(user.id)}
                        className={cx(
                          'group flex w-full items-center gap-3 rounded-[14px] border border-white/70 bg-white/60 px-3.5 py-3 text-left',
                          'backdrop-blur-md transition-all duration-200 ease-[var(--ease-out-soft)]',
                          'hover:-translate-y-px hover:border-violet-300/60 hover:bg-white',
                          'hover:shadow-[0_10px_26px_-10px_rgb(124_58_237/0.45)]',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600',
                        )}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-violet-100 text-[12px] font-bold text-violet-700 transition-colors group-hover:bg-[linear-gradient(140deg,var(--color-violet-500),var(--color-violet-700))] group-hover:text-white">
                          {user.full_name
                            .split(' ')
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join('')}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold text-ink">
                            {user.full_name}
                          </span>
                          <span className="block truncate text-[11px] text-ink-soft">
                            {ROLE_LABEL[user.role]}
                          </span>
                        </span>
                        <ArrowRight
                          size={15}
                          className="shrink-0 text-ink-faint transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-violet-600"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h2 className="font-display text-[19px] font-bold tracking-tight text-ink">
                  Accede a tu cuenta
                </h2>
                <p className="mt-1.5 text-[13px] text-ink-soft">
                  Con el correo que te facilitó tu empresa.
                </p>

                <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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

                  <Button type="submit" variant="primary" disabled={busy} className="h-12 text-[15px]">
                    {busy ? 'Comprobando…' : 'Entrar'}
                  </Button>
                </form>
              </>
            )}

            <p className="mt-5 flex items-start gap-2 border-t border-[color:var(--color-hairline)] pt-4 text-[11px] leading-relaxed text-ink-soft">
              <ShieldCheck size={13} className="mt-px shrink-0 text-violet-400" />
              Tus fichajes solo los ve tu empresa. Ningún registro puede alterarse
              ni eliminarse.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
