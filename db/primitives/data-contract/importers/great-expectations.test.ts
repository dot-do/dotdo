/**
 * Great Expectations YAML Import Tests
 *
 * Tests for importing Great Expectations YAML configuration files
 * and converting them to DataContract expectations.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  importGreatExpectations,
  parseGreatExpectationsYAML,
  GreatExpectationsImporter,
  type GreatExpectationsSuite,
  type GEExpectation,
  type ImportResult,
  type ImportWarning,
} from './great-expectations'

// ============================================================================
// YAML PARSING
// ============================================================================

describe('Great Expectations YAML Import', () => {
  describe('YAML parsing', () => {
    it('should parse basic Great Expectations YAML', () => {
      const yaml = `
expectation_suite_name: users_suite
expectations:
  - expectation_type: expect_column_values_to_be_unique
    kwargs:
      column: user_id
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: email
`
      const result = parseGreatExpectationsYAML(yaml)

      expect(result.expectation_suite_name).toBe('users_suite')
      expect(result.expectations).toHaveLength(2)
      expect(result.expectations[0].expectation_type).toBe('expect_column_values_to_be_unique')
      expect(result.expectations[0].kwargs.column).toBe('user_id')
    })

    it('should parse expectations with meta information', () => {
      const yaml = `
expectation_suite_name: orders_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: order_id
    meta:
      notes: Order ID is required for all records
      profiler_details:
        metric_configuration: {}
`
      const result = parseGreatExpectationsYAML(yaml)

      expect(result.expectations[0].meta?.notes).toBe('Order ID is required for all records')
    })

    it('should parse expectations with complex kwargs', () => {
      const yaml = `
expectation_suite_name: test_suite
expectations:
  - expectation_type: expect_column_values_to_be_in_set
    kwargs:
      column: status
      value_set:
        - active
        - inactive
        - pending
  - expectation_type: expect_column_values_to_be_between
    kwargs:
      column: age
      min_value: 0
      max_value: 150
`
      const result = parseGreatExpectationsYAML(yaml)

      expect(result.expectations[0].kwargs.value_set).toEqual(['active', 'inactive', 'pending'])
      expect(result.expectations[1].kwargs.min_value).toBe(0)
      expect(result.expectations[1].kwargs.max_value).toBe(150)
    })

    it('should handle empty expectations array', () => {
      const yaml = `
expectation_suite_name: empty_suite
expectations: []
`
      const result = parseGreatExpectationsYAML(yaml)

      expect(result.expectation_suite_name).toBe('empty_suite')
      expect(result.expectations).toHaveLength(0)
    })

    it('should preserve data_asset_type if present', () => {
      const yaml = `
expectation_suite_name: typed_suite
data_asset_type: Dataset
expectations:
  - expectation_type: expect_column_to_exist
    kwargs:
      column: id
`
      const result = parseGreatExpectationsYAML(yaml)

      expect(result.data_asset_type).toBe('Dataset')
    })

    it('should parse GE v3 format with ge_cloud_id', () => {
      const yaml = `
expectation_suite_name: cloud_suite
ge_cloud_id: abc123-def456
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: id
`
      const result = parseGreatExpectationsYAML(yaml)

      expect(result.ge_cloud_id).toBe('abc123-def456')
    })
  })

  // ============================================================================
  // EXPECTATION TYPE MAPPING
  // ============================================================================

  describe('expectation type mapping', () => {
    let importer: GreatExpectationsImporter

    beforeEach(() => {
      importer = new GreatExpectationsImporter()
    })

    it('should map expect_column_values_to_be_unique to unique', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_be_unique',
        kwargs: { column: 'user_id' },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('unique')
      expect(result.expectation?.column).toBe('user_id')
    })

    it('should map expect_column_values_to_not_be_null to not_null', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_not_be_null',
        kwargs: { column: 'email' },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('not_null')
      expect(result.expectation?.column).toBe('email')
    })

    it('should map expect_column_values_to_be_in_set to in_set', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_be_in_set',
        kwargs: {
          column: 'status',
          value_set: ['active', 'inactive', 'pending'],
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('in_set')
      expect(result.expectation?.params?.values).toEqual(['active', 'inactive', 'pending'])
    })

    it('should map expect_column_values_to_match_regex to pattern', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_match_regex',
        kwargs: {
          column: 'email',
          regex: '^.+@.+\\..+$',
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('pattern')
      expect(result.expectation?.params?.pattern).toBeInstanceOf(RegExp)
      expect((result.expectation?.params?.pattern as RegExp).source).toBe('^.+@.+\\..+$')
    })

    it('should map expect_column_values_to_be_between to between', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_be_between',
        kwargs: {
          column: 'age',
          min_value: 0,
          max_value: 150,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('between')
      expect(result.expectation?.params?.min).toBe(0)
      expect(result.expectation?.params?.max).toBe(150)
    })

    it('should map expect_column_min_to_be_between to aggregate_min with range', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_min_to_be_between',
        kwargs: {
          column: 'price',
          min_value: 0,
          max_value: 100,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('aggregate_min')
      expect(result.expectation?.params?.expected).toEqual({ min: 0, max: 100 })
    })

    it('should map expect_column_max_to_be_between to aggregate_max with range', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_max_to_be_between',
        kwargs: {
          column: 'score',
          min_value: 90,
          max_value: 100,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('aggregate_max')
      expect(result.expectation?.params?.expected).toEqual({ min: 90, max: 100 })
    })

    it('should map expect_column_mean_to_be_between to aggregate_avg', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_mean_to_be_between',
        kwargs: {
          column: 'rating',
          min_value: 3.5,
          max_value: 4.5,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('aggregate_avg')
      expect(result.expectation?.params?.expected).toEqual({ min: 3.5, max: 4.5 })
    })

    it('should map expect_column_sum_to_be_between to aggregate_sum', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_sum_to_be_between',
        kwargs: {
          column: 'amount',
          min_value: 1000,
          max_value: 10000,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('aggregate_sum')
      expect(result.expectation?.params?.expected).toEqual({ min: 1000, max: 10000 })
    })

    it('should map expect_table_row_count_to_be_between to aggregate_count', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_table_row_count_to_be_between',
        kwargs: {
          min_value: 100,
          max_value: 1000,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('aggregate_count')
      expect(result.expectation?.params?.expected).toEqual({ min: 100, max: 1000 })
    })

    it('should map expect_table_row_count_to_equal to aggregate_count with exact value', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_table_row_count_to_equal',
        kwargs: {
          value: 500,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('aggregate_count')
      expect(result.expectation?.params?.expected).toBe(500)
    })

    it('should map expect_column_values_to_be_of_type to type check', () => {
      const testCases = [
        { type: 'str', expected: 'type_string' },
        { type: 'string', expected: 'type_string' },
        { type: 'int', expected: 'type_integer' },
        { type: 'integer', expected: 'type_integer' },
        { type: 'float', expected: 'type_number' },
        { type: 'number', expected: 'type_number' },
        { type: 'bool', expected: 'type_boolean' },
        { type: 'boolean', expected: 'type_boolean' },
        { type: 'datetime', expected: 'type_date' },
        { type: 'date', expected: 'type_date' },
      ]

      for (const testCase of testCases) {
        const geExpectation: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_of_type',
          kwargs: {
            column: 'test_column',
            type_: testCase.type,
          },
        }

        const result = importer.convertExpectation(geExpectation)
        expect(result.expectation?.type).toBe(testCase.expected)
      }
    })

    it('should map expect_column_value_lengths_to_be_between to min/max_length', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_value_lengths_to_be_between',
        kwargs: {
          column: 'username',
          min_value: 3,
          max_value: 50,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      // Should create multiple constraints for min and max
      expect(result.expectation?.constraints).toHaveLength(2)
      expect(result.expectation?.constraints[0].type).toBe('min_length')
      expect(result.expectation?.constraints[0].params?.length).toBe(3)
      expect(result.expectation?.constraints[1].type).toBe('max_length')
      expect(result.expectation?.constraints[1].params?.length).toBe(50)
    })

    it('should map expect_column_values_to_be_greater_than to greater_than', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_be_greater_than',
        kwargs: {
          column: 'quantity',
          value: 0,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('greater_than')
      expect(result.expectation?.params?.value).toBe(0)
    })

    it('should map expect_column_values_to_be_less_than to less_than', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_be_less_than',
        kwargs: {
          column: 'discount',
          value: 100,
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.type).toBe('less_than')
      expect(result.expectation?.params?.value).toBe(100)
    })
  })

  // ============================================================================
  // CUSTOM EXPECTATION HANDLING
  // ============================================================================

  describe('custom expectation handling', () => {
    let importer: GreatExpectationsImporter

    beforeEach(() => {
      importer = new GreatExpectationsImporter()
    })

    it('should return warning for unknown expectation type', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_custom_business_rule',
        kwargs: {
          column: 'data',
          custom_param: 'value',
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation).toBeNull()
      expect(result.warning).toBeDefined()
      expect(result.warning?.type).toBe('unsupported')
      expect(result.warning?.expectationType).toBe('expect_custom_business_rule')
    })

    it('should handle missing column gracefully', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_not_be_null',
        kwargs: {}, // Missing column
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation).toBeNull()
      expect(result.warning?.type).toBe('invalid')
    })

    it('should preserve meta notes as custom message', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_not_be_null',
        kwargs: { column: 'email' },
        meta: {
          notes: 'Email is required for user communication',
        },
      }

      const result = importer.convertExpectation(geExpectation)

      expect(result.expectation?.message).toBe('Email is required for user communication')
    })

    it('should handle mostly_kwarg for partial expectations', () => {
      const geExpectation: GEExpectation = {
        expectation_type: 'expect_column_values_to_not_be_null',
        kwargs: {
          column: 'optional_field',
          mostly: 0.95, // Allow 5% nulls
        },
      }

      const result = importer.convertExpectation(geExpectation)

      // We should warn about mostly since our DSL doesn't support it yet
      expect(result.warning?.type).toBe('partial_support')
      expect(result.warning?.details).toContain('mostly')
    })
  })

  // ============================================================================
  // FULL IMPORT FLOW
  // ============================================================================

  describe('full import flow', () => {
    it('should import complete suite from YAML string', () => {
      const yaml = `
expectation_suite_name: users_suite
expectations:
  - expectation_type: expect_column_values_to_be_unique
    kwargs:
      column: user_id
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: email
  - expectation_type: expect_column_values_to_match_regex
    kwargs:
      column: email
      regex: "^.+@.+\\\\..+$"
  - expectation_type: expect_column_values_to_be_in_set
    kwargs:
      column: status
      value_set:
        - active
        - inactive
        - pending
`
      const result = importGreatExpectations(yaml)

      expect(result.suiteName).toBe('users_suite')
      expect(result.expectations).toHaveLength(4)
      expect(result.warnings).toHaveLength(0)
    })

    it('should collect warnings for unsupported expectations', () => {
      const yaml = `
expectation_suite_name: mixed_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: id
  - expectation_type: expect_custom_unsupported_type
    kwargs:
      column: data
  - expectation_type: expect_column_values_to_be_unique
    kwargs:
      column: email
`
      const result = importGreatExpectations(yaml)

      expect(result.expectations).toHaveLength(2)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0].expectationType).toBe('expect_custom_unsupported_type')
    })

    it('should handle empty suite gracefully', () => {
      const yaml = `
expectation_suite_name: empty_suite
expectations: []
`
      const result = importGreatExpectations(yaml)

      expect(result.suiteName).toBe('empty_suite')
      expect(result.expectations).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })

    it('should provide summary of import results', () => {
      const yaml = `
expectation_suite_name: test_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: id
  - expectation_type: expect_column_values_to_be_unique
    kwargs:
      column: id
  - expectation_type: expect_custom_type
    kwargs:
      column: data
`
      const result = importGreatExpectations(yaml)

      expect(result.summary.total).toBe(3)
      expect(result.summary.imported).toBe(2)
      expect(result.summary.skipped).toBe(1)
    })
  })

  // ============================================================================
  // INTEGRATION WITH DATA CONTRACT
  // ============================================================================

  describe('integration with DataContract expectations', () => {
    it('should produce expectations compatible with validateExpectations', async () => {
      const yaml = `
expectation_suite_name: validation_test
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: id
  - expectation_type: expect_column_values_to_be_in_set
    kwargs:
      column: status
      value_set:
        - active
        - inactive
`
      const result = importGreatExpectations(yaml)

      // Import the validation function
      const { validateExpectations } = await import('../expectation-dsl')

      // Test data
      const validData = [
        { id: '1', status: 'active' },
        { id: '2', status: 'inactive' },
      ]

      const validationResult = validateExpectations(result.expectations, validData)
      expect(validationResult.passed).toBe(true)

      // Test with invalid data
      const invalidData = [
        { id: null, status: 'active' },
        { id: '2', status: 'unknown' },
      ]

      const invalidResult = validateExpectations(result.expectations, invalidData)
      expect(invalidResult.passed).toBe(false)
      expect(invalidResult.failures.length).toBeGreaterThan(0)
    })

    it('should create TableExpectationDefinition from suite', () => {
      const yaml = `
expectation_suite_name: users_table
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: email
  - expectation_type: expect_column_values_to_be_unique
    kwargs:
      column: user_id
`
      const result = importGreatExpectations(yaml)

      expect(result.toTableExpectation()).toEqual({
        table: 'users_table',
        columns: result.expectations,
      })
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle malformed YAML gracefully', () => {
      const badYaml = `
expectation_suite_name: bad_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: id
  this is not valid yaml
`
      expect(() => parseGreatExpectationsYAML(badYaml)).toThrow()
    })

    it('should handle expectations without kwargs', () => {
      const yaml = `
expectation_suite_name: minimal_suite
expectations:
  - expectation_type: expect_table_columns_to_match_ordered_list
`
      const result = parseGreatExpectationsYAML(yaml)

      expect(result.expectations[0].kwargs).toEqual({})
    })

    it('should handle regex with special characters', () => {
      const yaml = `
expectation_suite_name: regex_suite
expectations:
  - expectation_type: expect_column_values_to_match_regex
    kwargs:
      column: phone
      regex: "^\\\\+?[1-9]\\\\d{1,14}$"
`
      const result = importGreatExpectations(yaml)

      expect(result.expectations[0].params?.pattern).toBeInstanceOf(RegExp)
    })

    it('should handle null value_set entries', () => {
      const yaml = `
expectation_suite_name: nullable_suite
expectations:
  - expectation_type: expect_column_values_to_be_in_set
    kwargs:
      column: nullable_field
      value_set:
        - active
        - inactive
        - null
`
      const result = importGreatExpectations(yaml)

      expect(result.expectations[0].params?.values).toContain(null)
    })

    it('should handle strict_min and strict_max kwargs', () => {
      const yaml = `
expectation_suite_name: strict_bounds
expectations:
  - expectation_type: expect_column_values_to_be_between
    kwargs:
      column: value
      min_value: 0
      max_value: 100
      strict_min: true
      strict_max: true
`
      const result = importGreatExpectations(yaml)

      expect(result.expectations[0].params?.exclusive).toBe(true)
    })

    it('should handle GE batch request parameters', () => {
      const yaml = `
expectation_suite_name: batch_suite
data_asset_type: Dataset
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: id
meta:
  great_expectations_version: 0.18.0
`
      const result = importGreatExpectations(yaml)

      expect(result.metadata?.great_expectations_version).toBe('0.18.0')
    })
  })

  // ============================================================================
  // EXPORT (ROUNDTRIP)
  // ============================================================================

  describe('export to Great Expectations format', () => {
    let importer: GreatExpectationsImporter

    beforeEach(() => {
      importer = new GreatExpectationsImporter()
    })

    it('should export expectations back to GE format', () => {
      const yaml = `
expectation_suite_name: roundtrip_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: email
  - expectation_type: expect_column_values_to_be_unique
    kwargs:
      column: user_id
`
      const imported = importGreatExpectations(yaml)
      const exported = importer.exportToGreatExpectations(imported.expectations, 'roundtrip_suite')

      expect(exported.expectation_suite_name).toBe('roundtrip_suite')
      expect(exported.expectations).toHaveLength(2)
      expect(exported.expectations[0].expectation_type).toBe('expect_column_values_to_not_be_null')
      expect(exported.expectations[0].kwargs.column).toBe('email')
    })

    it('should handle expectations that cannot be exported', () => {
      // Use a complex constraint that might not map back
      // Type is inlined from expectation-dsl.ts
      const customExpectation = {
        column: 'test',
        type: 'min_length' as const,
        constraints: [
          { type: 'min_length' as const, params: { length: 5 } },
          { type: 'max_length' as const, params: { length: 50 } },
        ],
      }

      const exported = importer.exportToGreatExpectations([customExpectation], 'export_suite')

      // Should map to expect_column_value_lengths_to_be_between
      expect(exported.expectations.some(
        e => e.expectation_type === 'expect_column_value_lengths_to_be_between'
      )).toBe(true)
    })
  })
})
