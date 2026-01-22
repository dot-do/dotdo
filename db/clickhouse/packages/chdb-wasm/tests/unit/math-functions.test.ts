/**
 * Math Functions - RED Phase Tests
 *
 * These tests verify that ClickHouse math functions work correctly
 * when executed through the WASM executor.
 *
 * Currently, many math functions return null because they're not
 * implemented in the bundled executor.wasm. These tests document
 * the expected behavior for when full ClickHouse WASM is available.
 *
 * Test Coverage:
 * - Basic math: abs, sign, round, floor, ceil, trunc
 * - Roots and powers: sqrt, cbrt, pow, exp, exp2, exp10
 * - Logarithms: log, log2, log10, ln
 * - Trigonometry: sin, cos, tan, asin, acos, atan, atan2
 * - Constants: e(), pi()
 * - Rounding functions with precision
 *
 * TDD Phase: RED
 * - These tests document expected behavior
 * - Tests may be skipped if WASM doesn't support function yet
 *
 * @see https://clickhouse.com/docs/en/sql-reference/functions/math-functions
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createBundledExecutor } from '../../src/bundled-executor';
import type { SqlExecutor } from '../../src/http-query-handler';

/**
 * Helper function to get the data row (skipping the header row)
 * The executor returns TabSeparatedWithNames format:
 * - Row 0 contains header names as quoted strings like "result"
 * - Row 1 contains actual data values
 */
function getDataRow(result: { data: Array<Record<string, unknown>> }): Record<string, unknown> | null {
  if (result.data.length === 0) return null;
  // If we have 2+ rows and first row looks like a header, use row 1
  if (result.data.length >= 2) {
    const firstValue = Object.values(result.data[0])[0];
    if (typeof firstValue === 'string' && firstValue.startsWith('"')) {
      return result.data[1];
    }
  }
  return result.data[0];
}

/**
 * Helper to execute a query and extract the first column value
 */
async function executeAndGetValue(executor: SqlExecutor, sql: string): Promise<unknown> {
  const result = await executor.execute(sql);
  const dataRow = getDataRow(result);
  if (!dataRow) return null;
  const firstColumn = Object.keys(dataRow)[0];
  return dataRow[firstColumn];
}

/**
 * Helper to check if a value is close to expected (for floating point)
 */
function isClose(actual: unknown, expected: number, tolerance = 0.0001): boolean {
  if (typeof actual !== 'number') return false;
  return Math.abs(actual - expected) < tolerance;
}

