/**
 * Shared type definitions for Cap'n Web RPC
 *
 * Centralized definitions to avoid duplication across proxy, interface, and capability modules.
 */

/**
 * Field schema definition
 */
export interface FieldSchema {
  name: string
  type: string
  required?: boolean
  description?: string
}

/**
 * Parameter schema definition
 */
export interface ParamSchema {
  name: string
  type: string
  required?: boolean
}

/**
 * Method descriptor
 */
export interface MethodDescriptor {
  name: string
  params: ParamSchema[]
  returns: string
  isAsync: boolean
  isGenerator?: boolean
  description?: string
  callable?: boolean
}

/**
 * Schema type for introspection
 */
export interface Schema {
  name: string
  fields: FieldSchema[]
  methods: MethodSchema[]
}

/**
 * Method schema definition
 */
export interface MethodSchema {
  name: string
  params: ParamSchema[]
  returns: string
  description?: string
}

/**
 * Pipeline step in a chained RPC call
 */
export interface PipelineStep {
  method: string
  args: unknown[]
  index: number
}
