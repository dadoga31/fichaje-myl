import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Fingerprint, ShieldCheck, Timer } from 'lucide-react'
import { useSession } from '../context/SessionContext'
import { demoApi } from '../lib/demo'
import { ROLE_LABEL, type Profile } from '../lib/types'
import { AppBackground, Button, Field, Notice, cx, inputClass } from '../components/ui'

/**
 * ACCESO
 *
 * Primera impresión del producto. La versión anterior tiraba de recursos de
 * página de aterrizaje —titular enorme con una palabra en degradado, tarjetas
 * de cristal, sombras de colores— que en una herramienta de cumplimiento
 * normativo trabajan en contra: quien la compra necesita confiar en ella, y la
 * confianza no se transmite con efectos.
 *
 * Aquí el argumento es sobrio y las cifras son datos, no adornos.
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
      <AppBackground />

      <div className="mx-auto grid min-h-dvh max-w-5xl items-center gap-8 px-5 py-8 lg:grid-cols-[1fr_minmax(0,23rem)] lg:gap-14 lg:px-8">
        {/* --- Argumento --------------------------------------------------- */}
        <section className="rise">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-violet-700 text-white">
              <Timer size={17} strokeWidth={2.4} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">Fichaje</span>
          </div>

          <h1 className="mt-7 text-[clamp(1.9rem,5vw,2.9rem)] leading-[1.06] font-semibold tracking-[-0.03em] text-ink">
            El registro de jornada
            <br />
            que resiste una inspección.
          </h1>

          <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-ink-soft">
            Fichar es un gesto. Por detrás, cada marca queda sellada por el servidor
            en un libro que nadie puede modificar ni borrar — tampoco quien
            administra.
          </p>

          {/* Cifras como datos, en una fila con separadores. Sin tarjetas:
              tres cajas para tres palabras era envoltorio sobre envoltorio. */}
          <dl className="mt-7 flex max-w-lg flex-wrap items-center gap-x-6 gap-y-3">
            {[
              { k: '4 años', v: 'de conservación' },
              { k: 'Inalterable', v: 'ni se edita ni se borra' },
              { k: 'Art. 34.9', v: 'Estatuto de los Trabajadores' },
            ].map((item) => (
              <div key={item.k}>
                <dt className="text-[15px] font-semibold tracking-tight text-violet-800">
                  {item.k}
                </dt>
                <dd className="mt-0.5 text-[11.5px] text-ink-soft">{item.v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-7 hidden text-[11px] text-ink-faint lg:block">
            Conforme al Real Decreto-ley 8/2019 y al Reglamento (UE) 2016/679.
          </p>
        </section>

        {/* --- Acceso -------------------------------------------------------- */}
        <section className="rise" style={{ animationDelay: '60ms' }}>
          <div className="surface rounded-[12px] p-5">
            {isDemo ? (
              <>
                <div className="flex items-center gap-2">
                  <Fingerprint size={15} className="text-violet-600" />
                  <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                    Elige un perfil
                  </h2>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
                  Demostración con datos de ejemplo. Cada perfil ve la aplicación
                  desde su rol.
                </p>

                <ul className="mt-4 flex flex-col gap-1.5">
                  {demoUsers.map((user) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        onClick={() => void enterDemo(user.id)}
                        className={cx(
                          'group flex w-full items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-left',
                          'border-[color:var(--color-hairline)] bg-surface transition-colors duration-150',
                          'hover:border-violet-300 hover:bg-violet-50',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600',
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-violet-100 text-[11.5px] font-semibold text-violet-800">
                          {user.full_name
                            .split(' ')
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join('')}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold text-ink">
                            {user.full_name}
                          </span>
                          <span className="block truncate text-[11px] text-ink-soft">
                            {ROLE_LABEL[user.role]}
                          </span>
                        </span>
                        <ArrowRight
                          size={14}
                          className="shrink-0 text-ink-faint transition-colors group-hover:text-violet-700"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h2 className="text-[16px] font-semibold tracking-tight text-ink">
                  Accede a tu cuenta
                </h2>
                <p className="mt-1 text-[12.5px] text-ink-soft">
                  Con el correo que te facilitó tu empresa.
                </p>

                <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3.5">
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

                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy}
                    className="mt-1 h-11 text-[14px]"
                  >
                    {busy ? 'Comprobando…' : 'Entrar'}
                  </Button>
                </form>
              </>
            )}

            <p className="mt-4 flex items-start gap-2 border-t border-[color:var(--color-hairline)] pt-3.5 text-[11px] leading-relaxed text-ink-soft">
              <ShieldCheck size={13} className="mt-px shrink-0 text-violet-600" />
              Tus fichajes solo los ve tu empresa. Ningún registro puede alterarse ni
              eliminarse.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
