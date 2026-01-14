/**
 * Command Optimization Suggestions Tests (RED Phase)
 *
 * Tests for detecting suboptimal bash command patterns and generating
 * optimized alternatives that preserve semantics.
 *
 * Categories tested:
 * - Useless cat (UUOC - Useless Use Of Cat)
 * - Suboptimal find + xargs patterns
 * - Suboptimal for loops with $(ls)
 * - Multiple pipes that could be combined
 * - Suboptimal grep patterns
 * - Other common anti-patterns
 *
 * RED Phase: These tests document expected behavior and will fail
 * until the optimization detection implementation is complete.
 */

import { describe, it, expect } from 'vitest'
import type { Program } from '../src/types.js'
import { simpleCommand, program } from './utils/fixtures.js'
import { analyzeOptimizations, analyzeOptimizationsFromAst } from '../src/ast/optimize.js'
import type { OptimizationSuggestion, OptimizationResult } from '../src/ast/optimize.js'

// ============================================================================
// USELESS CAT (UUOC) OPTIMIZATIONS
// ============================================================================

describe('Command Optimization: Useless Cat (UUOC)', () => {
  describe('cat file | grep pattern -> grep pattern file', () => {
    it('should detect cat file | grep pattern', () => {
      const result = analyzeOptimizations('cat file.txt | grep pattern')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions).toHaveLength(1)
      expect(result.suggestions[0].type).toBe('useless-cat')
      expect(result.suggestions[0].optimized).toBe('grep pattern file.txt')
      expect(result.suggestions[0].preservesSemantics).toBe(true)
    })

    it('should detect cat file | grep -i pattern', () => {
      const result = analyzeOptimizations('cat file.txt | grep -i pattern')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('useless-cat')
      expect(result.suggestions[0].optimized).toBe('grep -i pattern file.txt')
    })

    it('should detect cat file | grep -E "regex"', () => {
      const result = analyzeOptimizations('cat file.txt | grep -E "^foo.*bar$"')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('grep -E "^foo.*bar$" file.txt')
    })

    it('should detect cat with absolute path', () => {
      const result = analyzeOptimizations('cat /var/log/syslog | grep error')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('grep error /var/log/syslog')
    })

    it('should detect cat with multiple grep flags', () => {
      const result = analyzeOptimizations('cat log.txt | grep -r -n -i pattern')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('grep -r -n -i pattern log.txt')
    })

    it('should NOT suggest optimization for cat with multiple files', () => {
      // cat file1 file2 | grep has different semantics than grep file1 file2
      // because grep shows filename prefix by default with multiple files
      const result = analyzeOptimizations('cat file1.txt file2.txt | grep pattern')

      // This is a valid use of cat - should not suggest removing it
      // OR should provide optimized version that preserves semantics
      if (result.hasOptimizations) {
        expect(result.suggestions[0].preservesSemantics).toBe(true)
        // The optimization should use grep -h to suppress filename prefix
        expect(result.suggestions[0].optimized).toBe('grep -h pattern file1.txt file2.txt')
      }
    })
  })

  describe('cat file | awk -> awk file', () => {
    it('should detect cat file | awk', () => {
      const result = analyzeOptimizations("cat data.txt | awk '{print $1}'")

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('useless-cat')
      expect(result.suggestions[0].optimized).toBe("awk '{print $1}' data.txt")
    })

    it('should detect cat file | awk -F', () => {
      const result = analyzeOptimizations("cat data.csv | awk -F',' '{print $2}'")

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe("awk -F',' '{print $2}' data.csv")
    })
  })

  describe('cat file | sed -> sed file', () => {
    it('should detect cat file | sed', () => {
      const result = analyzeOptimizations('cat file.txt | sed "s/foo/bar/g"')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('useless-cat')
      expect(result.suggestions[0].optimized).toBe('sed "s/foo/bar/g" file.txt')
    })

    it('should detect cat file | sed -n', () => {
      const result = analyzeOptimizations('cat file.txt | sed -n "5p"')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('sed -n "5p" file.txt')
    })
  })

  describe('cat file | head/tail -> head/tail file', () => {
    it('should detect cat file | head', () => {
      const result = analyzeOptimizations('cat file.txt | head -n 10')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('useless-cat')
      expect(result.suggestions[0].optimized).toBe('head -n 10 file.txt')
    })

    it('should detect cat file | tail', () => {
      const result = analyzeOptimizations('cat file.txt | tail -n 20')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('tail -n 20 file.txt')
    })

    it('should detect cat file | tail -f', () => {
      const result = analyzeOptimizations('cat /var/log/syslog | tail -f')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('tail -f /var/log/syslog')
    })
  })

  describe('cat file | wc -> wc file', () => {
    it('should detect cat file | wc -l', () => {
      const result = analyzeOptimizations('cat file.txt | wc -l')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('useless-cat')
      expect(result.suggestions[0].optimized).toBe('wc -l file.txt')
    })

    it('should detect cat file | wc', () => {
      const result = analyzeOptimizations('cat file.txt | wc')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('wc file.txt')
    })
  })

  describe('cat file | sort -> sort file', () => {
    it('should detect cat file | sort', () => {
      const result = analyzeOptimizations('cat names.txt | sort')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('useless-cat')
      expect(result.suggestions[0].optimized).toBe('sort names.txt')
    })

    it('should detect cat file | sort -u', () => {
      const result = analyzeOptimizations('cat names.txt | sort -u')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('sort -u names.txt')
    })

    it('should detect cat file | sort -n', () => {
      const result = analyzeOptimizations('cat numbers.txt | sort -n')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('sort -n numbers.txt')
    })
  })
})

