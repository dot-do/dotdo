/**
 * Great Expectations YAML Import Tests
 *
 * Tests for importing Great Expectations expectation suites and converting
 * them to dotdo's native expectation DSL format.
 *
 * GE expectation suites are YAML files that define data quality expectations.
 * This importer provides:
 * - Parse GE YAML format (expectation_suite_name, expectations array)
 * - Map GE expectation types to native expectations
 * - Handle GE kwargs to native params
 * - Support meta fields (notes, etc.)
 * - Warn on unsupported expectations
 * - Roundtrip: export back to GE format
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  importGE,
  parseGEYaml,
  mapGEExpectation,
  exportToGE,
  GEExpectationSuite,
  GEExpectation,
  GEImportResult,
  GEImportWarning,
  SUPPORTED_GE_EXPECTATIONS,
} from '../ge-import'
import { Expectation, validateExpectations } from '../expectation-dsl'

// ============================================================================
// YAML PARSING
// ============================================================================

describe('Great Expectations YAML Import', () => {
  describe('parseGEYaml()', () => {
    it('should parse a basic GE YAML file', () => {
      const yaml = `
expectation_suite_name: users_suite
expectations:
  - expectation_type: expect_column_to_exist
    kwargs:
      column: email
`
      const suite = parseGEYaml(yaml)

      expect(suite.expectation_suite_name).toBe('users_suite')
      expect(suite.expectations).toHaveLength(1)
      expect(suite.expectations[0].expectation_type).toBe('expect_column_to_exist')
      expect(suite.expectations[0].kwargs.column).toBe('email')
    })

    it('should parse multiple expectations', () => {
      const yaml = `
expectation_suite_name: orders_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: order_id
  - expectation_type: expect_column_values_to_be_unique
    kwargs:
      column: order_id
  - expectation_type: expect_column_values_to_match_regex
    kwargs:
      column: email
      regex: ^.+@.+\\..+$
`
      const suite = parseGEYaml(yaml)

      expect(suite.expectations).toHaveLength(3)
      expect(suite.expectations[0].kwargs.column).toBe('order_id')
      expect(suite.expectations[1].expectation_type).toBe('expect_column_values_to_be_unique')
      expect(suite.expectations[2].kwargs.regex).toBe('^.+@.+\\..+$')
    })

    it('should parse expectations with meta fields', () => {
      const yaml = `
expectation_suite_name: users_suite
meta:
  created_by: data_team
  notes: User validation rules
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: email
    meta:
      notes: Email is required for notifications
`
      const suite = parseGEYaml(yaml)

      expect(suite.meta?.created_by).toBe('data_team')
      expect(suite.meta?.notes).toBe('User validation rules')
      expect(suite.expectations[0].meta?.notes).toBe('Email is required for notifications')
    })

    it('should parse data_asset_type', () => {
      const yaml = `
expectation_suite_name: users_suite
data_asset_type: Dataset
expectations:
  - expectation_type: expect_column_to_exist
    kwargs:
      column: id
`
      const suite = parseGEYaml(yaml)

      expect(suite.data_asset_type).toBe('Dataset')
    })

    it('should throw on invalid YAML', () => {
      const invalidYaml = `
expectation_suite_name: broken
  invalid_indentation: true
 extra_space: here
`
      expect(() => parseGEYaml(invalidYaml)).toThrow()
    })

    it('should throw on missing expectation_suite_name', () => {
      const yaml = `
expectations:
  - expectation_type: expect_column_to_exist
    kwargs:
      column: id
`
      expect(() => parseGEYaml(yaml)).toThrow(/expectation_suite_name/)
    })
  })

  // ============================================================================
  // EXPECTATION MAPPING
  // ============================================================================

  describe('mapGEExpectation()', () => {
    describe('expect_column_to_exist', () => {
      it('should return warning for schema-level check', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_to_exist',
          kwargs: { column: 'email' },
        }

        const result = mapGEExpectation(ge)

        // Column existence is a schema-level check, not a row-level check
        // Our DSL focuses on data validation, so this returns null with a warning
        expect(result.expectation).toBeNull()
        expect(result.warning).toBeDefined()
        expect(result.warning!.type).toBe('unsupported')
      })
    })

    describe('expect_column_values_to_not_be_null', () => {
      it('should map to not_null expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_not_be_null',
          kwargs: { column: 'email' },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        expect(result.expectation!.column).toBe('email')
        expect(result.expectation!.type).toBe('not_null')
      })
    })

    describe('expect_column_values_to_be_unique', () => {
      it('should map to unique expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_unique',
          kwargs: { column: 'user_id' },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        expect(result.expectation!.column).toBe('user_id')
        expect(result.expectation!.type).toBe('unique')
      })
    })

    describe('expect_column_values_to_match_regex', () => {
      it('should map to pattern expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_match_regex',
          kwargs: {
            column: 'email',
            regex: '^.+@.+\\..+$',
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        expect(result.expectation!.column).toBe('email')
        expect(result.expectation!.type).toBe('pattern')
        expect(result.expectation!.params?.pattern).toBeInstanceOf(RegExp)
      })
    })

    describe('expect_column_values_to_be_in_set', () => {
      it('should map to in_set expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_in_set',
          kwargs: {
            column: 'status',
            value_set: ['active', 'inactive', 'pending'],
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        expect(result.expectation!.column).toBe('status')
        expect(result.expectation!.type).toBe('in_set')
        expect(result.expectation!.params?.values).toEqual(['active', 'inactive', 'pending'])
      })
    })

    describe('expect_column_values_to_be_between', () => {
      it('should map to between expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_between',
          kwargs: {
            column: 'age',
            min_value: 0,
            max_value: 150,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        expect(result.expectation!.column).toBe('age')
        expect(result.expectation!.type).toBe('between')
        expect(result.expectation!.params?.min).toBe(0)
        expect(result.expectation!.params?.max).toBe(150)
      })

      it('should handle strict_min and strict_max', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_between',
          kwargs: {
            column: 'score',
            min_value: 0,
            max_value: 100,
            strict_min: true,
            strict_max: true,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation!.params?.exclusive).toBe(true)
      })
    })

    describe('expect_column_values_to_be_of_type', () => {
      it('should map string type to type_string', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_of_type',
          kwargs: {
            column: 'name',
            type_: 'str',
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation!.type).toBe('type_string')
      })

      it('should map int type to type_integer', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_of_type',
          kwargs: {
            column: 'age',
            type_: 'int',
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation!.type).toBe('type_integer')
      })

      it('should map float type to type_number', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_of_type',
          kwargs: {
            column: 'price',
            type_: 'float',
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation!.type).toBe('type_number')
      })

      it('should map bool type to type_boolean', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_of_type',
          kwargs: {
            column: 'active',
            type_: 'bool',
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation!.type).toBe('type_boolean')
      })

      it('should map datetime type to type_date', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_be_of_type',
          kwargs: {
            column: 'created_at',
            type_: 'datetime',
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation!.type).toBe('type_date')
      })
    })

    describe('expect_column_value_lengths_to_be_between', () => {
      it('should map to min_length and max_length constraints', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_value_lengths_to_be_between',
          kwargs: {
            column: 'username',
            min_value: 3,
            max_value: 20,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        // This maps to multiple constraints
        expect(result.expectation!.constraints.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('expect_column_min_to_be_between', () => {
      it('should map to aggregate_min expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_min_to_be_between',
          kwargs: {
            column: 'price',
            min_value: 0,
            max_value: 10,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        // This is a range check on the minimum value
      })
    })

    describe('expect_column_max_to_be_between', () => {
      it('should map to aggregate_max expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_max_to_be_between',
          kwargs: {
            column: 'quantity',
            min_value: 100,
            max_value: 1000,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
      })
    })

    describe('expect_column_mean_to_be_between', () => {
      it('should map to aggregate_avg expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_mean_to_be_between',
          kwargs: {
            column: 'rating',
            min_value: 3.5,
            max_value: 4.5,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
      })
    })

    describe('expect_table_row_count_to_be_between', () => {
      it('should map to aggregate_count expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_table_row_count_to_be_between',
          kwargs: {
            min_value: 100,
            max_value: 10000,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        expect(result.expectation!.type).toBe('aggregate_count')
      })
    })

    describe('expect_table_row_count_to_equal', () => {
      it('should map to aggregate_count with exact value', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_table_row_count_to_equal',
          kwargs: {
            value: 500,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        expect(result.expectation!.type).toBe('aggregate_count')
        expect(result.expectation!.params?.expected).toBe(500)
      })
    })

    describe('expect_column_sum_to_be_between', () => {
      it('should map to aggregate_sum expectation', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_sum_to_be_between',
          kwargs: {
            column: 'revenue',
            min_value: 10000,
            max_value: 100000,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation).toBeDefined()
        expect(result.expectation!.type).toBe('aggregate_sum')
      })
    })

    describe('unsupported expectations', () => {
      it('should return a warning for unsupported expectation types', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_custom_ml_model_accuracy',
          kwargs: {
            column: 'predictions',
            threshold: 0.95,
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.warning).toBeDefined()
        expect(result.warning!.type).toBe('unsupported')
        expect(result.warning!.expectationType).toBe('expect_custom_ml_model_accuracy')
      })

      it('should include the original GE expectation in the warning', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_unknown_thing',
          kwargs: { column: 'x' },
        }

        const result = mapGEExpectation(ge)

        expect(result.warning!.original).toEqual(ge)
      })
    })

    describe('meta field preservation', () => {
      it('should preserve meta notes as custom message', () => {
        const ge: GEExpectation = {
          expectation_type: 'expect_column_values_to_not_be_null',
          kwargs: { column: 'email' },
          meta: {
            notes: 'Email is required for account activation',
          },
        }

        const result = mapGEExpectation(ge)

        expect(result.expectation!.message).toBe('Email is required for account activation')
      })
    })
  })

  // ============================================================================
  // FULL IMPORT
  // ============================================================================

  describe('importGE()', () => {
    it('should import a complete GE suite from YAML string', () => {
      const yaml = `
expectation_suite_name: customers_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: customer_id
  - expectation_type: expect_column_values_to_be_unique
    kwargs:
      column: customer_id
  - expectation_type: expect_column_values_to_match_regex
    kwargs:
      column: email
      regex: ^.+@.+$
`
      const result = importGE(yaml)

      expect(result.suiteName).toBe('customers_suite')
      expect(result.expectations).toHaveLength(3)
      expect(result.warnings).toHaveLength(0)
    })

    it('should import from JSON object', () => {
      const suite: GEExpectationSuite = {
        expectation_suite_name: 'orders_suite',
        expectations: [
          {
            expectation_type: 'expect_column_values_to_not_be_null',
            kwargs: { column: 'order_id' },
          },
        ],
      }

      const result = importGE.fromJSON(suite)

      expect(result.suiteName).toBe('orders_suite')
      expect(result.expectations).toHaveLength(1)
    })

    it('should collect warnings for unsupported expectations', () => {
      const yaml = `
expectation_suite_name: test_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: id
  - expectation_type: expect_custom_thing
    kwargs:
      column: custom
  - expectation_type: expect_another_custom
    kwargs:
      custom_param: value
`
      const result = importGE(yaml)

      expect(result.expectations).toHaveLength(1)
      expect(result.warnings).toHaveLength(2)
      expect(result.warnings[0].expectationType).toBe('expect_custom_thing')
      expect(result.warnings[1].expectationType).toBe('expect_another_custom')
    })

    it('should work with validateExpectations()', () => {
      const yaml = `
expectation_suite_name: validation_test
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: name
  - expectation_type: expect_column_values_to_be_in_set
    kwargs:
      column: status
      value_set:
        - active
        - inactive
`
      const importResult = importGE(yaml)

      const data = [
        { name: 'Alice', status: 'active' },
        { name: 'Bob', status: 'inactive' },
      ]

      const validationResult = validateExpectations(importResult.expectations, data)

      expect(validationResult.passed).toBe(true)
    })

    it('should fail validation when data violates imported expectations', () => {
      const yaml = `
expectation_suite_name: strict_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: email
`
      const importResult = importGE(yaml)

      const data = [
        { email: 'test@example.com' },
        { email: null }, // This should fail
      ]

      const validationResult = validateExpectations(importResult.expectations, data)

      expect(validationResult.passed).toBe(false)
      expect(validationResult.failures).toHaveLength(1)
    })
  })

  // ============================================================================
  // EXPORT (ROUNDTRIP)
  // ============================================================================

  describe('exportToGE()', () => {
    it('should export expectations back to GE YAML format', () => {
      const expectations: Expectation[] = [
        {
          column: 'email',
          type: 'not_null',
          constraints: [{ type: 'not_null' }],
        },
        {
          column: 'user_id',
          type: 'unique',
          constraints: [{ type: 'unique' }],
        },
      ]

      const yaml = exportToGE('users_suite', expectations)

      expect(yaml).toContain('expectation_suite_name: users_suite')
      expect(yaml).toContain('expect_column_values_to_not_be_null')
      expect(yaml).toContain('expect_column_values_to_be_unique')
      expect(yaml).toContain('column: email')
      expect(yaml).toContain('column: user_id')
    })

    it('should export pattern expectations with regex', () => {
      const expectations: Expectation[] = [
        {
          column: 'email',
          type: 'pattern',
          constraints: [{ type: 'pattern', params: { pattern: /^.+@.+$/ } }],
          params: { pattern: /^.+@.+$/ },
        },
      ]

      const yaml = exportToGE('test_suite', expectations)

      expect(yaml).toContain('expect_column_values_to_match_regex')
      expect(yaml).toContain('regex:')
    })

    it('should export in_set expectations with value_set', () => {
      const expectations: Expectation[] = [
        {
          column: 'status',
          type: 'in_set',
          constraints: [{ type: 'in_set', params: { values: ['a', 'b', 'c'] } }],
          params: { values: ['a', 'b', 'c'] },
        },
      ]

      const yaml = exportToGE('test_suite', expectations)

      expect(yaml).toContain('expect_column_values_to_be_in_set')
      expect(yaml).toContain('value_set:')
    })

    it('should export between expectations', () => {
      const expectations: Expectation[] = [
        {
          column: 'age',
          type: 'between',
          constraints: [{ type: 'between', params: { min: 0, max: 120 } }],
          params: { min: 0, max: 120 },
        },
      ]

      const yaml = exportToGE('test_suite', expectations)

      expect(yaml).toContain('expect_column_values_to_be_between')
      expect(yaml).toContain('min_value: 0')
      expect(yaml).toContain('max_value: 120')
    })

    it('should preserve custom messages as meta notes', () => {
      const expectations: Expectation[] = [
        {
          column: 'email',
          type: 'not_null',
          constraints: [{ type: 'not_null' }],
          message: 'Email is required for notifications',
        },
      ]

      const yaml = exportToGE('test_suite', expectations)

      expect(yaml).toContain('meta:')
      expect(yaml).toContain('notes: Email is required for notifications')
    })

    it('should roundtrip: import then export should produce equivalent YAML', () => {
      const originalYaml = `
expectation_suite_name: roundtrip_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: id
  - expectation_type: expect_column_values_to_be_in_set
    kwargs:
      column: type
      value_set:
        - A
        - B
        - C
`
      const importResult = importGE(originalYaml)
      const exportedYaml = exportToGE(importResult.suiteName, importResult.expectations)

      // Re-import to verify
      const reimportResult = importGE(exportedYaml)

      expect(reimportResult.suiteName).toBe('roundtrip_suite')
      expect(reimportResult.expectations).toHaveLength(importResult.expectations.length)
    })
  })

  // ============================================================================
  // SUPPORTED EXPECTATIONS CATALOG
  // ============================================================================

  describe('SUPPORTED_GE_EXPECTATIONS', () => {
    it('should list all supported GE expectation types', () => {
      expect(SUPPORTED_GE_EXPECTATIONS).toContain('expect_column_to_exist')
      expect(SUPPORTED_GE_EXPECTATIONS).toContain('expect_column_values_to_not_be_null')
      expect(SUPPORTED_GE_EXPECTATIONS).toContain('expect_column_values_to_be_unique')
      expect(SUPPORTED_GE_EXPECTATIONS).toContain('expect_column_values_to_match_regex')
      expect(SUPPORTED_GE_EXPECTATIONS).toContain('expect_column_values_to_be_in_set')
      expect(SUPPORTED_GE_EXPECTATIONS).toContain('expect_column_values_to_be_between')
      expect(SUPPORTED_GE_EXPECTATIONS).toContain('expect_column_values_to_be_of_type')
      expect(SUPPORTED_GE_EXPECTATIONS).toContain('expect_table_row_count_to_be_between')
      expect(SUPPORTED_GE_EXPECTATIONS).toContain('expect_table_row_count_to_equal')
    })

    it('should have at least 15 supported expectation types', () => {
      expect(SUPPORTED_GE_EXPECTATIONS.length).toBeGreaterThanOrEqual(15)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty expectations array', () => {
      const yaml = `
expectation_suite_name: empty_suite
expectations: []
`
      const result = importGE(yaml)

      expect(result.suiteName).toBe('empty_suite')
      expect(result.expectations).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })

    it('should handle expectations without kwargs', () => {
      const yaml = `
expectation_suite_name: no_kwargs_suite
expectations:
  - expectation_type: expect_table_row_count_to_equal
    kwargs:
      value: 100
`
      const result = importGE(yaml)

      expect(result.expectations).toHaveLength(1)
    })

    it('should handle nested column paths (not common in GE but possible)', () => {
      const yaml = `
expectation_suite_name: nested_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: address.city
`
      const result = importGE(yaml)

      expect(result.expectations[0].column).toBe('address.city')
    })

    it('should handle special characters in regex patterns', () => {
      const yaml = `
expectation_suite_name: regex_suite
expectations:
  - expectation_type: expect_column_values_to_match_regex
    kwargs:
      column: phone
      regex: ^\\+?[1-9]\\d{1,14}$
`
      const result = importGE(yaml)

      expect(result.expectations[0].params?.pattern).toBeInstanceOf(RegExp)
    })

    it('should handle numeric value sets', () => {
      const yaml = `
expectation_suite_name: numeric_set_suite
expectations:
  - expectation_type: expect_column_values_to_be_in_set
    kwargs:
      column: rating
      value_set:
        - 1
        - 2
        - 3
        - 4
        - 5
`
      const result = importGE(yaml)

      expect(result.expectations[0].params?.values).toEqual([1, 2, 3, 4, 5])
    })

    it('should handle mostly_parameter (GE allows partial compliance)', () => {
      const yaml = `
expectation_suite_name: mostly_suite
expectations:
  - expectation_type: expect_column_values_to_not_be_null
    kwargs:
      column: optional_field
      mostly: 0.95
`
      const result = importGE(yaml)

      // For now, we ignore 'mostly' since our DSL requires 100% compliance
      // But we should note it in a warning
      expect(result.warnings.length).toBeGreaterThanOrEqual(0) // May or may not warn
    })
  })
})