describe('Math Functions - RED Phase', () => {
  let executor: SqlExecutor;

  beforeAll(async () => {
    executor = await createBundledExecutor();
  });

  describe('Basic Math Functions', () => {
    describe('abs() - Absolute Value', () => {
      it('should return absolute value of positive number', async () => {
        const result = await executeAndGetValue(executor, 'SELECT abs(5) AS result');
        expect(result).toBe(5);
      });

      it('should return absolute value of negative number', async () => {
        const result = await executeAndGetValue(executor, 'SELECT abs(-5) AS result');
        expect(result).toBe(5);
      });

      it('should return 0 for abs(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT abs(0) AS result');
        expect(result).toBe(0);
      });

      it('should handle floating point numbers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT abs(-3.14) AS result');
        expect(isClose(result, 3.14)).toBe(true);
      });
    });

    describe('sign() - Sign Function', () => {
      it('should return 1 for positive numbers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sign(42) AS result');
        expect(result).toBe(1);
      });

      it('should return -1 for negative numbers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sign(-42) AS result');
        expect(result).toBe(-1);
      });

      it('should return 0 for zero', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sign(0) AS result');
        expect(result).toBe(0);
      });
    });
  });

  describe('Rounding Functions', () => {
    describe('round() - Round to Nearest', () => {
      it('should round down when decimal < 0.5', async () => {
        const result = await executeAndGetValue(executor, 'SELECT round(3.4) AS result');
        expect(result).toBe(3);
      });

      it('should round up when decimal >= 0.5', async () => {
        const result = await executeAndGetValue(executor, 'SELECT round(3.5) AS result');
        expect(result).toBe(4);
      });

      it('should round negative numbers correctly', async () => {
        const result = await executeAndGetValue(executor, 'SELECT round(-3.7) AS result');
        expect(result).toBe(-4);
      });

      it('should support precision parameter', async () => {
        const result = await executeAndGetValue(executor, 'SELECT round(3.14159, 2) AS result');
        expect(isClose(result, 3.14)).toBe(true);
      });
    });

    describe('floor() - Round Down', () => {
      it('should round down positive numbers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT floor(3.7) AS result');
        expect(result).toBe(3);
      });

      it('should round down negative numbers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT floor(-3.2) AS result');
        expect(result).toBe(-4);
      });

      it('should return same value for integers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT floor(5) AS result');
        expect(result).toBe(5);
      });
    });

    describe('ceil() - Round Up', () => {
      it('should round up positive numbers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT ceil(3.2) AS result');
        expect(result).toBe(4);
      });

      it('should round up negative numbers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT ceil(-3.7) AS result');
        expect(result).toBe(-3);
      });

      it('should return same value for integers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT ceil(5) AS result');
        expect(result).toBe(5);
      });
    });

    describe('trunc() - Truncate Toward Zero', () => {
      it('should truncate positive numbers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT trunc(3.9) AS result');
        expect(result).toBe(3);
      });

      it('should truncate negative numbers toward zero', async () => {
        const result = await executeAndGetValue(executor, 'SELECT trunc(-3.9) AS result');
        expect(result).toBe(-3);
      });
    });
  });

  describe('Root Functions', () => {
    describe('sqrt() - Square Root', () => {
      it('should calculate square root of perfect square', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sqrt(16) AS result');
        expect(result).toBe(4);
      });

      it('should calculate square root of non-perfect square', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sqrt(2) AS result');
        expect(isClose(result, 1.41421356)).toBe(true);
      });

      it('should return 0 for sqrt(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sqrt(0) AS result');
        expect(result).toBe(0);
      });

      it('should return 1 for sqrt(1)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sqrt(1) AS result');
        expect(result).toBe(1);
      });
    });

    describe('cbrt() - Cube Root', () => {
      it('should calculate cube root of perfect cube', async () => {
        const result = await executeAndGetValue(executor, 'SELECT cbrt(27) AS result');
        expect(result).toBe(3);
      });

      it('should handle negative numbers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT cbrt(-8) AS result');
        expect(result).toBe(-2);
      });
    });
  });

  describe('Power and Exponential Functions', () => {
    describe('pow() / power() - Exponentiation', () => {
      it('should calculate power of integers', async () => {
        const result = await executeAndGetValue(executor, 'SELECT pow(2, 10) AS result');
        expect(result).toBe(1024);
      });

      it('should handle fractional exponents', async () => {
        const result = await executeAndGetValue(executor, 'SELECT pow(4, 0.5) AS result');
        expect(result).toBe(2);
      });

      it('should handle negative exponents', async () => {
        const result = await executeAndGetValue(executor, 'SELECT pow(2, -1) AS result');
        expect(result).toBe(0.5);
      });

      it('should return 1 for any base to power 0', async () => {
        const result = await executeAndGetValue(executor, 'SELECT pow(5, 0) AS result');
        expect(result).toBe(1);
      });
    });

    describe('exp() - e^x', () => {
      it('should calculate e^1', async () => {
        const result = await executeAndGetValue(executor, 'SELECT exp(1) AS result');
        expect(isClose(result, 2.71828)).toBe(true);
      });

      it('should return 1 for exp(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT exp(0) AS result');
        expect(result).toBe(1);
      });
    });

    describe('exp2() - 2^x', () => {
      it('should calculate 2^3', async () => {
        const result = await executeAndGetValue(executor, 'SELECT exp2(3) AS result');
        expect(result).toBe(8);
      });

      it('should return 1 for exp2(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT exp2(0) AS result');
        expect(result).toBe(1);
      });
    });

    describe('exp10() - 10^x', () => {
      it('should calculate 10^2', async () => {
        const result = await executeAndGetValue(executor, 'SELECT exp10(2) AS result');
        expect(result).toBe(100);
      });

      it('should return 1 for exp10(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT exp10(0) AS result');
        expect(result).toBe(1);
      });
    });
  });

  describe('Logarithm Functions', () => {
    describe('log() / ln() - Natural Logarithm', () => {
      it('should calculate ln(e())', async () => {
        const result = await executeAndGetValue(executor, 'SELECT log(exp(1)) AS result');
        expect(isClose(result, 1)).toBe(true);
      });

      it('should return 0 for log(1)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT log(1) AS result');
        expect(result).toBe(0);
      });
    });

    describe('log2() - Base-2 Logarithm', () => {
      it('should calculate log2(8)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT log2(8) AS result');
        expect(result).toBe(3);
      });

      it('should calculate log2(1024)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT log2(1024) AS result');
        expect(result).toBe(10);
      });
    });

    describe('log10() - Base-10 Logarithm', () => {
      it('should calculate log10(100)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT log10(100) AS result');
        expect(result).toBe(2);
      });

      it('should calculate log10(1000)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT log10(1000) AS result');
        expect(result).toBe(3);
      });
    });
  });

  describe('Mathematical Constants', () => {
    describe('e() - Euler\'s Number', () => {
      it('should return e constant', async () => {
        const result = await executeAndGetValue(executor, 'SELECT e() AS result');
        expect(isClose(result, 2.71828)).toBe(true);
      });
    });

    describe('pi() - Pi Constant', () => {
      it('should return pi constant', async () => {
        const result = await executeAndGetValue(executor, 'SELECT pi() AS result');
        expect(isClose(result, 3.14159)).toBe(true);
      });
    });
  });

  describe('Trigonometric Functions', () => {
    describe('sin() - Sine', () => {
      it('should calculate sin(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sin(0) AS result');
        expect(result).toBe(0);
      });

      it('should calculate sin(pi()/2)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sin(pi()/2) AS result');
        expect(isClose(result, 1)).toBe(true);
      });
    });

    describe('cos() - Cosine', () => {
      it('should calculate cos(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT cos(0) AS result');
        expect(result).toBe(1);
      });

      it('should calculate cos(pi())', async () => {
        const result = await executeAndGetValue(executor, 'SELECT cos(pi()) AS result');
        expect(isClose(result, -1)).toBe(true);
      });
    });

    describe('tan() - Tangent', () => {
      it('should calculate tan(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT tan(0) AS result');
        expect(result).toBe(0);
      });

      it('should calculate tan(pi()/4)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT tan(pi()/4) AS result');
        expect(isClose(result, 1)).toBe(true);
      });
    });

    describe('asin() - Arc Sine', () => {
      it('should calculate asin(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT asin(0) AS result');
        expect(result).toBe(0);
      });

      it('should calculate asin(1)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT asin(1) AS result');
        expect(isClose(result, 1.5708)).toBe(true); // pi/2
      });
    });

    describe('acos() - Arc Cosine', () => {
      it('should calculate acos(1)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT acos(1) AS result');
        expect(result).toBe(0);
      });

      it('should calculate acos(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT acos(0) AS result');
        expect(isClose(result, 1.5708)).toBe(true); // pi/2
      });
    });

    describe('atan() - Arc Tangent', () => {
      it('should calculate atan(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT atan(0) AS result');
        expect(result).toBe(0);
      });

      it('should calculate atan(1)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT atan(1) AS result');
        expect(isClose(result, 0.7854)).toBe(true); // pi/4
      });
    });

    describe('atan2() - Arc Tangent of y/x', () => {
      it('should calculate atan2(1, 1)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT atan2(1, 1) AS result');
        expect(isClose(result, 0.7854)).toBe(true); // pi/4
      });

      it('should calculate atan2(0, 1)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT atan2(0, 1) AS result');
        expect(result).toBe(0);
      });
    });
  });

  describe('Hyperbolic Functions', () => {
    describe('sinh() - Hyperbolic Sine', () => {
      it('should calculate sinh(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT sinh(0) AS result');
        expect(result).toBe(0);
      });
    });

    describe('cosh() - Hyperbolic Cosine', () => {
      it('should calculate cosh(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT cosh(0) AS result');
        expect(result).toBe(1);
      });
    });

    describe('tanh() - Hyperbolic Tangent', () => {
      it('should calculate tanh(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT tanh(0) AS result');
        expect(result).toBe(0);
      });
    });
  });

  describe('Other Math Functions', () => {
    describe('degrees() - Radians to Degrees', () => {
      it('should convert pi to 180 degrees', async () => {
        const result = await executeAndGetValue(executor, 'SELECT degrees(pi()) AS result');
        expect(isClose(result, 180)).toBe(true);
      });
    });

    describe('radians() - Degrees to Radians', () => {
      it('should convert 180 degrees to pi', async () => {
        const result = await executeAndGetValue(executor, 'SELECT radians(180) AS result');
        expect(isClose(result, 3.14159)).toBe(true);
      });
    });

    describe('erf() - Error Function', () => {
      it('should calculate erf(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT erf(0) AS result');
        expect(result).toBe(0);
      });
    });

    describe('erfc() - Complementary Error Function', () => {
      it('should calculate erfc(0)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT erfc(0) AS result');
        expect(result).toBe(1);
      });
    });

    describe('lgamma() - Log Gamma Function', () => {
      it('should calculate lgamma(1)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT lgamma(1) AS result');
        expect(result).toBe(0);
      });
    });

    describe('tgamma() - Gamma Function', () => {
      it('should calculate tgamma(1)', async () => {
        const result = await executeAndGetValue(executor, 'SELECT tgamma(1) AS result');
        expect(result).toBe(1);
      });

      it('should calculate tgamma(5) = 4!', async () => {
        const result = await executeAndGetValue(executor, 'SELECT tgamma(5) AS result');
        expect(result).toBe(24);
      });
    });
  });

  describe('Compound Expressions', () => {
    it('should calculate Pythagorean theorem', async () => {
      const result = await executeAndGetValue(executor, 'SELECT sqrt(pow(3, 2) + pow(4, 2)) AS result');
      expect(result).toBe(5);
    });

    it('should calculate circumference from diameter', async () => {
      const result = await executeAndGetValue(executor, 'SELECT pi() * 10 AS result');
      expect(isClose(result, 31.4159)).toBe(true);
    });

    it('should calculate compound interest formula', async () => {
      // P * (1 + r)^n where P=1000, r=0.05, n=10
      const result = await executeAndGetValue(
        executor,
        'SELECT 1000 * pow(1.05, 10) AS result'
      );
      expect(isClose(result, 1628.89, 0.01)).toBe(true);
    });

    it('should calculate normal distribution PDF at x=0', async () => {
      // PDF(0) = 1/sqrt(2*pi) * e^(-0.5*0^2) = 1/sqrt(2*pi)
      const result = await executeAndGetValue(
        executor,
        'SELECT 1 / sqrt(2 * pi()) AS result'
      );
      expect(isClose(result, 0.3989)).toBe(true);
    });
  });
});
