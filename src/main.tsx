import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/noto-sans-thai'
import './styles/tokens.css'
import './styles/app.css'
import App from './App'
import { registerOfflineSupport } from './offline'

document.documentElement.dataset.theme = 'light'
void registerOfflineSupport()

if (window.location.hash === '#admin') window.location.replace('/admin/')
else ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
