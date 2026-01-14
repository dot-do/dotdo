import { defineNoun } from '../types'
import { ServiceSchema } from 'digital-products'

export const Service = defineNoun({
  noun: 'Service',
  plural: 'Services',
  $type: 'https://schema.org.ai/Service',
  schema: ServiceSchema,
})
