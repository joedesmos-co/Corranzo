import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { InstrumentProvider } from './context/InstrumentContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <InstrumentProvider>
      <App />
    </InstrumentProvider>
  </StrictMode>,
)
