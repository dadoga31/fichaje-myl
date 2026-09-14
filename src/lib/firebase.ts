import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

/**
 * La configuración de Firebase es PÚBLICA por diseño: viaja en el JavaScript
 * que descarga cualquier visitante y solo identifica al proyecto. Quien
 * protege los datos son las reglas de `firestore.rules`, que se evalúan en el
 * servidor de Google y no hay forma de esquivar desde el cliente.
 *
 * Aun así va en variables de entorno: así el mismo código sirve para el
 * proyecto de producción y para uno de pruebas sin tocar el fuente.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isConfigured = Boolean(config.apiKey && config.projectId)

/** Momento en que se compiló este bundle. Lo inyecta Vite. */
export const buildTime = __BUILD_TIME__

/**
 * Qué variables llegaron realmente a la compilación.
 *
 * Vite incrusta estos valores en el JavaScript en tiempo de *build*, no de
 * ejecución: definirlas en Vercel no cambia nada hasta que se vuelve a
 * compilar. Sin este diagnóstico, «he puesto las variables y sigue igual» es
 * indistinguible de «las he escrito mal», y ambas cosas se depuran a ciegas.
 *
 * Mostrar los valores no compromete nada: esta configuración es pública por
 * diseño y ya viaja en el bundle. La clave de cuenta de servicio, que sí es
 * secreta, nunca llega al navegador.
 */
export const configStatus: Array<{ key: string; value: string | undefined }> = [
  { key: 'VITE_FIREBASE_API_KEY', value: config.apiKey },
  { key: 'VITE_FIREBASE_AUTH_DOMAIN', value: config.authDomain },
  { key: 'VITE_FIREBASE_PROJECT_ID', value: config.projectId },
  { key: 'VITE_FIREBASE_STORAGE_BUCKET', value: config.storageBucket },
  { key: 'VITE_FIREBASE_MESSAGING_SENDER_ID', value: config.messagingSenderId },
  { key: 'VITE_FIREBASE_APP_ID', value: config.appId },
]

/**
 * El modo demostración es EXPLÍCITO: exige VITE_DEMO=true.
 *
 * Que baste con no configurar nada para caer en la demo sería peligroso: una
 * variable mal escrita en Vercel dejaría a la plantilla fichando contra el
 * navegador, sin registro con valor legal y sin que nadie lo notara.
 */
export const isDemoMode = !isConfigured && import.meta.env.VITE_DEMO === 'true'

/** Ni backend ni demo: hay que configurar algo antes de poder usarla. */
export const isMisconfigured = !isConfigured && !isDemoMode

let app: FirebaseApp | null = null
let db: Firestore | null = null
let auth: Auth | null = null

if (isConfigured) {
  app = initializeApp(config)
  auth = getAuth(app)

  // Caché persistente: la PWA sigue mostrando la jornada sin cobertura, y
  // Firestore reenvía por su cuenta las escrituras pendientes al volver la red.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
}

export function requireDb(): Firestore {
  if (!db) throw new Error('Firebase no está configurado. Revise las variables VITE_FIREBASE_*.')
  return db
}

export function requireAuth(): Auth {
  if (!auth) throw new Error('Firebase no está configurado. Revise las variables VITE_FIREBASE_*.')
  return auth
}