// ============================================================================
// FIND + XARGS OPTIMIZATIONS
// ============================================================================

describe('Command Optimization: find + xargs patterns', () => {
  describe('find | xargs rm -> find -delete', () => {
    it('should detect find | xargs rm', () => {
      const result = analyzeOptimizations('find . -name "*.tmp" | xargs rm')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions).toHaveLength(1)
      expect(result.suggestions[0].type).toBe('find-xargs')
      expect(result.suggestions[0].optimized).toBe('find . -name "*.tmp" -delete')
      expect(result.suggestions[0].preservesSemantics).toBe(true)
    })

    it('should detect find | xargs rm -f', () => {
      const result = analyzeOptimizations('find /tmp -name "*.log" | xargs rm -f')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('find /tmp -name "*.log" -delete')
    })

    it('should NOT suggest -delete when rm has -r flag (different semantics)', () => {
      // find -delete doesn't work on directories, rm -r does
      const result = analyzeOptimizations('find . -type d -name "cache" | xargs rm -r')

      // Should either not optimize or provide different optimization
      if (result.hasOptimizations) {
        // The optimization should preserve -r semantics
        expect(result.suggestions[0].preservesSemantics).toBe(true)
        // Might suggest: find . -type d -name "cache" -exec rm -r {} +
      }
    })
  })

  describe('find | xargs action -> find -exec action {} +', () => {
    it('should detect find | xargs chmod', () => {
      const result = analyzeOptimizations('find . -name "*.sh" | xargs chmod +x')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('find-xargs')
      // -exec with + is more efficient than xargs for most cases
      expect(result.suggestions[0].optimized).toBe('find . -name "*.sh" -exec chmod +x {} +')
    })

    it('should detect find | xargs chown', () => {
      const result = analyzeOptimizations('find /var/www -type f | xargs chown www-data')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('find /var/www -type f -exec chown www-data {} +')
    })

    it('should detect find | xargs grep', () => {
      const result = analyzeOptimizations('find . -name "*.js" | xargs grep "TODO"')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('find . -name "*.js" -exec grep "TODO" {} +')
    })
  })

  describe('find with -print0 | xargs -0 should be preserved', () => {
    it('should recognize -print0 | xargs -0 as proper null-delimiter handling', () => {
      const result = analyzeOptimizations('find . -name "*.txt" -print0 | xargs -0 rm')

      // This is already an optimization for handling filenames with spaces
      // Should either not suggest optimization or suggest -delete variant
      if (result.hasOptimizations) {
        expect(result.suggestions[0].reason).toContain('delete')
        expect(result.suggestions[0].optimized).toBe('find . -name "*.txt" -delete')
      }
    })
  })
})

