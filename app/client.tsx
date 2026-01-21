import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/start'

// StartClient no longer takes a router prop - it hydrates automatically
hydrateRoot(document, <StartClient />)
