/**
 * $project Stage - MongoDB-style field projection and transformation
 *
 * Supports:
 * - Field inclusion/exclusion (1/0 or true/false)
 * - Field renaming ($fieldRef)
 * - Nested field access (dot notation)
 * - Computed fields with expressions
 * - Array operations ($size, $arrayElemAt, $slice, $filter, $map, $reduce)
 * - String operations ($concat, $toUpper, $toLower, $substr, $split, $strLenCP)
 * - Date operations ($year, $month, $dayOfMonth, $dateToString, $dateDiff)
 * - Conditional operations ($cond, $switch, $ifNull)
 * - Type coercion ($toString, $toInt, $toBool)
 * - Arithmetic ($add, $subtract, $multiply, $divide)
 */

import type { Stage } from '../index'

// ============================================================================
// Types
// ============================================================================

/**
 * Field projection value
 */
export type FieldProjection = 0 | 1 | boolean

/**
 * Computed field expression
 */
export interface ComputedField {
  // Literal value
  $literal?: unknown

  // Field reference
  [key: string]: unknown

  // String operations
  $concat?: (string | ComputedField)[]
  $toUpper?: string | ComputedField
  $toLower?: string | ComputedField
  $substr?: [string | ComputedField, number | ComputedField, number | ComputedField]
  $split?: [string | ComputedField, string]
  $strLenCP?: string | ComputedField
  $indexOfBytes?: [string | ComputedField, string]

  // Arithmetic operations
  $add?: (string | number | ComputedField)[]
  $subtract?: [string | number | ComputedField, string | number | ComputedField]
  $multiply?: (string | number | ComputedField)[]
  $divide?: [string | number | ComputedField, string | number | ComputedField]

  // Array operations
  $size?: string | ComputedField
  $arrayElemAt?: [string | ComputedField, number]
  $slice?: [string | ComputedField, number] | [string | ComputedField, number, number]
  $filter?: { input: string | ComputedField; as: string; cond: ComputedField }
  $map?: { input: string | ComputedField; as: string; in: ComputedField }
  $reduce?: { input: string | ComputedField; initialValue: unknown; in: ComputedField }

  // Date operations
  $year?: string | ComputedField
  $month?: string | ComputedField
  $dayOfMonth?: string | ComputedField
  $dateToString?: { format: string; date: string | ComputedField }
  $dateDiff?: { startDate: string | ComputedField; endDate: string | ComputedField; unit: string }

  // Conditional operations
  $cond?: { if: ComputedField; then: unknown; else: unknown } | [ComputedField, unknown, unknown]
  $switch?: { branches: Array<{ case: ComputedField; then: unknown }>; default?: unknown }
  $ifNull?: [string | ComputedField, unknown]

  // Comparison
  $eq?: [string | number | ComputedField, string | number | ComputedField]
  $ne?: [string | number | ComputedField, string | number | ComputedField]
  $gt?: [string | number | ComputedField, string | number | ComputedField]
  $gte?: [string | number | ComputedField, string | number | ComputedField]
  $lt?: [string | number | ComputedField, string | number | ComputedField]
  $lte?: [string | number | ComputedField, string | number | ComputedField]

  // Type coercion
  $toString?: string | ComputedField
  $toInt?: string | ComputedField
  $toBool?: string | ComputedField
}

/**
 * Project specification - can include/exclude fields or compute new ones
 */
export type ProjectSpec<T> = {
  [key: string]: FieldProjection | string | ComputedField | ProjectSpec<unknown>
}

/**
 * Project stage interface
 */
export interface ProjectStage<T> extends Stage<T, unknown> {
  name: '$project'
  specification: ProjectSpec<T>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')

  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (!(part in current)) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]!] = value
}

/**
 * Get field value from document (handles $ field references)
 */