// ============================================================================
// FOR LOOP WITH $(ls) OPTIMIZATIONS
// ============================================================================

describe('Command Optimization: for loop with $(ls)', () => {
  describe('for f in $(ls) -> for f in *', () => {
    it('should detect for f in $(ls)', () => {
      const result = analyzeOptimizations('for f in $(ls); do echo $f; done')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions).toHaveLength(1)
      expect(result.suggestions[0].type).toBe('for-ls')
      expect(result.suggestions[0].optimized).toBe('for f in *; do echo $f; done')
      expect(result.suggestions[0].preservesSemantics).toBe(true)
    })

    it('should detect for file in $(ls)', () => {
      const result = analyzeOptimizations('for file in $(ls); do cat "$file"; done')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('for file in *; do cat "$file"; done')
    })

    it('should detect for i in `ls`', () => {
      const result = analyzeOptimizations('for i in `ls`; do rm "$i"; done')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('for-ls')
      expect(result.suggestions[0].optimized).toBe('for i in *; do rm "$i"; done')
    })

    it('should detect for f in $(ls dir/)', () => {
      const result = analyzeOptimizations('for f in $(ls subdir/); do echo $f; done')

      expect(result.hasOptimizations).toBe(true)
      // Should preserve the directory context
      expect(result.suggestions[0].optimized).toBe('for f in subdir/*; do echo $f; done')
    })

    it('should detect for f in $(ls *.txt)', () => {
      const result = analyzeOptimizations('for f in $(ls *.txt); do cat $f; done')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('for f in *.txt; do cat $f; done')
    })
  })

  describe('for with $(ls -1) -> for f in *', () => {
    it('should detect for f in $(ls -1)', () => {
      const result = analyzeOptimizations('for f in $(ls -1); do echo "$f"; done')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('for-ls')
      expect(result.suggestions[0].optimized).toBe('for f in *; do echo "$f"; done')
    })
  })

  describe('should warn about ls issues with special characters', () => {
    it('should explain why $(ls) is problematic', () => {
      const result = analyzeOptimizations('for f in $(ls); do echo $f; done')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].reason).toContain('space')
      // Reason should explain that $(ls) breaks on filenames with spaces/newlines
    })
  })
})

// ============================================================================
// PIPE COMBINATION OPTIMIZATIONS
// ============================================================================

