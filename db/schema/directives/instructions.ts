/**
 * $instructions Directive Handler
 *
 * Resolves and merges AI generation instructions for schema types and fields.
 */

export interface InstructionsObject {
  mode: 'extend' | 'prepend' | 'replace'
  content: string
}

export interface InstructionsOptions {
  defaultPrompt?: string
  schemaInstructions?: string
  field?: string
}

/**
 * Resolve the $instructions directive from a type or field definition
 */
export function resolveInstructions(
  type: Record<string, unknown>,
  options: InstructionsOptions = {}
): string | string[] | undefined {
  const instructions = type.$instructions

  // No instructions on type
  if (instructions === undefined) {
    // Use schema-level instructions if available
    if (options.schemaInstructions) {
      return options.schemaInstructions
    }
    return undefined
  }

  // String instructions
  if (typeof instructions === 'string') {
    return instructions
  }

  // Array instructions
  if (Array.isArray(instructions)) {
    return instructions as string[]
  }

  // Object instructions with mode
  if (typeof instructions === 'object' && instructions !== null) {
    const obj = instructions as InstructionsObject
    const mode = obj.mode || 'replace'
    const content = obj.content

    if (!options.defaultPrompt) {
      return content
    }

    switch (mode) {
      case 'extend':
        return `${options.defaultPrompt}\n\n${content}`

      case 'prepend':
        return `${content}\n\n${options.defaultPrompt}`

      case 'replace':
      default:
        return content
    }
  }

  return undefined
}

/**
 * Merge type-level instructions with schema-level instructions
 */
export function mergeInstructions(
  typeInstructions: string | string[] | InstructionsObject | undefined,
  schemaInstructions: string | undefined
): string | string[] {
  // No type instructions - return schema instructions
  if (!typeInstructions) {
    return schemaInstructions || ''
  }

  // No schema instructions - return type instructions
  if (!schemaInstructions) {
    if (typeof typeInstructions === 'string') {
      return typeInstructions
    }
    if (Array.isArray(typeInstructions)) {
      return typeInstructions
    }
    return (typeInstructions as InstructionsObject).content
  }

  // Merge both
  if (typeof typeInstructions === 'string') {
    return `${schemaInstructions}\n\n${typeInstructions}`
  }

  if (Array.isArray(typeInstructions)) {
    return [schemaInstructions, ...typeInstructions].join('\n\n')
  }

  // Object instructions
  const obj = typeInstructions as InstructionsObject
  const mode = obj.mode || 'replace'
  const content = obj.content

  switch (mode) {
    case 'extend':
      return `${schemaInstructions}\n\n${content}`

    case 'prepend':
      return `${content}\n\n${schemaInstructions}`

    case 'replace':
    default:
      return `${schemaInstructions}\n\n${content}`
  }
}
