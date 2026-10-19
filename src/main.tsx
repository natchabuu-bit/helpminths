import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-thai'
import App from './App'
import './styles/global.css'
import { registerOfflineSupport } from './offline'

void registerOfflineSupport()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
