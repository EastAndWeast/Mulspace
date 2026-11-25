import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@wb/ui-kit/styles.css'
import './styles/shell.css'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