function getFieldValue(doc: unknown, field: string | ComputedField, variables?: Map<string, unknown>): unknown {
  // Handle computed field expressions
  if (typeof field === 'object' && field !== null) {
    return evaluateExpression(field, doc, variables)
  }

  // Handle field reference strings
  if (typeof field === 'string') {
    // Variable reference ($$var)
    if (field.startsWith('$$')) {
      const varName = field.slice(2)
      return variables?.get(varName)
    }

    // Field reference ($field)
    if (field.startsWith('$')) {
      return getNestedValue(doc, field.slice(1))
    }

    // Literal string
    return field
  }

  return field
}

/**
 * Evaluate a computed expression
 */
function evaluateExpression(expr: ComputedField | unknown, doc: unknown, variables?: Map<string, unknown>): unknown {
  if (expr === null || expr === undefined) return expr

  // Handle primitive values
  if (typeof expr !== 'object') {
    if (typeof expr === 'string' && expr.startsWith('$')) {
      if (expr.startsWith('$$')) {
        const varName = expr.slice(2)
        return variables?.get(varName)
      }
      return getNestedValue(doc, expr.slice(1))
    }
    return expr
  }

  const exprObj = expr as Record<string, unknown>

  // $literal - return as-is
  if ('$literal' in exprObj) {
    return exprObj.$literal
  }

  // $concat - string concatenation
  if ('$concat' in exprObj) {
    const parts = exprObj.$concat as unknown[]
    return parts.map((p) => getFieldValue(doc, p as string | ComputedField, variables)).join('')
  }

  // $toUpper - uppercase
  if ('$toUpper' in exprObj) {
    const val = getFieldValue(doc, exprObj.$toUpper as string | ComputedField, variables)
    return typeof val === 'string' ? val.toUpperCase() : val
  }

  // $toLower - lowercase
  if ('$toLower' in exprObj) {
    const val = getFieldValue(doc, exprObj.$toLower as string | ComputedField, variables)
    return typeof val === 'string' ? val.toLowerCase() : val
  }

  // $substr - substring
  if ('$substr' in exprObj) {
    const [strExpr, startExpr, lenExpr] = exprObj.$substr as [unknown, unknown, unknown]
    const str = getFieldValue(doc, strExpr as string | ComputedField, variables) as string
    const start = getFieldValue(doc, startExpr as string | ComputedField, variables) as number
    const len = getFieldValue(doc, lenExpr as string | ComputedField, variables) as number

    if (typeof str !== 'string') return ''
    if (len === -1) return str.slice(start)
    return str.substr(start, len)
  }

  // $split - split string
  if ('$split' in exprObj) {
    const [strExpr, delimiter] = exprObj.$split as [unknown, string]
    const str = getFieldValue(doc, strExpr as string | ComputedField, variables) as string
    return typeof str === 'string' ? str.split(delimiter) : []
  }

  // $strLenCP - string length (code points)
  if ('$strLenCP' in exprObj) {
    const val = getFieldValue(doc, exprObj.$strLenCP as string | ComputedField, variables)
    return typeof val === 'string' ? val.length : 0
  }

  // $indexOfBytes - find substring index
  if ('$indexOfBytes' in exprObj) {
    const [strExpr, searchStr] = exprObj.$indexOfBytes as [unknown, string]
    const str = getFieldValue(doc, strExpr as string | ComputedField, variables) as string
    return typeof str === 'string' ? str.indexOf(searchStr) : -1
  }

  // $add - addition
  if ('$add' in exprObj) {
    const parts = exprObj.$add as unknown[]
    return parts.reduce((sum: number, p) => {
      const val = getFieldValue(doc, p as string | ComputedField, variables)
      return sum + (typeof val === 'number' ? val : 0)
    }, 0)
  }

  // $subtract - subtraction
  if ('$subtract' in exprObj) {
    const [a, b] = exprObj.$subtract as [unknown, unknown]
    const valA = getFieldValue(doc, a as string | ComputedField, variables) as number
    const valB = getFieldValue(doc, b as string | ComputedField, variables) as number
    return valA - valB
  }

  // $multiply - multiplication
  if ('$multiply' in exprObj) {
    const parts = exprObj.$multiply as unknown[]
    return parts.reduce((product: number, p) => {
      const val = getFieldValue(doc, p as string | ComputedField, variables)
      return product * (typeof val === 'number' ? val : 0)
    }, 1)
  }

  // $divide - division
  if ('$divide' in exprObj) {
    const [a, b] = exprObj.$divide as [unknown, unknown]
    const valA = getFieldValue(doc, a as string | ComputedField, variables) as number
    const valB = getFieldValue(doc, b as string | ComputedField, variables) as number
    return valB !== 0 ? valA / valB : 0
  }

  // $size - array size
  if ('$size' in exprObj) {
    const val = getFieldValue(doc, exprObj.$size as string | ComputedField, variables)
    return Array.isArray(val) ? val.length : 0
  }

  // $arrayElemAt - get array element at index
  if ('$arrayElemAt' in exprObj) {
    const [arrExpr, idxExpr] = exprObj.$arrayElemAt as [unknown, number]
    const arr = getFieldValue(doc, arrExpr as string | ComputedField, variables)
    if (!Array.isArray(arr)) return null
    const idx = typeof idxExpr === 'number' ? idxExpr : (getFieldValue(doc, idxExpr as ComputedField, variables) as number)
    if (idx < 0) return arr[arr.length + idx]
    return arr[idx]
  }

  // $slice - array slice
  if ('$slice' in exprObj) {
    const sliceArgs = exprObj.$slice as unknown[]
    const arr = getFieldValue(doc, sliceArgs[0] as string | ComputedField, variables) as unknown[]
    if (!Array.isArray(arr)) return []
    if (sliceArgs.length === 2) {
      return arr.slice(0, sliceArgs[1] as number)
    }
    return arr.slice(sliceArgs[1] as number, (sliceArgs[1] as number) + (sliceArgs[2] as number))
  }

  // $filter - filter array
  if ('$filter' in exprObj) {
    const { input, as, cond } = exprObj.$filter as { input: unknown; as: string; cond: ComputedField }
    const arr = getFieldValue(doc, input as string | ComputedField, variables) as unknown[]
    if (!Array.isArray(arr)) return []

    return arr.filter((item) => {
      const vars = new Map(variables)
      vars.set(as, item)
      return Boolean(evaluateExpression(cond, doc, vars))
    })
  }

  // $map - map array
  if ('$map' in exprObj) {
    const { input, as, in: inExpr } = exprObj.$map as { input: unknown; as: string; in: ComputedField }
    const arr = getFieldValue(doc, input as string | ComputedField, variables) as unknown[]
    if (!Array.isArray(arr)) return []

    return arr.map((item) => {
      const vars = new Map(variables)
      vars.set(as, item)
      return evaluateExpression(inExpr, doc, vars)
    })
  }

  // $reduce - reduce array
  if ('$reduce' in exprObj) {
    const { input, initialValue, in: inExpr } = exprObj.$reduce as {
      input: unknown
      initialValue: unknown
      in: ComputedField
    }
    const arr = getFieldValue(doc, input as string | ComputedField, variables) as unknown[]
    if (!Array.isArray(arr)) return initialValue

    return arr.reduce((acc, item) => {
      const vars = new Map(variables)
      vars.set('value', acc)
      vars.set('this', item)
      return evaluateExpression(inExpr, doc, vars)
    }, initialValue)
  }

  // Date operations - use UTC methods to avoid timezone issues
  if ('$year' in exprObj) {
    const val = getFieldValue(doc, exprObj.$year as string | ComputedField, variables)
    return val instanceof Date ? val.getUTCFullYear() : null
  }

  if ('$month' in exprObj) {
    const val = getFieldValue(doc, exprObj.$month as string | ComputedField, variables)
    return val instanceof Date ? val.getUTCMonth() + 1 : null
  }

  if ('$dayOfMonth' in exprObj) {
    const val = getFieldValue(doc, exprObj.$dayOfMonth as string | ComputedField, variables)
    return val instanceof Date ? val.getUTCDate() : null
  }

  if ('$dateToString' in exprObj) {
    const { format, date } = exprObj.$dateToString as { format: string; date: unknown }
    const dateVal = getFieldValue(doc, date as string | ComputedField, variables)
    if (!(dateVal instanceof Date)) return null

    const pad = (n: number, width = 2) => String(n).padStart(width, '0')
    return format
      .replace('%Y', String(dateVal.getUTCFullYear()))
      .replace('%m', pad(dateVal.getUTCMonth() + 1))
      .replace('%d', pad(dateVal.getUTCDate()))
      .replace('%H', pad(dateVal.getUTCHours()))
      .replace('%M', pad(dateVal.getUTCMinutes()))
      .replace('%S', pad(dateVal.getUTCSeconds()))
  }

  if ('$dateDiff' in exprObj) {
    const { startDate, endDate, unit } = exprObj.$dateDiff as {
      startDate: unknown
      endDate: unknown
      unit: string
    }
    const start = getFieldValue(doc, startDate as string | ComputedField, variables) as Date
    const end = getFieldValue(doc, endDate as string | ComputedField, variables) as Date

    if (!(start instanceof Date) || !(end instanceof Date)) return null

    const diffMs = end.getTime() - start.getTime()
    switch (unit) {
      case 'millisecond':
        return diffMs
      case 'second':
        return Math.floor(diffMs / 1000)
      case 'minute':
        return Math.floor(diffMs / 60000)
      case 'hour':
        return Math.floor(diffMs / 3600000)
      case 'day':
        return Math.floor(diffMs / 86400000)
      default:
        return diffMs
    }
  }

  // Conditional operations
  if ('$cond' in exprObj) {
    const cond = exprObj.$cond
    if (Array.isArray(cond)) {
      const [condition, thenVal, elseVal] = cond
      const condResult = evaluateExpression(condition, doc, variables)
      return condResult ? evaluateExpression(thenVal as ComputedField, doc, variables) : evaluateExpression(elseVal as ComputedField, doc, variables)
    } else {
      const { if: condition, then: thenVal, else: elseVal } = cond as {
        if: ComputedField
        then: unknown
        else: unknown
      }
      const condResult = evaluateExpression(condition, doc, variables)
      return condResult ? evaluateExpression(thenVal as ComputedField, doc, variables) : evaluateExpression(elseVal as ComputedField, doc, variables)
    }
  }

  if ('$switch' in exprObj) {
    const { branches, default: defaultVal } = exprObj.$switch as {
      branches: Array<{ case: ComputedField; then: unknown }>
      default?: unknown
    }

    for (const branch of branches) {
      const condResult = evaluateExpression(branch.case, doc, variables)
      if (condResult) {
        return evaluateExpression(branch.then as ComputedField, doc, variables)
      }
    }

    return defaultVal !== undefined ? evaluateExpression(defaultVal as ComputedField, doc, variables) : null
  }

  if ('$ifNull' in exprObj) {
    const [expr, fallback] = exprObj.$ifNull as [unknown, unknown]
    const val = getFieldValue(doc, expr as string | ComputedField, variables)
    return val !== null && val !== undefined ? val : evaluateExpression(fallback as ComputedField, doc, variables)
  }

  // Comparison operators
  if ('$eq' in exprObj) {
    const [a, b] = exprObj.$eq as [unknown, unknown]
    const valA = getFieldValue(doc, a as string | ComputedField, variables)
    const valB = getFieldValue(doc, b as string | ComputedField, variables)
    return valA === valB
  }

  if ('$ne' in exprObj) {
    const [a, b] = exprObj.$ne as [unknown, unknown]
    const valA = getFieldValue(doc, a as string | ComputedField, variables)
    const valB = getFieldValue(doc, b as string | ComputedField, variables)
    return valA !== valB
  }

  if ('$gt' in exprObj) {
    const [a, b] = exprObj.$gt as [unknown, unknown]
    const valA = getFieldValue(doc, a as string | ComputedField, variables) as number
    const valB = getFieldValue(doc, b as string | ComputedField, variables) as number
    return valA > valB
  }

  if ('$gte' in exprObj) {
    const [a, b] = exprObj.$gte as [unknown, unknown]
    const valA = getFieldValue(doc, a as string | ComputedField, variables) as number
    const valB = getFieldValue(doc, b as string | ComputedField, variables) as number
    return valA >= valB
  }

  if ('$lt' in exprObj) {
    const [a, b] = exprObj.$lt as [unknown, unknown]
    const valA = getFieldValue(doc, a as string | ComputedField, variables) as number
    const valB = getFieldValue(doc, b as string | ComputedField, variables) as number
    return valA < valB
  }

  if ('$lte' in exprObj) {
    const [a, b] = exprObj.$lte as [unknown, unknown]
    const valA = getFieldValue(doc, a as string | ComputedField, variables) as number
    const valB = getFieldValue(doc, b as string | ComputedField, variables) as number
    return valA <= valB
  }

  // Type coercion
  if ('$toString' in exprObj) {
    const val = getFieldValue(doc, exprObj.$toString as string | ComputedField, variables)
    return String(val)
  }

  if ('$toInt' in exprObj) {
    const val = getFieldValue(doc, exprObj.$toInt as string | ComputedField, variables)
    return parseInt(String(val), 10)
  }

  if ('$toBool' in exprObj) {
    const val = getFieldValue(doc, exprObj.$toBool as string | ComputedField, variables)
    return Boolean(val)
  }

  // Handle nested object projection with field references
  // Check if the object contains field references that need resolving
  const hasFieldRefs = Object.values(exprObj).some((v) => typeof v === 'string' && (v as string).startsWith('$'))
  // Check if this is a nested inclusion spec (contains 1/true values)
  const hasInclusionSpec = Object.values(exprObj).some((v) => v === 1 || v === true)

  if (hasFieldRefs || hasInclusionSpec) {
    const resolved: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(exprObj)) {
      if (typeof val === 'string' && val.startsWith('$')) {
        // Field reference
        resolved[key] = getNestedValue(doc, val.slice(1))
      } else if (val === 1 || val === true) {
        // Inclusion - get from source document using the same key path
        // Need to look up from the context path
        resolved[key] = val // Will be resolved at a higher level
      } else if (typeof val === 'object' && val !== null) {
        resolved[key] = evaluateExpression(val as ComputedField, doc, variables)
      } else {
        resolved[key] = val
      }
    }
    return resolved
  }

  return exprObj
}

