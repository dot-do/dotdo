/**
 * Main Application
 *
 * Hono application that serves the dotdo platform including:
 * - LLM-friendly documentation routes (/llms.txt, /llms-full.txt, /*.mdx)
 * - Static documentation pages
 * - API endpoints
 */

import { Hono } from 'hono'
import { llmsRouter } from './routes/llms'

// Create main application
export const app = new Hono()

// Mount LLM-friendly documentation routes
app.route('/', llmsRouter)

export default app