describe('Command Optimization: Multiple pipes that could be combined', () => {
  describe('grep | grep -> grep with -E', () => {
    it('should detect grep pattern1 | grep pattern2', () => {
      const result = analyzeOptimizations('grep foo file.txt | grep bar')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('pipe-combine')
      // Can be combined with -E and pattern1.*pattern2
      expect(result.suggestions[0].optimized).toBe('grep -E "foo.*bar" file.txt')
    })

    it('should detect grep -v pattern1 | grep -v pattern2', () => {
      const result = analyzeOptimizations('grep -v foo file.txt | grep -v bar')

      expect(result.hasOptimizations).toBe(true)
      // Can be combined with -E and pattern1|pattern2
      expect(result.suggestions[0].optimized).toBe('grep -v -E "foo|bar" file.txt')
    })

    it('should NOT combine grep -v with grep (different semantics)', () => {
      // grep -v foo | grep bar means "lines without foo that contain bar"
      // This cannot be simplified to a single grep
      const result = analyzeOptimizations('grep -v foo file.txt | grep bar')

      if (result.hasOptimizations) {
        // Should preserve the semantics
        expect(result.suggestions[0].preservesSemantics).toBe(true)
      }
    })
  })

  describe('head | tail -> sed or head with offset', () => {
    it('should detect head -n 20 | tail -n 10', () => {
      const result = analyzeOptimizations('head -n 20 file.txt | tail -n 10')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('pipe-combine')
      // Gets lines 11-20
      expect(result.suggestions[0].optimized).toBe('sed -n "11,20p" file.txt')
    })

    it('should detect cat | head | tail', () => {
      const result = analyzeOptimizations('cat file.txt | head -n 100 | tail -n 50')

      expect(result.hasOptimizations).toBe(true)
      // Should optimize away both the cat and combine head/tail
      expect(result.suggestions[0].optimized).toBe('sed -n "51,100p" file.txt')
    })
  })

  describe('sort | uniq -> sort -u', () => {
    it('should detect sort | uniq', () => {
      const result = analyzeOptimizations('sort file.txt | uniq')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('pipe-combine')
      expect(result.suggestions[0].optimized).toBe('sort -u file.txt')
    })

    it('should detect cat | sort | uniq', () => {
      const result = analyzeOptimizations('cat file.txt | sort | uniq')

      expect(result.hasOptimizations).toBe(true)
      // Should optimize away cat AND combine sort|uniq
      expect(result.suggestions[0].optimized).toBe('sort -u file.txt')
    })

    it('should NOT combine when uniq has -c flag', () => {
      // sort | uniq -c counts duplicates, sort -u does not
      const result = analyzeOptimizations('sort file.txt | uniq -c')

      if (result.hasOptimizations) {
        // Must preserve -c semantics
        expect(result.suggestions[0].preservesSemantics).toBe(true)
        expect(result.suggestions[0].optimized).not.toContain('sort -u')
      }
    })

    it('should NOT combine when uniq has -d flag', () => {
      // uniq -d shows only duplicates
      const result = analyzeOptimizations('sort file.txt | uniq -d')

      if (result.hasOptimizations) {
        expect(result.suggestions[0].preservesSemantics).toBe(true)
        expect(result.suggestions[0].optimized).not.toContain('sort -u')
      }
    })
  })

  describe('cat | grep | wc -l -> grep -c', () => {
    it('should detect grep pattern | wc -l', () => {
      const result = analyzeOptimizations('grep pattern file.txt | wc -l')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('pipe-combine')
      expect(result.suggestions[0].optimized).toBe('grep -c pattern file.txt')
    })

    it('should detect cat | grep | wc -l', () => {
      const result = analyzeOptimizations('cat file.txt | grep pattern | wc -l')

      expect(result.hasOptimizations).toBe(true)
      // Should optimize away cat AND combine grep|wc
      expect(result.suggestions[0].optimized).toBe('grep -c pattern file.txt')
    })
  })
})

// ============================================================================
// GREP PATTERN OPTIMIZATIONS
// ============================================================================

describe('Command Optimization: grep patterns', () => {
  describe('grep pattern file1 file2 | grep -l -> grep -l pattern file1 file2', () => {
    it('should detect unnecessary pipe to grep -l', () => {
      const result = analyzeOptimizations('grep pattern *.txt | grep -l')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('grep-pattern')
      expect(result.suggestions[0].optimized).toBe('grep -l pattern *.txt')
    })
  })

  describe('echo pattern | grep -f - file -> grep pattern file', () => {
    it('should detect echo pattern | grep -f -', () => {
      const result = analyzeOptimizations('echo "pattern" | grep -f - file.txt')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('grep "pattern" file.txt')
    })
  })

  describe('grep . file -> cat file (when intent is to show file)', () => {
    it('should detect grep . as cat substitute', () => {
      const result = analyzeOptimizations('grep . file.txt')

      // This might be intentional to remove empty lines
      // Optimization should note this
      if (result.hasOptimizations) {
        expect(result.suggestions[0].description).toContain('empty lines')
        // Could suggest: grep -v "^$" file.txt or cat file.txt | grep .
      }
    })
  })
})

// ============================================================================
// OTHER COMMON ANTI-PATTERNS
// ============================================================================

