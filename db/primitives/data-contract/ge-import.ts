/**
 * Great Expectations YAML Import - Convenience API
 *
 * This module provides a simplified API for importing Great Expectations
 * expectation suites. It wraps the core implementation in `importers/great-expectations.ts`.
 *
 * @example
 * ```typescript
 * import { importGE, parseGEYaml, exportToGE } from './ge-import'
 *
 * // Import from YAML string
 * const result = importGE(yamlString)
 *
 * // Import from parsed JSON
 * const result2 = importGE.fromJSON(suiteObject)
 *
 * // Export back to GE format
 * const yaml = exportToGE('suite_name', expectations)
 * ```
 */

import * as yaml from 'yaml'
import {
  parseGreatExpectationsYAML,
  importGreatExpectations,
  GreatExpectationsImporter,
  type GreatExpectationsSuite,
  type GEExpectation,
  type GEKwargs,
  type GEMeta,
  type ImportResult,
  type ImportWarning,
  type ConversionResult,
} from './importers/great-expectations'
import type { Expectation } from './expectation-dsl'

// ============================================================================
// TYPE RE-EXPORTS (with aliases for backward compatibility)
// ============================================================================

export type GEExpectationSuite = GreatExpectationsSuite
export type { GEExpectation, GEKwargs, GEMeta }
export type GEImportResult = ImportResult
export type GEImportWarning = ImportWarning & {
  original?: GEExpectation
}

// ============================================================================
// SUPPORTED EXPECTATIONS CATALOG
// ============================================================================

/**
 * List of supported Great Expectations expectation types
 */
export const SUPPORTED_GE_EXPECTATIONS = [
  // Existence checks
  'expect_column_to_exist',
  'expect_column_values_to_not_be_null',
  'expect_column_values_to_be_null',

  // Uniqueness
  'expect_column_values_to_be_unique',
  'expect_compound_columns_to_be_unique',

  // Pattern matching
  'expect_column_values_to_match_regex',
  'expect_column_values_to_not_match_regex',
  'expect_column_values_to_match_like_pattern',
  'expect_column_values_to_not_match_like_pattern',

  // Set membership
  'expect_column_values_to_be_in_set',
  'expect_column_values_to_not_be_in_set',

  // Comparisons
  'expect_column_values_to_be_between',
  'expect_column_values_to_be_greater_than',
  'expect_column_values_to_be_greater_than_or_equal_to',
  'expect_column_values_to_be_less_than',
  'expect_column_values_to_be_less_than_or_equal_to',

  // Type checks
  'expect_column_values_to_be_of_type',
  'expect_column_values_to_be_in_type_list',

  // String length
  'expect_column_value_lengths_to_be_between',
  'expect_column_value_lengths_to_equal',

  // Aggregates
  'expect_table_row_count_to_be_between',
  'expect_table_row_count_to_equal',
  'expect_column_sum_to_be_between',
  'expect_column_mean_to_be_between',
  'expect_column_min_to_be_between',
  'expect_column_max_to_be_between',
  'expect_column_median_to_be_between',
  'expect_column_stdev_to_be_between',
] as const

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse Great Expectations YAML into a structured suite object
 */
export function parseGEYaml(yamlString: string): GEExpectationSuite {
  const result = parseGreatExpectationsYAML(yamlString)

  // Ensure expectations have kwargs even if empty
  return {
    ...result,
    expectations: result.expectations.map((exp) => ({
      ...exp,
      kwargs: exp.kwargs || {},
    })),
  }
}

// ============================================================================
// EXPECTATION MAPPING
// ============================================================================

// Create singleton importer instance
const importer = new GreatExpectationsImporter()

/**
 * Map a single GE expectation to our native format
 */
export function mapGEExpectation(ge: GEExpectation): ConversionResult & { warning?: GEImportWarning } {
  const result = importer.convertExpectation(ge)

  // Enhance warning with original expectation
  if (result.warning) {
    return {
      ...result,
      warning: {
        ...result.warning,
        original: ge,
      },
    }
  }

  return result
}

// ============================================================================
// FULL IMPORT
// ============================================================================

/**
 * Import Great Expectations suite from YAML string
 *
 * @example
 * ```typescript
 * const result = importGE(`
 * expectation_suite_name: users_suite
 * expectations:
 *   - expectation_type: expect_column_values_to_not_be_null
 *     kwargs:
 *       column: email
 * `)
 *
 * console.log(result.expectations) // Native Expectation[]
 * ```
 */
export function importGE(yamlString: string): GEImportResult {
  const result = importGreatExpectations(yamlString)

  // Convert warnings to include original expectations
  const enhancedWarnings: GEImportWarning[] = result.warnings.map((w) => ({
    ...w,
    original: undefined, // We lose this info at the bulk level
  }))

  return {
    ...result,
    warnings: enhancedWarnings,
  }
}

/**
 * Import from a pre-parsed JSON object
 */
importGE.fromJSON = function fromJSON(suite: GEExpectationSuite): GEImportResult {
  const expectations: Expectation[] = []
  const warnings: GEImportWarning[] = []

  for (const geExp of suite.expectations) {
    const result = mapGEExpectation(geExp)

    if (result.expectation) {
      expectations.push(result.expectation)
    }

    if (result.warning) {
      warnings.push(result.warning)
    }
  }

  return {
    suiteName: suite.expectation_suite_name,
    expectations,
    warnings,
    summary: {
      total: suite.expectations.length,
      imported: expectations.length,
      skipped: suite.expectations.length - expectations.length,
    },
    metadata: suite.meta,
    toTableExpectation() {
      return {
        table: suite.expectation_suite_name,
        columns: expectations,
      }
    },
  }
}

// ============================================================================
// EXPORT
// ============================================================================

/**
 * Export expectations to Great Expectations YAML format
 *
 * @example
 * ```typescript
 * const yaml = exportToGE('users_suite', expectations)
 * fs.writeFileSync('great_expectations.yml', yaml)
 * ```
 */
export function exportToGE(suiteName: string, expectations: Expectation[]): string {
  const suite = importer.exportToGreatExpectations(expectations, suiteName)

  // Convert to YAML with proper formatting
  return yaml.stringify(suite, {
    indent: 2,
    lineWidth: 0, // Disable line wrapping
  })
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default importGE
