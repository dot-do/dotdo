/**
 * Great Expectations YAML Import
 *
 * Imports Great Expectations YAML configuration files and converts them
 * to DataContract expectations.
 *
 * Great Expectations is a popular Python library for data quality validation.
 * This module allows importing GE expectation suites into our native format.
 *
 * @see https://docs.greatexpectations.io/docs/reference/expectations/
 *
 * @example
 * ```typescript
 * import { importGreatExpectations } from './importers/great-expectations'
 *
 * const yaml = `
 * expectation_suite_name: users_suite
 * expectations:
 *   - expectation_type: expect_column_values_to_be_unique
 *     kwargs:
 *       column: user_id
 * `
 *
 * const result = importGreatExpectations(yaml)
 * // Use result.expectations with validateExpectations()
 * ```
 */

import * as yaml from 'yaml'
import type {
  Expectation,
  ExpectationType,
  Constraint,
  TableExpectationDefinition,
} from '../expectation-dsl'

// ============================================================================
// GREAT EXPECTATIONS TYPES
// ============================================================================

/**
 * Great Expectations expectation kwargs
 */
export interface GEKwargs {
  column?: string
  value_set?: (string | number | boolean | null)[]
  regex?: string
  min_value?: number
  max_value?: number
  value?: number
  type_?: string
  strict_min?: boolean
  strict_max?: boolean
  mostly?: number
  [key: string]: unknown
}

/**
 * Great Expectations expectation meta information
 */
export interface GEMeta {
  notes?: string
  profiler_details?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Great Expectations single expectation definition
 */
export interface GEExpectation {
  expectation_type: string
  kwargs: GEKwargs
  meta?: GEMeta
}

/**
 * Great Expectations suite structure
 */
export interface GreatExpectationsSuite {
  expectation_suite_name: string
  expectations: GEExpectation[]
  data_asset_type?: string
  ge_cloud_id?: string
  meta?: Record<string, unknown>
}

// ============================================================================
// IMPORT RESULT TYPES
// ============================================================================

/**
 * Warning types for import issues
 */
export type ImportWarningType = 'unsupported' | 'invalid' | 'partial_support'

/**
 * Warning generated during import
 */
export interface ImportWarning {
  type: ImportWarningType
  expectationType: string
  message: string
  details?: string
}

/**
 * Result of converting a single expectation
 */
export interface ConversionResult {
  expectation: Expectation | null
  warning?: ImportWarning
}

/**
 * Summary statistics for import
 */
export interface ImportSummary {
  total: number
  imported: number
  skipped: number
}

/**
 * Full import result
 */
export interface ImportResult {
  suiteName: string
  expectations: Expectation[]
  warnings: ImportWarning[]
  summary: ImportSummary
  metadata?: Record<string, unknown>
  toTableExpectation(): TableExpectationDefinition
}

// ============================================================================
// EXPECTATION TYPE MAPPING
// ============================================================================

/**
 * Mapping from Great Expectations types to our ExpectationType
 */
const GE_TYPE_MAP: Record<string, ExpectationType | null> = {
  // Null/existence checks
  expect_column_values_to_not_be_null: 'not_null',
  expect_column_values_to_be_null: null, // We don't have a "must be null" expectation
  expect_column_to_exist: null, // Schema-level, not data-level

  // Uniqueness
  expect_column_values_to_be_unique: 'unique',
  expect_compound_columns_to_be_unique: null, // Not supported yet

  // Pattern matching
  expect_column_values_to_match_regex: 'pattern',
  expect_column_values_to_not_match_regex: null, // We don't have negated pattern
  expect_column_values_to_match_like_pattern: 'pattern', // Convert SQL LIKE to regex
  expect_column_values_to_not_match_like_pattern: null,

  // Set membership
  expect_column_values_to_be_in_set: 'in_set',
  expect_column_values_to_not_be_in_set: null, // We don't have negated set

  // Comparisons
  expect_column_values_to_be_between: 'between',
  expect_column_values_to_be_greater_than: 'greater_than',
  expect_column_values_to_be_greater_than_or_equal_to: 'greater_than_or_equal',
  expect_column_values_to_be_less_than: 'less_than',
  expect_column_values_to_be_less_than_or_equal_to: 'less_than_or_equal',

  // Type checks
  expect_column_values_to_be_of_type: null, // Handled specially - maps to type_* based on kwargs

  // String length
  expect_column_value_lengths_to_be_between: null, // Handled specially - creates min/max length
  expect_column_value_lengths_to_equal: null, // Creates both min and max with same value

  // Aggregates
  expect_table_row_count_to_be_between: 'aggregate_count',
  expect_table_row_count_to_equal: 'aggregate_count',
  expect_column_sum_to_be_between: 'aggregate_sum',
  expect_column_mean_to_be_between: 'aggregate_avg',
  expect_column_min_to_be_between: 'aggregate_min',
  expect_column_max_to_be_between: 'aggregate_max',
  expect_column_median_to_be_between: null, // We don't have median yet
  expect_column_stdev_to_be_between: null, // We don't have stddev yet
}

/**
 * Mapping from GE type names to our type expectations
 */
const GE_DATA_TYPE_MAP: Record<string, ExpectationType> = {
  str: 'type_string',
  string: 'type_string',
  int: 'type_integer',
  integer: 'type_integer',
  int64: 'type_integer',
  int32: 'type_integer',
  float: 'type_number',
  float64: 'type_number',
  number: 'type_number',
  double: 'type_number',
  bool: 'type_boolean',
  boolean: 'type_boolean',
  datetime: 'type_date',
  date: 'type_date',
  timestamp: 'type_date',
}

// ============================================================================
// YAML PARSING
// ============================================================================

/**
 * Parse Great Expectations YAML string into structured format
 */
export function parseGreatExpectationsYAML(yamlString: string): GreatExpectationsSuite {
  const parsed = yaml.parse(yamlString)

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid Great Expectations YAML: expected object at root')
  }