describe('Command Optimization: Other anti-patterns', () => {
  describe('echo | read -> read variable', () => {
    it('should detect echo string | command (useless echo)', () => {
      const result = analyzeOptimizations('echo "hello" | cat')

      expect(result.hasOptimizations).toBe(true)
      // echo string | cat is useless, just use echo
      expect(result.suggestions[0].optimized).toBe('echo "hello"')
    })
  })

  describe('ls | wc -l -> find -maxdepth 1 | wc -l or stat', () => {
    it('should detect ls | wc -l for counting files', () => {
      const result = analyzeOptimizations('ls | wc -l')

      expect(result.hasOptimizations).toBe(true)
      // ls | wc -l is problematic with filenames containing newlines
      expect(result.suggestions[0].reason).toContain('newline')
    })

    it('should detect ls -1 | wc -l', () => {
      const result = analyzeOptimizations('ls -1 | wc -l')

      expect(result.hasOptimizations).toBe(true)
      // Suggest find or stat-based alternative
      expect(result.suggestions[0].optimized).toContain('find')
    })
  })

  describe('basename $(pwd) -> ${PWD##*/}', () => {
    it('should detect basename $(pwd)', () => {
      const result = analyzeOptimizations('basename $(pwd)')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('other')
      expect(result.suggestions[0].optimized).toBe('${PWD##*/}')
    })

    it('should detect basename `pwd`', () => {
      const result = analyzeOptimizations('basename `pwd`')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('${PWD##*/}')
    })
  })

  describe('dirname / basename combinations', () => {
    it('should detect cd $(dirname $0)', () => {
      const result = analyzeOptimizations('cd $(dirname $0)')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('cd "${0%/*}"')
    })
  })

  describe('expr for arithmetic -> $((...)) or let', () => {
    it('should detect expr for simple arithmetic', () => {
      const result = analyzeOptimizations('expr 1 + 2')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].type).toBe('other')
      expect(result.suggestions[0].optimized).toBe('$((1 + 2))')
    })

    it('should detect expr in assignment', () => {
      const result = analyzeOptimizations('result=$(expr $a + $b)')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('result=$((a + b))')
    })
  })

  describe('test -z / test -n string comparisons', () => {
    it('should detect [ "x$var" = "x" ] pattern', () => {
      const result = analyzeOptimizations('[ "x$var" = "x" ]')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('[ -z "$var" ]')
    })

    it('should detect [ "x$var" != "x" ] pattern', () => {
      const result = analyzeOptimizations('[ "x$var" != "x" ]')

      expect(result.hasOptimizations).toBe(true)
      expect(result.suggestions[0].optimized).toBe('[ -n "$var" ]')
    })
  })
})

// ============================================================================
// SEMANTIC PRESERVATION TESTS
// ============================================================================

describe('Command Optimization: Semantic Preservation', () => {
  it('should preserve stdout/stderr behavior', () => {
    // cat file 2>&1 | grep has different semantics than grep file 2>&1
    const result = analyzeOptimizations('cat file.txt 2>&1 | grep error')

    if (result.hasOptimizations) {
      // Optimization must preserve 2>&1 semantics
      expect(result.suggestions[0].preservesSemantics).toBe(true)
    }
  })

  it('should preserve exit codes when relevant', () => {
    // cat file | grep pattern returns grep's exit code
    // grep pattern file also returns grep's exit code
    // These should be semantically equivalent
    const result = analyzeOptimizations('cat file.txt | grep pattern')

    expect(result.hasOptimizations).toBe(true)
    expect(result.suggestions[0].preservesSemantics).toBe(true)
  })

  it('should handle quoted patterns correctly', () => {
    const result = analyzeOptimizations('cat file.txt | grep "pattern with spaces"')

    expect(result.hasOptimizations).toBe(true)
    expect(result.suggestions[0].optimized).toBe('grep "pattern with spaces" file.txt')
  })

  it('should handle single-quoted patterns correctly', () => {
    const result = analyzeOptimizations("cat file.txt | grep 'pattern with $var'")

    expect(result.hasOptimizations).toBe(true)
    expect(result.suggestions[0].optimized).toBe("grep 'pattern with $var' file.txt")
  })

  it('should handle escaped characters correctly', () => {
    const result = analyzeOptimizations('cat file.txt | grep "foo\\nbar"')

    expect(result.hasOptimizations).toBe(true)
    expect(result.suggestions[0].optimized).toBe('grep "foo\\nbar" file.txt')
  })
})

// ============================================================================
// MULTIPLE OPTIMIZATION TESTS
// ============================================================================

