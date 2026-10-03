// src/main.jsx
//
// Entry point. Mounts <App /> into #root in index.html, inside React's
// StrictMode, and loads the global stylesheet (Tailwind).

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)