  if (!parsed.expectation_suite_name) {
    throw new Error('Invalid Great Expectations YAML: missing expectation_suite_name')
  }

  // Normalize expectations array
  const expectations: GEExpectation[] = (parsed.expectations || []).map((exp: unknown) => {
    if (typeof exp !== 'object' || exp === null) {
      throw new Error('Invalid expectation: expected object')
    }

    const geExp = exp as Record<string, unknown>

    return {
      expectation_type: geExp.expectation_type as string,
      kwargs: (geExp.kwargs as GEKwargs) || {},
      meta: geExp.meta as GEMeta | undefined,
    }
  })

  return {
    expectation_suite_name: parsed.expectation_suite_name,
    expectations,
    data_asset_type: parsed.data_asset_type,
    ge_cloud_id: parsed.ge_cloud_id,
    meta: parsed.meta,
  }
}

// ============================================================================
// IMPORTER CLASS
// ============================================================================

/**
 * Importer for Great Expectations YAML files
 */
export class GreatExpectationsImporter {
  /**
   * Convert a single GE expectation to our format
   */
  convertExpectation(geExp: GEExpectation): ConversionResult {
    const { expectation_type, kwargs, meta } = geExp

    // Check for 'mostly' kwarg - we don't fully support partial expectations
    if (kwargs.mostly !== undefined && kwargs.mostly < 1) {
      const expectation = this.tryConvertExpectation(geExp)
      return {
        expectation: expectation?.expectation || null,
        warning: {
          type: 'partial_support',
          expectationType: expectation_type,
          message: `Expectation uses 'mostly=${kwargs.mostly}' which is not fully supported`,
          details: `mostly: ${kwargs.mostly}`,
        },
      }
    }

    // Handle special cases first
    const specialResult = this.handleSpecialCases(geExp)
    if (specialResult !== null) {
      return specialResult
    }

    // Look up in the type map
    const mappedType = GE_TYPE_MAP[expectation_type]

    if (mappedType === undefined) {
      // Unknown expectation type
      return {
        expectation: null,
        warning: {
          type: 'unsupported',
          expectationType: expectation_type,
          message: `Unsupported Great Expectations type: ${expectation_type}`,
        },
      }
    }

    if (mappedType === null) {
      // Explicitly unsupported
      return {
        expectation: null,
        warning: {
          type: 'unsupported',
          expectationType: expectation_type,
          message: `Great Expectations type '${expectation_type}' is not supported`,
        },
      }
    }

    // Validate required column for column-level expectations
    const needsColumn = !expectation_type.startsWith('expect_table_')
    if (needsColumn && !kwargs.column) {
      return {
        expectation: null,
        warning: {
          type: 'invalid',
          expectationType: expectation_type,
          message: `Missing required 'column' kwarg for ${expectation_type}`,
        },
      }
    }

    // Convert kwargs to params
    const params = this.convertKwargsToParams(expectation_type, kwargs)
    const constraint: Constraint = { type: mappedType, params }

    const expectation: Expectation = {
      column: kwargs.column || '*',
      type: mappedType,
      constraints: [constraint],
      params,
      message: meta?.notes,
    }

    return { expectation }
  }

