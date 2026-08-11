import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import { SessionProvider } from './context/SessionContext'
import './index.css'

// El build de demostración se sirve como un único fichero HTML, sin servidor
// que reescriba las rutas, así que necesita enrutado por hash.
const Router = import.meta.env.VITE_HASH_ROUTER === 'true' ? HashRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <SessionProvider>
        <App />
      </SessionProvider>
    </Router>
  </StrictMode>,
)
