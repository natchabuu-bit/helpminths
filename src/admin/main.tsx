import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-thai'
import AdminApp from './AdminApp'
import './site.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AdminApp /></React.StrictMode>,
)
