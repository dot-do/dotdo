import { defineNoun } from '../types'
import { AppSchema } from 'digital-products'

export const App = defineNoun({
  noun: 'App',
  plural: 'Apps',
  $type: 'https://schema.org.ai/App',
  schema: AppSchema,
})
