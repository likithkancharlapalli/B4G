import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { verifySupabaseConnection } from './lib/supabase'

verifySupabaseConnection().then((ok) => {
  if (ok) console.info('[Supabase] Connected')
  else console.warn('[Supabase] Not connected — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env')
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
