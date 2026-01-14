import { defineNoun } from '../types'
import { APISchema } from 'digital-products'

export const API = defineNoun({
  noun: 'API',
  plural: 'APIs',
  $type: 'https://schema.org.ai/API',
  schema: APISchema,
})
