import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/noto-sans-thai'
import '../styles/tokens.css'
import '../styles/backoffice.css'
import AdminApp from './AdminApp'

document.documentElement.dataset.theme = 'dark'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AdminApp /></React.StrictMode>,
)