/**
 * Determine if a spec is inclusion or exclusion mode
 */
function getProjectionMode(spec: ProjectSpec<unknown>): 'include' | 'exclude' | 'mixed' {
  let hasInclusion = false
  let hasExclusion = false

  for (const [key, value] of Object.entries(spec)) {
    if (key === '_id') continue

    if (value === 0 || value === false) {
      hasExclusion = true
    } else if (value === 1 || value === true) {
      hasInclusion = true
    } else if (typeof value === 'string' && value.startsWith('$')) {
      hasInclusion = true
    } else if (typeof value === 'object') {
      hasInclusion = true
    }
  }

  if (hasInclusion && hasExclusion) return 'mixed'
  if (hasExclusion) return 'exclude'
  return 'include'
}

/**
 * Project a single document
 */
function projectDocument<T>(doc: T, spec: ProjectSpec<T>): unknown {
  const mode = getProjectionMode(spec as ProjectSpec<unknown>)

  // Check for mixed mode (invalid)
  if (mode === 'mixed') {
    throw new Error('Cannot mix inclusion and exclusion in $project (except _id)')
  }

  const result: Record<string, unknown> = {}
  const docObj = doc as Record<string, unknown>

  if (mode === 'exclude') {
    // Start with all fields, then exclude specified ones
    for (const [key, value] of Object.entries(docObj)) {
      // Check if this field is excluded
      const specValue = (spec as Record<string, unknown>)[key]
      if (specValue === 0 || specValue === false) continue

      // Check for nested exclusion (e.g., 'profile.preferences': 0)
      let excluded = false
      for (const [specKey, specVal] of Object.entries(spec as Record<string, unknown>)) {
        if (specKey.startsWith(key + '.') && (specVal === 0 || specVal === false)) {
          // This is a nested exclusion - we need to copy the field and exclude nested
          if (!excluded) {
            result[key] = deepCloneExcluding(value, specKey.slice(key.length + 1))
            excluded = true
          }
        }
      }

      if (!excluded) {
        result[key] = deepClone(value)
      }
    }
  } else {
    // Inclusion mode

    // Handle _id
    if (spec._id !== 0 && spec._id !== false) {
      result._id = docObj._id
    }

    // Process each field in spec
    for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
      if (key === '_id') continue

      // Simple inclusion
      if (value === 1 || value === true) {
        if (key.includes('.')) {
          // Nested field inclusion
          const val = getNestedValue(doc, key)
          setNestedValue(result, key, val)
        } else {
          result[key] = docObj[key]
        }
        continue
      }

      // Field reference (rename)
      if (typeof value === 'string' && value.startsWith('$')) {
        result[key] = getNestedValue(doc, value.slice(1))
        continue
      }

      // Computed expression or nested projection spec
      if (typeof value === 'object' && value !== null) {
        // Check if this is a nested projection spec (has 1/true for inclusion)
        // or a nested output structure with field references
        const obj = value as Record<string, unknown>
        const isNestedProjection = Object.values(obj).some((v) => v === 1 || v === true || (typeof v === 'object' && v !== null && Object.values(v as Record<string, unknown>).some(vv => vv === 1 || vv === true)))

        if (isNestedProjection) {
          // Nested projection - extract nested fields from source document
          result[key] = projectNestedDocument(docObj[key] as Record<string, unknown>, obj)
        } else {
          // Computed expression or nested output with field references
          const computed = evaluateExpression(value as ComputedField, doc)
          result[key] = computed
        }
        continue
      }
    }
  }

  return result
}