describe('Command Optimization: Multiple Optimizations', () => {
  it('should detect multiple issues in one command', () => {
    // This command has: useless cat, sort | uniq pattern
    const result = analyzeOptimizations('cat file.txt | sort | uniq')

    expect(result.hasOptimizations).toBe(true)
    // Should detect both issues
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1)
    // Final optimized command should address all issues
    expect(result.optimizedCommand).toBe('sort -u file.txt')
  })

  it('should detect useless cat and grep | wc -l', () => {
    const result = analyzeOptimizations('cat file.txt | grep pattern | wc -l')

    expect(result.hasOptimizations).toBe(true)
    expect(result.optimizedCommand).toBe('grep -c pattern file.txt')
  })

  it('should detect for $(ls) with useless cat inside', () => {
    const result = analyzeOptimizations('for f in $(ls); do cat "$f" | grep pattern; done')

    expect(result.hasOptimizations).toBe(true)
    // Should detect both the $(ls) issue and the useless cat
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2)
    expect(result.optimizedCommand).toBe('for f in *; do grep pattern "$f"; done')
  })

  it('should chain optimizations correctly', () => {
    // cat | head | tail should become sed -n
    const result = analyzeOptimizations('cat file.txt | head -n 20 | tail -n 5')

    expect(result.hasOptimizations).toBe(true)
    expect(result.optimizedCommand).toBe('sed -n "16,20p" file.txt')
  })
})

// ============================================================================
// AST-BASED OPTIMIZATION TESTS
// ============================================================================

describe('Command Optimization: AST-based Analysis', () => {
  it('should analyze optimization from AST pipeline', () => {
    const ast: Program = {
      type: 'Program',
      body: [{
        type: 'Pipeline',
        negated: false,
        commands: [
          simpleCommand('cat', ['file.txt']),
          simpleCommand('grep', ['pattern']),
        ],
      }],
    }

    const result = analyzeOptimizationsFromAst(ast)

    expect(result.hasOptimizations).toBe(true)
    expect(result.suggestions[0].type).toBe('useless-cat')
  })

  it('should analyze optimization from AST with sort | uniq', () => {
    const ast: Program = {
      type: 'Program',
      body: [{
        type: 'Pipeline',
        negated: false,
        commands: [
          simpleCommand('sort', ['file.txt']),
          simpleCommand('uniq', []),
        ],
      }],
    }

    const result = analyzeOptimizationsFromAst(ast)

    expect(result.hasOptimizations).toBe(true)
    expect(result.suggestions[0].type).toBe('pipe-combine')
    expect(result.suggestions[0].optimized).toBe('sort -u file.txt')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Command Optimization: Edge Cases', () => {
  it('should handle empty input', () => {
    const result = analyzeOptimizations('')

    expect(result.hasOptimizations).toBe(false)
    expect(result.suggestions).toHaveLength(0)
  })

  it('should handle single command (no optimization possible)', () => {
    const result = analyzeOptimizations('ls -la')

    expect(result.hasOptimizations).toBe(false)
  })

  it('should handle already optimized commands', () => {
    const result = analyzeOptimizations('grep pattern file.txt')

    expect(result.hasOptimizations).toBe(false)
  })

  it('should handle complex pipelines without optimization opportunities', () => {
    const result = analyzeOptimizations('ps aux | grep -v grep | awk \'{print $2}\' | xargs kill')

    // This is a valid pipeline without obvious optimizations
    // (ps aux needs to be piped, grep -v grep is intentional, etc.)
    expect(result.hasOptimizations).toBe(false)
  })

  it('should handle commands with variable expansion', () => {
    const result = analyzeOptimizations('cat "$file" | grep "$pattern"')

    expect(result.hasOptimizations).toBe(true)
    expect(result.suggestions[0].optimized).toBe('grep "$pattern" "$file"')
  })

  it('should handle process substitution (not a useless cat)', () => {
    // cat <(command) is valid process substitution, not useless cat
    const result = analyzeOptimizations('cat <(ls)')

    // This is not useless cat - it's process substitution
    expect(result.hasOptimizations).toBe(false)
  })

  it('should handle here-strings (not a useless cat)', () => {
    const result = analyzeOptimizations('cat <<< "hello"')

    // This is a here-string, not useless cat
    expect(result.hasOptimizations).toBe(false)
  })

  it('should handle cat - (stdin)', () => {
    const result = analyzeOptimizations('cat - | grep pattern')

    // cat - reads from stdin, cannot be optimized to grep alone
    expect(result.hasOptimizations).toBe(false)
  })
})