  /**
   * Try to convert without validation (for partial support cases)
   */
  private tryConvertExpectation(geExp: GEExpectation): ConversionResult | null {
    const { expectation_type, kwargs, meta } = geExp

    const mappedType = GE_TYPE_MAP[expectation_type]
    if (!mappedType) return null

    const params = this.convertKwargsToParams(expectation_type, kwargs)
    const constraint: Constraint = { type: mappedType, params }

    return {
      expectation: {
        column: kwargs.column || '*',
        type: mappedType,
        constraints: [constraint],
        params,
        message: meta?.notes,
      },
    }
  }

  /**
   * Handle special cases that need custom conversion logic
   */
  private handleSpecialCases(geExp: GEExpectation): ConversionResult | null {
    const { expectation_type, kwargs, meta } = geExp

    // Handle type expectations
    if (expectation_type === 'expect_column_values_to_be_of_type') {
      const typeStr = kwargs.type_ as string
      if (!typeStr) {
        return {
          expectation: null,
          warning: {
            type: 'invalid',
            expectationType: expectation_type,
            message: `Missing required 'type_' kwarg for ${expectation_type}`,
          },
        }
      }

      const mappedType = GE_DATA_TYPE_MAP[typeStr.toLowerCase()]
      if (!mappedType) {
        return {
          expectation: null,
          warning: {
            type: 'unsupported',
            expectationType: expectation_type,
            message: `Unknown data type: ${typeStr}`,
          },
        }
      }

      if (!kwargs.column) {
        return {
          expectation: null,
          warning: {
            type: 'invalid',
            expectationType: expectation_type,
            message: `Missing required 'column' kwarg for ${expectation_type}`,
          },
        }
      }

      const constraint: Constraint = { type: mappedType }
      return {
        expectation: {
          column: kwargs.column,
          type: mappedType,
          constraints: [constraint],
          message: meta?.notes,
        },
      }
    }

    // Handle length expectations
    if (expectation_type === 'expect_column_value_lengths_to_be_between') {
      if (!kwargs.column) {
        return {
          expectation: null,
          warning: {
            type: 'invalid',
            expectationType: expectation_type,
            message: `Missing required 'column' kwarg for ${expectation_type}`,
          },
        }
      }

      const constraints: Constraint[] = []
      if (kwargs.min_value !== undefined) {
        constraints.push({ type: 'min_length', params: { length: kwargs.min_value } })
      }
      if (kwargs.max_value !== undefined) {
        constraints.push({ type: 'max_length', params: { length: kwargs.max_value } })
      }

      if (constraints.length === 0) {
        return {
          expectation: null,
          warning: {
            type: 'invalid',
            expectationType: expectation_type,
            message: `Missing min_value or max_value for ${expectation_type}`,
          },
        }
      }

      return {
        expectation: {
          column: kwargs.column,
          type: constraints[0].type,
          constraints,
          message: meta?.notes,
        },
      }
    }

    // Not a special case
    return null
  }

