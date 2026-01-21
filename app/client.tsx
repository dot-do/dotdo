import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/start'
import { createRouter } from './router'

const router = createRouter()

// TanStack Start types require router prop but TypeScript infers differently
hydrateRoot(document, <StartClient router={router} /> as any)
