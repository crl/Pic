import React from 'react'
import ReactDOM from 'react-dom/client'
import { installPicBridge } from './bridge/pic'
import { bindPicIpc } from './store/galleryStore'
import { App } from './ui/App'
import './index.css'

async function boot(): Promise<void> {
  await installPicBridge()
  bindPicIpc()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