  /**
   * Convert GE kwargs to our params format
   */
  private convertKwargsToParams(
    expectationType: string,
    kwargs: GEKwargs
  ): Record<string, unknown> | undefined {
    switch (expectationType) {
      case 'expect_column_values_to_be_in_set':
        return { values: kwargs.value_set }

      case 'expect_column_values_to_match_regex':
      case 'expect_column_values_to_match_like_pattern':
        return {
          pattern: kwargs.regex ? new RegExp(kwargs.regex) : undefined,
        }

      case 'expect_column_values_to_be_between':
        return {
          min: kwargs.min_value,
          max: kwargs.max_value,
          exclusive: kwargs.strict_min || kwargs.strict_max || false,
        }

      case 'expect_column_values_to_be_greater_than':
      case 'expect_column_values_to_be_greater_than_or_equal_to':
      case 'expect_column_values_to_be_less_than':
      case 'expect_column_values_to_be_less_than_or_equal_to':
        return { value: kwargs.value ?? kwargs.min_value ?? kwargs.max_value }

      case 'expect_table_row_count_to_equal':
        return { expected: kwargs.value }

      case 'expect_table_row_count_to_be_between':
        return { expected: { min: kwargs.min_value, max: kwargs.max_value } }

      case 'expect_column_sum_to_be_between':
      case 'expect_column_mean_to_be_between':
      case 'expect_column_min_to_be_between':
      case 'expect_column_max_to_be_between':
        return { expected: { min: kwargs.min_value, max: kwargs.max_value } }

      default:
        return undefined
    }
  }

  /**
   * Export expectations back to Great Expectations format
   */
  exportToGreatExpectations(
    expectations: Expectation[],
    suiteName: string
  ): GreatExpectationsSuite {
    const geExpectations: GEExpectation[] = []

    for (const exp of expectations) {
      const geExp = this.convertToGEExpectation(exp)
      if (geExp) {
        geExpectations.push(geExp)
      }
    }

    return {
      expectation_suite_name: suiteName,
      expectations: geExpectations,
    }
  }

  /**
   * Convert a single expectation back to GE format
   */
  private convertToGEExpectation(exp: Expectation): GEExpectation | null {
    // Handle combined min/max length as length between
    if (exp.constraints.length === 2) {
      const hasMinLength = exp.constraints.some((c) => c.type === 'min_length')
      const hasMaxLength = exp.constraints.some((c) => c.type === 'max_length')
      if (hasMinLength && hasMaxLength) {
        const minConstraint = exp.constraints.find((c) => c.type === 'min_length')
        const maxConstraint = exp.constraints.find((c) => c.type === 'max_length')
        return {
          expectation_type: 'expect_column_value_lengths_to_be_between',
          kwargs: {
            column: exp.column,
            min_value: minConstraint?.params?.length as number,
            max_value: maxConstraint?.params?.length as number,
          },
          meta: exp.message ? { notes: exp.message } : undefined,
        }
      }
    }

    // Map single constraint types back to GE
    const reverseMap: Record<ExpectationType, string> = {
      not_null: 'expect_column_values_to_not_be_null',
      unique: 'expect_column_values_to_be_unique',
      pattern: 'expect_column_values_to_match_regex',
      in_set: 'expect_column_values_to_be_in_set',
      greater_than: 'expect_column_values_to_be_greater_than',
      greater_than_or_equal: 'expect_column_values_to_be_greater_than_or_equal_to',
      less_than: 'expect_column_values_to_be_less_than',
      less_than_or_equal: 'expect_column_values_to_be_less_than_or_equal_to',
      between: 'expect_column_values_to_be_between',
      type_string: 'expect_column_values_to_be_of_type',
      type_number: 'expect_column_values_to_be_of_type',
      type_integer: 'expect_column_values_to_be_of_type',
      type_date: 'expect_column_values_to_be_of_type',
      type_boolean: 'expect_column_values_to_be_of_type',
      min_length: 'expect_column_value_lengths_to_be_between',
      max_length: 'expect_column_value_lengths_to_be_between',
      aggregate_count: 'expect_table_row_count_to_be_between',
      aggregate_sum: 'expect_column_sum_to_be_between',
      aggregate_avg: 'expect_column_mean_to_be_between',
      aggregate_min: 'expect_column_min_to_be_between',
      aggregate_max: 'expect_column_max_to_be_between',
    }

    const geType = reverseMap[exp.type]
    if (!geType) return null

    const kwargs = this.convertParamsToKwargs(exp)

    return {
      expectation_type: geType,
      kwargs,
      meta: exp.message ? { notes: exp.message } : undefined,
    }
  }

