/**
 * Math & Control Commands Tests - RED Phase
 *
 * Comprehensive tests for math and control commands:
 * - bc: arbitrary precision calculator
 * - expr: expression evaluator
 * - seq: sequence generator
 * - shuf: shuffle/randomize
 * - sleep: delay execution
 * - timeout: run with time limit
 *
 * These tests should FAIL initially as the implementations don't exist yet.
 *
 * @module bashx/do/commands/math-control.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TieredExecutor, type TieredExecutorConfig } from '../tiered-executor.js'

// ============================================================================
// TEST SETUP
// ============================================================================

/**
 * Create a TieredExecutor configured for native Tier 1 execution.
 * These commands should be handled natively in-Worker.
 */
function createMathControlExecutor(): TieredExecutor {
  const config: TieredExecutorConfig = {
    // No sandbox - we want these to fail if not implemented natively
    preferFaster: true,
    defaultTimeout: 5000,
  }
  return new TieredExecutor(config)
}

// ============================================================================
// BC - ARBITRARY PRECISION CALCULATOR
// ============================================================================

describe('bc - Arbitrary Precision Calculator', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createMathControlExecutor()
  })

  describe('basic arithmetic', () => {
    it('should perform addition', async () => {
      const result = await executor.execute('echo "2+2" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('4')
    })

    it('should perform subtraction', async () => {
      const result = await executor.execute('echo "10-3" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('7')
    })

    it('should perform multiplication', async () => {
      const result = await executor.execute('echo "6*7" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('42')
    })

    it('should perform integer division', async () => {
      const result = await executor.execute('echo "10/3" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3')
    })

    it('should perform modulo operation', async () => {
      const result = await executor.execute('echo "17%5" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('2')
    })

    it('should handle negative numbers', async () => {
      const result = await executor.execute('echo "-5+3" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('-2')
    })

    it('should handle parentheses for order of operations', async () => {
      const result = await executor.execute('echo "(2+3)*4" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('20')
    })

    it('should handle multiple operations', async () => {
      const result = await executor.execute('echo "2+3*4-5" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('9')
    })
  })

  describe('decimal precision with scale', () => {
    it('should use scale for decimal division', async () => {
      const result = await executor.execute('echo "scale=2; 10/3" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3.33')
    })

    it('should handle higher precision', async () => {
      const result = await executor.execute('echo "scale=10; 1/7" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('.1428571428')
    })

    it('should preserve scale across operations', async () => {
      const result = await executor.execute('echo "scale=4; 22/7" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3.1428')
    })

    it('should handle scale=0 for integer math', async () => {
      const result = await executor.execute('echo "scale=0; 10/3" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3')
    })
  })

  describe('exponentiation', () => {
    it('should calculate powers', async () => {
      const result = await executor.execute('echo "2^10" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1024')
    })

    it('should handle power of zero', async () => {
      const result = await executor.execute('echo "5^0" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    })

    it('should handle large exponents', async () => {
      const result = await executor.execute('echo "2^20" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1048576')
    })

    it('should handle negative exponents with scale', async () => {
      const result = await executor.execute('echo "scale=4; 2^-2" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('.2500')
    })
  })

  describe('math library (-l)', () => {
    it('should calculate square root', async () => {
      const result = await executor.execute('echo "sqrt(16)" | bc -l')
      expect(result.exitCode).toBe(0)
      expect(parseFloat(result.stdout.trim())).toBeCloseTo(4.0, 5)
    })

    it('should calculate sine', async () => {
      const result = await executor.execute('echo "s(0)" | bc -l')
      expect(result.exitCode).toBe(0)
      expect(parseFloat(result.stdout.trim())).toBeCloseTo(0, 5)
    })

    it('should calculate cosine', async () => {
      const result = await executor.execute('echo "c(0)" | bc -l')
      expect(result.exitCode).toBe(0)
      expect(parseFloat(result.stdout.trim())).toBeCloseTo(1, 5)
    })

    it('should calculate arctangent', async () => {
      const result = await executor.execute('echo "a(1)" | bc -l')
      expect(result.exitCode).toBe(0)
      // atan(1) = pi/4 = 0.785398...
      expect(parseFloat(result.stdout.trim())).toBeCloseTo(0.785398, 4)
    })

    it('should calculate natural log', async () => {
      const result = await executor.execute('echo "l(2.71828)" | bc -l')
      expect(result.exitCode).toBe(0)
      expect(parseFloat(result.stdout.trim())).toBeCloseTo(1, 2)
    })

    it('should calculate e^x', async () => {
      const result = await executor.execute('echo "e(1)" | bc -l')
      expect(result.exitCode).toBe(0)
      expect(parseFloat(result.stdout.trim())).toBeCloseTo(2.71828, 4)
    })

    it('should set scale to 20 by default with -l', async () => {
      const result = await executor.execute('echo "1/3" | bc -l')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim().length).toBeGreaterThanOrEqual(20)
    })
  })

  describe('base conversion', () => {
    it('should convert hex to decimal (ibase=16)', async () => {
      const result = await executor.execute('echo "ibase=16; FF" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('255')
    })

    it('should convert binary to decimal (ibase=2)', async () => {
      const result = await executor.execute('echo "ibase=2; 1010" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('10')
    })

    it('should output in binary (obase=2)', async () => {
      const result = await executor.execute('echo "obase=2; 10" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1010')
    })

    it('should output in hex (obase=16)', async () => {
      const result = await executor.execute('echo "obase=16; 255" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('FF')
    })

    it('should convert hex to binary', async () => {
      const result = await executor.execute('echo "ibase=16; obase=2; A" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1010')
    })

    it('should handle octal (base 8)', async () => {
      const result = await executor.execute('echo "ibase=8; 77" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('63')
    })
  })

  describe('variables and multi-line', () => {
    it('should support variable assignment', async () => {
      const result = await executor.execute('echo "x=5; x*2" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('10')
    })

    it('should support multiple statements with semicolons', async () => {
      const result = await executor.execute('echo "a=3; b=4; a+b" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('7')
    })

    it('should handle multi-line input', async () => {
      const result = await executor.execute('printf "x=10\\nx+5\\n" | bc')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('15')
    })
  })

  describe('error handling', () => {
    it('should return error for division by zero', async () => {
      const result = await executor.execute('echo "1/0" | bc')
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('divide by zero')
    })

    it('should handle syntax errors', async () => {
      const result = await executor.execute('echo "2++2" | bc')
      expect(result.exitCode).not.toBe(0)
    })

    it('should handle sqrt of negative number', async () => {
      const result = await executor.execute('echo "sqrt(-1)" | bc -l')
      expect(result.exitCode).not.toBe(0)
    })
  })
})

// ============================================================================
// EXPR - EXPRESSION EVALUATOR
// ============================================================================

describe('expr - Expression Evaluator', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createMathControlExecutor()
  })

  describe('arithmetic operations', () => {
    it('should add numbers', async () => {
      const result = await executor.execute('expr 2 + 2')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('4')
    })

    it('should subtract numbers', async () => {
      const result = await executor.execute('expr 10 - 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('7')
    })

    it('should multiply numbers (escaped asterisk)', async () => {
      const result = await executor.execute('expr 6 \\* 7')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('42')
    })

    it('should perform integer division', async () => {
      const result = await executor.execute('expr 10 / 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3')
    })

    it('should perform modulo', async () => {
      const result = await executor.execute('expr 17 % 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('2')
    })

    it('should handle negative numbers', async () => {
      const result = await executor.execute('expr -5 + 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('-2')
    })

    it('should use parentheses for grouping (escaped)', async () => {
      const result = await executor.execute('expr \\( 2 + 3 \\) \\* 4')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('20')
    })
  })

  describe('comparison operations', () => {
    it('should compare equality (returns 1 for true)', async () => {
      const result = await executor.execute('expr 5 = 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    })

    it('should compare inequality', async () => {
      const result = await executor.execute('expr 5 != 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    })

    it('should compare less than', async () => {
      const result = await executor.execute('expr 3 \\< 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    })

    it('should compare greater than', async () => {
      const result = await executor.execute('expr 5 \\> 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    })

    it('should compare less than or equal', async () => {
      const result = await executor.execute('expr 5 \\<= 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    })

    it('should compare greater than or equal', async () => {
      const result = await executor.execute('expr 5 \\>= 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    })

    it('should return 0 for false comparisons', async () => {
      const result = await executor.execute('expr 3 \\> 5')
      expect(result.exitCode).toBe(1) // expr returns exit code 1 for 0 result
      expect(result.stdout.trim()).toBe('0')
    })
  })

  describe('string operations', () => {
    it('should get string length with : operator', async () => {
      const result = await executor.execute('expr "hello" : ".*"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('5')
    })

    it('should extract substring', async () => {
      const result = await executor.execute('expr substr "hello" 1 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hel')
    })

    it('should extract substring from middle', async () => {
      const result = await executor.execute('expr substr "hello world" 7 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('world')
    })

    it('should find character index', async () => {
      const result = await executor.execute('expr index "hello" "e"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('2')
    })

    it('should find first matching character from set', async () => {
      const result = await executor.execute('expr index "hello" "lo"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3') // 'l' is at position 3
    })

    it('should return 0 for character not found', async () => {
      const result = await executor.execute('expr index "hello" "x"')
      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe('0')
    })

    it('should get string length with length keyword', async () => {
      const result = await executor.execute('expr length "hello"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('5')
    })
  })

  describe('pattern matching', () => {
    it('should match pattern and return matched length', async () => {
      const result = await executor.execute('expr match "hello" "h.*"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('5')
    })

    it('should return 0 for non-matching pattern', async () => {
      const result = await executor.execute('expr match "hello" "x.*"')
      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe('0')
    })

    it('should capture groups', async () => {
      const result = await executor.execute('expr match "hello123" "\\(.*\\)123"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
    })

    it('should match anchored at start', async () => {
      const result = await executor.execute('expr "hello" : "hel"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3')
    })

    it('should not match if not anchored at start', async () => {
      const result = await executor.execute('expr "hello" : "ell"')
      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe('0')
    })
  })

  describe('logical operations', () => {
    it('should evaluate OR (returns first non-zero)', async () => {
      const result = await executor.execute('expr 0 \\| 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('5')
    })

    it('should evaluate AND (returns first if second is non-zero)', async () => {
      const result = await executor.execute('expr 3 \\& 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('3')
    })

    it('should short-circuit AND with zero', async () => {
      const result = await executor.execute('expr 0 \\& 5')
      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe('0')
    })
  })

  describe('exit codes', () => {
    it('should return exit code 0 for non-zero result', async () => {
      const result = await executor.execute('expr 1 + 1')
      expect(result.exitCode).toBe(0)
    })

    it('should return exit code 1 for zero/null result', async () => {
      const result = await executor.execute('expr 1 - 1')
      expect(result.exitCode).toBe(1)
    })

    it('should return exit code 2 for invalid expression', async () => {
      const result = await executor.execute('expr invalid +')
      expect(result.exitCode).toBe(2)
    })
  })
})

// ============================================================================
// SEQ - SEQUENCE GENERATOR
// ============================================================================

describe('seq - Sequence Generator', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createMathControlExecutor()
  })

  describe('simple sequences', () => {
    it('should generate 1 to N', async () => {
      const result = await executor.execute('seq 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1\n2\n3\n4\n5')
    })

    it('should generate 1 to 1', async () => {
      const result = await executor.execute('seq 1')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    })

    it('should generate 1 to 10', async () => {
      const result = await executor.execute('seq 10')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(10)
      expect(lines[0]).toBe('1')
      expect(lines[9]).toBe('10')
    })
  })

  describe('range sequences', () => {
    it('should generate from first to last', async () => {
      const result = await executor.execute('seq 2 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('2\n3\n4\n5')
    })

    it('should generate from 0', async () => {
      const result = await executor.execute('seq 0 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('0\n1\n2\n3')
    })

    it('should generate negative numbers', async () => {
      const result = await executor.execute('seq -3 0')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('-3\n-2\n-1\n0')
    })

    it('should handle same start and end', async () => {
      const result = await executor.execute('seq 5 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('5')
    })
  })

  describe('step sequences', () => {
    it('should step by increment', async () => {
      const result = await executor.execute('seq 1 2 10')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1\n3\n5\n7\n9')
    })

    it('should step by 5', async () => {
      const result = await executor.execute('seq 0 5 20')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('0\n5\n10\n15\n20')
    })

    it('should handle negative step (decreasing)', async () => {
      const result = await executor.execute('seq 10 -2 0')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('10\n8\n6\n4\n2\n0')
    })

    it('should count down with implicit negative step', async () => {
      const result = await executor.execute('seq 5 -1 1')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('5\n4\n3\n2\n1')
    })
  })

  describe('equal width (-w)', () => {
    it('should pad with zeros', async () => {
      const result = await executor.execute('seq -w 1 10')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('01\n02\n03\n04\n05\n06\n07\n08\n09\n10')
    })

    it('should pad larger range', async () => {
      const result = await executor.execute('seq -w 1 100')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines[0]).toBe('001')
      expect(lines[99]).toBe('100')
    })

    it('should handle negative with padding', async () => {
      const result = await executor.execute('seq -w -5 5')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines[0]).toBe('-5')
      expect(lines[10]).toBe('05')
    })
  })

  describe('custom separator (-s)', () => {
    it('should use comma separator', async () => {
      const result = await executor.execute('seq -s ", " 5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1, 2, 3, 4, 5')
    })

    it('should use space separator', async () => {
      const result = await executor.execute('seq -s " " 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1 2 3')
    })

    it('should use tab separator', async () => {
      const result = await executor.execute('seq -s "\\t" 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1\t2\t3')
    })

    it('should use custom string separator', async () => {
      const result = await executor.execute('seq -s " -> " 4')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1 -> 2 -> 3 -> 4')
    })
  })

  describe('format string (-f)', () => {
    it('should format with decimals', async () => {
      const result = await executor.execute('seq -f "%.2f" 1 0.5 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1.00\n1.50\n2.00\n2.50\n3.00')
    })

    it('should format with prefix', async () => {
      const result = await executor.execute('seq -f "item%03g" 1 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('item001\nitem002\nitem003')
    })

    it('should format as percentage', async () => {
      const result = await executor.execute('seq -f "%g%%" 10 10 30')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('10%\n20%\n30%')
    })

    it('should format with scientific notation', async () => {
      const result = await executor.execute('seq -f "%.2e" 1000 1000 3000')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1.00e+03\n2.00e+03\n3.00e+03')
    })
  })

  describe('floating point', () => {
    it('should handle float start/end', async () => {
      const result = await executor.execute('seq 0.5 1.5')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('0.5\n1.5')
    })

    it('should handle float step', async () => {
      const result = await executor.execute('seq 1 0.5 3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1.0\n1.5\n2.0\n2.5\n3.0')
    })

    it('should handle float step with precision', async () => {
      const result = await executor.execute('seq 0 0.1 0.5')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(6)
      expect(parseFloat(lines[0])).toBeCloseTo(0, 5)
      expect(parseFloat(lines[5])).toBeCloseTo(0.5, 5)
    })
  })

  describe('edge cases', () => {
    it('should return empty for impossible range', async () => {
      const result = await executor.execute('seq 5 1')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('should handle very large numbers', async () => {
      const result = await executor.execute('seq 1000000 1000003')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1000000\n1000001\n1000002\n1000003')
    })
  })
})

// ============================================================================
// SHUF - SHUFFLE/RANDOMIZE
// ============================================================================

describe('shuf - Shuffle/Randomize', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createMathControlExecutor()
  })

  describe('shuffle stdin', () => {
    it('should shuffle input lines', async () => {
      const result = await executor.execute('echo -e "a\\nb\\nc\\nd\\ne" | shuf')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(5)
      expect(lines.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('should contain all input elements', async () => {
      const result = await executor.execute('printf "1\\n2\\n3\\n4\\n5" | shuf')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines.sort()).toEqual(['1', '2', '3', '4', '5'])
    })
  })

  describe('pick random subset (-n)', () => {
    it('should pick n random lines', async () => {
      const result = await executor.execute('echo -e "a\\nb\\nc\\nd\\ne" | shuf -n 3')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(3)
    })

    it('should pick 1 random line', async () => {
      const result = await executor.execute('echo -e "a\\nb\\nc" | shuf -n 1')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(['a', 'b', 'c']).toContain(lines[0])
    })

    it('should handle n larger than input', async () => {
      const result = await executor.execute('echo -e "a\\nb\\nc" | shuf -n 10')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(3)
    })
  })

  describe('shuffle echo args (-e)', () => {
    it('should shuffle arguments', async () => {
      const result = await executor.execute('shuf -e a b c d e')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(5)
      expect(lines.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('should shuffle numbers', async () => {
      const result = await executor.execute('shuf -e 1 2 3 4 5')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines.map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    })

    it('should pick random from args', async () => {
      const result = await executor.execute('shuf -e -n 2 a b c d e')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(2)
    })
  })

  describe('shuffle range (-i)', () => {
    it('should shuffle integer range', async () => {
      const result = await executor.execute('shuf -i 1-10')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(10)
      expect(lines.map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })

    it('should shuffle large range', async () => {
      const result = await executor.execute('shuf -i 1-100 -n 10')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(10)
      lines.forEach(line => {
        const num = parseInt(line, 10)
        expect(num).toBeGreaterThanOrEqual(1)
        expect(num).toBeLessThanOrEqual(100)
      })
    })

    it('should handle range with 0', async () => {
      const result = await executor.execute('shuf -i 0-5')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(6)
      expect(lines.map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
    })
  })

  describe('with replacement (-r)', () => {
    it('should allow duplicates with replacement', async () => {
      const result = await executor.execute('shuf -r -n 20 -e a b c')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(20)
      lines.forEach(line => {
        expect(['a', 'b', 'c']).toContain(line)
      })
    })

    it('should pick more than input size with replacement', async () => {
      const result = await executor.execute('shuf -r -n 100 -i 1-5')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(100)
    })
  })

  describe('repeat (-n 0 with -r)', () => {
    it('should output nothing with -n 0', async () => {
      const result = await executor.execute('shuf -n 0 -e a b c')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('')
    })
  })

  describe('head count (--head-count)', () => {
    it('should be equivalent to -n', async () => {
      const result = await executor.execute('shuf --head-count=3 -i 1-10')
      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toHaveLength(3)
    })
  })

  describe('output file (-o)', () => {
    it('should write to output file', async () => {
      // Note: This test creates a file, implementation should handle
      const result = await executor.execute('shuf -e a b c -o /tmp/shuf-test.txt')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('random source', () => {
    it('should accept random source file', async () => {
      // Uses /dev/urandom or similar for randomness
      const result = await executor.execute('shuf -i 1-10 --random-source=/dev/urandom')
      expect(result.exitCode).toBe(0)
    })
  })
})

// ============================================================================
// SLEEP - DELAY EXECUTION
// ============================================================================

describe('sleep - Delay Execution', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createMathControlExecutor()
  })

  describe('seconds (default)', () => {
    it('should sleep for 0 seconds', async () => {
      const start = Date.now()
      const result = await executor.execute('sleep 0')
      const elapsed = Date.now() - start
      expect(result.exitCode).toBe(0)
      expect(elapsed).toBeLessThan(100)
    })

    it('should sleep for fractional seconds', async () => {
      const start = Date.now()
      const result = await executor.execute('sleep 0.1')
      const elapsed = Date.now() - start
      expect(result.exitCode).toBe(0)
      expect(elapsed).toBeGreaterThanOrEqual(90)
      expect(elapsed).toBeLessThan(200)
    })

    it('should sleep with explicit s suffix', async () => {
      const start = Date.now()
      const result = await executor.execute('sleep 0.1s')
      const elapsed = Date.now() - start
      expect(result.exitCode).toBe(0)
      expect(elapsed).toBeGreaterThanOrEqual(90)
    })

    it('should handle integer seconds', async () => {
      const start = Date.now()
      const result = await executor.execute('sleep 1')
      const elapsed = Date.now() - start
      expect(result.exitCode).toBe(0)
      expect(elapsed).toBeGreaterThanOrEqual(900)
      expect(elapsed).toBeLessThan(1200)
    })
  })

  describe('time units', () => {
    it('should sleep for minutes (m)', async () => {
      // We won't actually wait a minute - just verify parsing
      const result = await executor.execute('sleep 0.001m')
      expect(result.exitCode).toBe(0)
    })

    it('should sleep for hours (h)', async () => {
      const result = await executor.execute('sleep 0.00001h')
      expect(result.exitCode).toBe(0)
    })

    it('should sleep for days (d)', async () => {
      const result = await executor.execute('sleep 0.000001d')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('multiple durations', () => {
    it('should sum multiple durations', async () => {
      const start = Date.now()
      const result = await executor.execute('sleep 0.05 0.05')
      const elapsed = Date.now() - start
      expect(result.exitCode).toBe(0)
      expect(elapsed).toBeGreaterThanOrEqual(90)
    })

    it('should sum mixed units', async () => {
      const start = Date.now()
      // 0.05s + 0.001m (0.06s) = ~0.11s
      const result = await executor.execute('sleep 0.05s 0.001m')
      const elapsed = Date.now() - start
      expect(result.exitCode).toBe(0)
      expect(elapsed).toBeGreaterThanOrEqual(100)
    })
  })

  describe('error handling', () => {
    it('should fail with invalid duration', async () => {
      const result = await executor.execute('sleep abc')
      expect(result.exitCode).not.toBe(0)
    })

    it('should fail with negative duration', async () => {
      const result = await executor.execute('sleep -1')
      expect(result.exitCode).not.toBe(0)
    })

    it('should fail with no arguments', async () => {
      const result = await executor.execute('sleep')
      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('infinity handling', () => {
    it('should handle infinity keyword', async () => {
      // Use timeout command to properly limit infinite sleep
      // This test verifies parsing and that timeout can interrupt sleep
      const result = await executor.execute('timeout 0.1 sleep infinity')
      // Should timeout with exit code 124 (timeout exit code)
      expect(result.exitCode).toBe(124)
    })
  })
})

// ============================================================================
// TIMEOUT - RUN WITH TIME LIMIT
// ============================================================================

describe('timeout - Run with Time Limit', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createMathControlExecutor()
  })

  describe('basic timeout', () => {
    it('should complete command within timeout', async () => {
      const result = await executor.execute('timeout 5 echo "hello"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
    })

    it('should timeout long-running command', async () => {
      const start = Date.now()
      const result = await executor.execute('timeout 0.1 sleep 10')
      const elapsed = Date.now() - start
      expect(result.exitCode).toBe(124) // timeout exit code
      expect(elapsed).toBeLessThan(500)
    })

    it('should pass through command exit code', async () => {
      const result = await executor.execute('timeout 5 false')
      expect(result.exitCode).toBe(1)
    })

    it('should pass through success exit code', async () => {
      const result = await executor.execute('timeout 5 true')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('timeout with units', () => {
    it('should accept seconds suffix (s)', async () => {
      const result = await executor.execute('timeout 1s echo "hello"')
      expect(result.exitCode).toBe(0)
    })

    it('should accept minutes suffix (m)', async () => {
      const result = await executor.execute('timeout 0.01m echo "hello"')
      expect(result.exitCode).toBe(0)
    })

    it('should accept hours suffix (h)', async () => {
      const result = await executor.execute('timeout 0.001h echo "hello"')
      expect(result.exitCode).toBe(0)
    })

    it('should accept days suffix (d)', async () => {
      const result = await executor.execute('timeout 0.0001d echo "hello"')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('kill after grace period (-k)', () => {
    it('should kill after grace period if process ignores TERM', async () => {
      // Simulates a process that ignores SIGTERM
      const start = Date.now()
      const result = await executor.execute('timeout -k 0.1 0.1 sleep 10')
      const elapsed = Date.now() - start
      expect([124, 137]).toContain(result.exitCode)
      expect(elapsed).toBeLessThan(500)
    })

    it('should use KILL signal after grace period', async () => {
      const result = await executor.execute('timeout --kill-after=0.1 0.1 sleep 10')
      expect([124, 137]).toContain(result.exitCode)
    })
  })

  describe('signal options', () => {
    it('should send TERM by default', async () => {
      const result = await executor.execute('timeout 0.1 sleep 10')
      expect(result.exitCode).toBe(124)
    })

    it('should send specified signal with -s', async () => {
      const result = await executor.execute('timeout -s KILL 0.1 sleep 10')
      expect(result.exitCode).toBe(137) // 128 + 9 (SIGKILL)
    })

    it('should send signal with --signal', async () => {
      const result = await executor.execute('timeout --signal=KILL 0.1 sleep 10')
      expect(result.exitCode).toBe(137)
    })

    it('should send signal by number', async () => {
      const result = await executor.execute('timeout -s 9 0.1 sleep 10')
      expect(result.exitCode).toBe(137)
    })
  })

  describe('preserve status', () => {
    it('should preserve killed status with --preserve-status', async () => {
      const result = await executor.execute('timeout --preserve-status 0.1 sleep 10')
      // With preserve-status, exit code is 128 + signal number
      expect(result.exitCode).not.toBe(124)
    })
  })

  describe('foreground', () => {
    it('should run in foreground with --foreground', async () => {
      const result = await executor.execute('timeout --foreground 1 echo "test"')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('exit codes', () => {
    it('should return 124 for timeout (TERM)', async () => {
      const result = await executor.execute('timeout 0.1 sleep 10')
      expect(result.exitCode).toBe(124)
    })

    it('should return 137 for kill (SIGKILL)', async () => {
      const result = await executor.execute('timeout -s KILL 0.1 sleep 10')
      expect(result.exitCode).toBe(137)
    })

    it('should return 126 for command not found/permission', async () => {
      const result = await executor.execute('timeout 1 /nonexistent/command')
      expect(result.exitCode).toBe(126)
    })

    it('should return 125 for timeout failure', async () => {
      // timeout with invalid duration should return 125
      const result = await executor.execute('timeout abc echo "test"')
      expect(result.exitCode).toBe(125)
    })
  })

  describe('verbose output', () => {
    it('should show verbose message with -v', async () => {
      const result = await executor.execute('timeout -v 0.1 sleep 10')
      expect(result.stderr).toContain('timeout')
    })
  })

  describe('command with arguments', () => {
    it('should pass arguments to command', async () => {
      const result = await executor.execute('timeout 1 echo hello world')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello world')
    })

    it('should handle quoted arguments', async () => {
      const result = await executor.execute('timeout 1 echo "hello world"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello world')
    })

    it('should handle command with options', async () => {
      // Note: Using echo instead of ls since ls requires fs capability
      const result = await executor.execute('timeout 1 echo -n "test"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('test')
    })
  })
})

// ============================================================================
// TIER CLASSIFICATION TESTS
// ============================================================================

describe('Math & Control Tier Classification', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = createMathControlExecutor()
  })

  describe('bc classification', () => {
    it('should classify bc as Tier 1 native', () => {
      const classification = executor.classifyCommand('echo "2+2" | bc')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
    })
  })

  describe('expr classification', () => {
    it('should classify expr as Tier 1 native', () => {
      const classification = executor.classifyCommand('expr 2 + 2')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
    })
  })

  describe('seq classification', () => {
    it('should classify seq as Tier 1 native', () => {
      const classification = executor.classifyCommand('seq 1 10')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
    })
  })

  describe('shuf classification', () => {
    it('should classify shuf as Tier 1 native', () => {
      const classification = executor.classifyCommand('shuf -i 1-10')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
    })
  })

  describe('sleep classification', () => {
    it('should classify sleep as Tier 1 native', () => {
      const classification = executor.classifyCommand('sleep 1')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
    })
  })

  describe('timeout classification', () => {
    it('should classify timeout as Tier 1 native', () => {
      const classification = executor.classifyCommand('timeout 5 cmd')
      expect(classification.tier).toBe(1)
      expect(classification.handler).toBe('native')
    })
  })
})
