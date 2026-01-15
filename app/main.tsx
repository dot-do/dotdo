/**
 * Main Entry Point
 *
 * Renders the docs SPA application.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider'
import { createRouter } from './router'
import './styles/app.css'

const router = createRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootProvider>
      <RouterProvider router={router} />
    </RootProvider>
  </StrictMode>
)