  /**
   * Convert params back to GE kwargs
   */
  private convertParamsToKwargs(exp: Expectation): GEKwargs {
    const kwargs: GEKwargs = { column: exp.column }
    const params = exp.params || {}

    switch (exp.type) {
      case 'in_set':
        kwargs.value_set = params.values as (string | number | boolean | null)[]
        break

      case 'pattern':
        if (params.pattern instanceof RegExp) {
          kwargs.regex = params.pattern.source
        }
        break

      case 'between':
        kwargs.min_value = params.min as number
        kwargs.max_value = params.max as number
        if (params.exclusive) {
          kwargs.strict_min = true
          kwargs.strict_max = true
        }
        break

      case 'greater_than':
      case 'greater_than_or_equal':
      case 'less_than':
      case 'less_than_or_equal':
        kwargs.value = params.value as number
        break

      case 'type_string':
        kwargs.type_ = 'string'
        break

      case 'type_number':
        kwargs.type_ = 'float'
        break

      case 'type_integer':
        kwargs.type_ = 'int'
        break

      case 'type_boolean':
        kwargs.type_ = 'bool'
        break

      case 'type_date':
        kwargs.type_ = 'datetime'
        break

      case 'min_length':
        kwargs.min_value = params.length as number
        break

      case 'max_length':
        kwargs.max_value = params.length as number
        break

      case 'aggregate_count':
      case 'aggregate_sum':
      case 'aggregate_avg':
      case 'aggregate_min':
      case 'aggregate_max':
        if (typeof params.expected === 'number') {
          kwargs.value = params.expected
        } else if (params.expected && typeof params.expected === 'object') {
          const expected = params.expected as { min?: number; max?: number }
          kwargs.min_value = expected.min
          kwargs.max_value = expected.max
        }
        break
    }

    return kwargs
  }
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

/**
 * Import Great Expectations YAML string into DataContract expectations
 *
 * @example
 * ```typescript
 * const yaml = fs.readFileSync('great_expectations.yml', 'utf8')
 * const result = importGreatExpectations(yaml)
 *
 * console.log(`Imported ${result.summary.imported} of ${result.summary.total} expectations`)
 *
 * if (result.warnings.length > 0) {
 *   console.warn('Warnings:', result.warnings)
 * }
 *
 * // Use with validation
 * const validationResult = validateExpectations(result.expectations, data)
 * ```
 */
export function importGreatExpectations(yamlString: string): ImportResult {
  const suite = parseGreatExpectationsYAML(yamlString)
  const importer = new GreatExpectationsImporter()

  const expectations: Expectation[] = []
  const warnings: ImportWarning[] = []

  for (const geExp of suite.expectations) {
    const result = importer.convertExpectation(geExp)

    if (result.expectation) {
      expectations.push(result.expectation)
    }

    if (result.warning) {
      warnings.push(result.warning)
    }
  }

  const summary: ImportSummary = {
    total: suite.expectations.length,
    imported: expectations.length,
    skipped: suite.expectations.length - expectations.length,
  }

  return {
    suiteName: suite.expectation_suite_name,
    expectations,
    warnings,
    summary,
    metadata: suite.meta,
    toTableExpectation(): TableExpectationDefinition {
      return {
        table: suite.expectation_suite_name,
        columns: expectations,
      }
    },
  }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

export { GreatExpectationsImporter as Importer }
export default importGreatExpectations
