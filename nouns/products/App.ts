import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * App schema for digital applications (Zod v4 compatible)
 */
export const AppSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/App'),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  platforms: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type AppType = z.infer<typeof AppSchema>

export const App = defineNoun({
  noun: 'App',
  plural: 'Apps',
  $type: 'https://schema.org.ai/App',
  schema: AppSchema,
})