/**
 * Project fields from a nested document
 */
function projectNestedDocument(
  sourceDoc: Record<string, unknown> | undefined,
  spec: Record<string, unknown>
): Record<string, unknown> {
  if (!sourceDoc) return {}

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(spec)) {
    if (value === 1 || value === true) {
      result[key] = sourceDoc[key]
    } else if (typeof value === 'object' && value !== null) {
      // Nested projection
      result[key] = projectNestedDocument(sourceDoc[key] as Record<string, unknown>, value as Record<string, unknown>)
    }
  }

  return result
}

/**
 * Deep clone a value
 */
function deepClone(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) return value.map(deepClone)

  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = deepClone(v)
  }
  return result
}

/**
 * Deep clone excluding a nested path
 */
function deepCloneExcluding(value: unknown, excludePath: string): unknown {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) return value.map((v) => deepCloneExcluding(v, excludePath))

  const result: Record<string, unknown> = {}
  const parts = excludePath.split('.')
  const firstPart = parts[0]
  const remainingPath = parts.slice(1).join('.')

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === firstPart) {
      if (remainingPath) {
        result[k] = deepCloneExcluding(v, remainingPath)
      }
      // else: exclude this key entirely
    } else {
      result[k] = deepClone(v)
    }
  }
  return result
}

// ============================================================================
// Project Stage Factory
// ============================================================================

/**
 * Create a $project stage
 */
export function createProjectStage<T>(spec: ProjectSpec<T>): ProjectStage<T> {
  // Validate the spec upfront - cannot mix inclusion and exclusion
  const mode = getProjectionMode(spec as ProjectSpec<unknown>)
  if (mode === 'mixed') {
    throw new Error('Cannot mix inclusion and exclusion in $project (except _id)')
  }

  return {
    name: '$project',
    specification: spec,

    process(input: T[]): unknown[] {
      return input.map((doc) => projectDocument(doc, spec))
    },
  }
}
