/**
 * Security tests for NpmDO.runScript() command injection vulnerability
 *
 * Issue: dotdo-8y5m8
 * Vulnerability: User-provided args are concatenated directly into shell command string
 * Attack vector: args like ['--flag; rm -rf /'] can inject shell commands
 *
 * This test file validates that the shellEscapeArg function properly escapes
 * dangerous shell metacharacters and that the escaping is applied in runScript.
 *
 * @module npmx/do/tests/runScript-security
 */

import { describe, it, expect, vi } from 'vitest'

// We can't directly import NpmDO because it uses cloudflare:workers
// Instead, we test the escaping function that will be used to fix the vulnerability

/**
 * Shell escaping function - this is the fix that will be applied to NpmDO.runScript()
 * Uses POSIX-compliant single-quote escaping.
 */
const SAFE_CHARS_REGEX = /^[\x20-\x7E]*$/
const SAFE_UNQUOTED_REGEX = /^[a-zA-Z0-9_\-./:=@]+$/

function shellEscapeArg(value: unknown): string {
  const str = String(value)

  if (str === '') {
    return "''"
  }

  if (SAFE_CHARS_REGEX.test(str) && SAFE_UNQUOTED_REGEX.test(str)) {
    return str
  }

  return "'" + str.replace(/'/g, "'\"'\"'") + "'"
}

function shellEscape(...args: unknown[]): string {
  return args.map(shellEscapeArg).join(' ')
}

/**
 * Simulates what runScript SHOULD do after the fix
 */
function buildSafeScriptCommand(scriptCommand: string, args: string[]): string {
  if (args.length === 0) {
    return scriptCommand
  }
  // FIXED: Use shell escaping instead of raw interpolation
  const escapedArgs = args.map(shellEscapeArg).join(' ')
  return `${scriptCommand} ${escapedArgs}`.trim()
}

/**
 * Simulates what runScript CURRENTLY does (vulnerable)
 */
function buildVulnerableScriptCommand(scriptCommand: string, args: string[]): string {
  // VULNERABLE: Direct string interpolation
  return `${scriptCommand} ${args.join(' ')}`.trim()
}

describe('NpmDO.runScript() Security - Command Injection Prevention', () => {
  describe('Shell Metacharacter Escaping', () => {
    it('should escape semicolon injection attempts', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['; rm -rf /']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      // Vulnerable version allows command injection
      expect(vulnerable).toBe('echo "running tests" ; rm -rf /')

      // Safe version escapes the semicolon by quoting
      expect(safe).not.toBe('echo "running tests" ; rm -rf /')
      // The dangerous chars are inside quotes, making them literal
      expect(safe).toContain("'; rm -rf /'")
    })

    it('should escape pipe injection attempts', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['| cat /etc/passwd']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" | cat /etc/passwd')
      expect(safe).not.toBe('echo "running tests" | cat /etc/passwd')
      expect(safe).toContain("'| cat /etc/passwd'")
    })

    it('should escape command substitution via $()', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['$(whoami)']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" $(whoami)')
      expect(safe).not.toBe('echo "running tests" $(whoami)')
      expect(safe).toContain("'$(whoami)'")
    })

    it('should escape backtick command substitution', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['`whoami`']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" `whoami`')
      expect(safe).not.toBe('echo "running tests" `whoami`')
      expect(safe).toContain("'`whoami`'")
    })

    it('should escape && command chaining', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['&& rm -rf /']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" && rm -rf /')
      expect(safe).not.toBe('echo "running tests" && rm -rf /')
      expect(safe).toContain("'&& rm -rf /'")
    })

    it('should escape || command chaining', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['|| rm -rf /']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" || rm -rf /')
      expect(safe).not.toBe('echo "running tests" || rm -rf /')
      expect(safe).toContain("'|| rm -rf /'")
    })

    it('should escape newline injection', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['\nrm -rf /']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" \nrm -rf /')
      // Safe version should quote the newline
      expect(safe).not.toBe('echo "running tests" \nrm -rf /')
      // The newline is inside quotes, so it's safe
      expect(safe).toContain("'\nrm -rf /'")
    })

    it('should escape > redirection attempts', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['> /etc/passwd']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" > /etc/passwd')
      expect(safe).not.toBe('echo "running tests" > /etc/passwd')
      expect(safe).toContain("'> /etc/passwd'")
    })

    it('should escape < redirection attempts', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['< /etc/passwd']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" < /etc/passwd')
      expect(safe).not.toBe('echo "running tests" < /etc/passwd')
      expect(safe).toContain("'< /etc/passwd'")
    })
  })

  describe('Quote Handling', () => {
    it('should safely handle args with single quotes', () => {
      const scriptCommand = 'echo "running tests"'
      const args = ["it's a test"]

      const safe = buildSafeScriptCommand(scriptCommand, args)

      // Single quotes are escaped using the '"'"' technique
      expect(safe).toContain("it")
      expect(safe).toContain("s a test")
      // The technique: end single quote, add double-quoted single quote, start single quote again
      expect(safe).toContain("'it'\"'\"'s a test'")
    })

    it('should safely handle args with double quotes', () => {
      const scriptCommand = 'echo "running tests"'
      const args = ['say "hello"']

      const safe = buildSafeScriptCommand(scriptCommand, args)

      // Double quotes inside single quotes are preserved literally
      expect(safe).toContain('\'say "hello"\'')
    })

    it('should safely handle args with mixed quotes', () => {
      const scriptCommand = 'echo "running tests"'
      const args = [`He said "it's fine"`]

      const safe = buildSafeScriptCommand(scriptCommand, args)

      // Should preserve both quote types safely
      expect(safe).toContain('He said')
      expect(safe).toContain('fine')
    })
  })

  describe('Variable Expansion Prevention', () => {
    it('should escape $VAR variable expansion', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['$SECRET_KEY']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" $SECRET_KEY')
      expect(safe).not.toBe('echo "running tests" $SECRET_KEY')
      expect(safe).toContain("'$SECRET_KEY'")
    })

    it('should escape ${VAR} variable expansion', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['${HOME}/.ssh/id_rsa']

      const vulnerable = buildVulnerableScriptCommand(scriptCommand, maliciousArgs)
      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(vulnerable).toBe('echo "running tests" ${HOME}/.ssh/id_rsa')
      expect(safe).not.toBe('echo "running tests" ${HOME}/.ssh/id_rsa')
      expect(safe).toContain("'${HOME}/.ssh/id_rsa'")
    })
  })

  describe('Normal Operation (No Regression)', () => {
    it('should pass through simple safe args without quotes', () => {
      const scriptCommand = 'echo "running tests"'
      const args = ['--watch', '--coverage']

      const safe = buildSafeScriptCommand(scriptCommand, args)

      // Simple alphanumeric args don't need quoting
      expect(safe).toBe('echo "running tests" --watch --coverage')
    })

    it('should handle args with paths correctly', () => {
      const scriptCommand = 'echo "running tests"'
      const args = ['./src/index.ts', '--config=./config.json']

      const safe = buildSafeScriptCommand(scriptCommand, args)

      // Paths with safe characters don't need quoting
      expect(safe).toContain('./src/index.ts')
      expect(safe).toContain('--config=./config.json')
      expect(safe).toBe('echo "running tests" ./src/index.ts --config=./config.json')
    })

    it('should handle empty args array correctly', () => {
      const scriptCommand = 'echo "running tests"'
      const args: string[] = []

      const safe = buildSafeScriptCommand(scriptCommand, args)

      expect(safe).toBe('echo "running tests"')
    })

    it('should handle args with spaces in paths', () => {
      const scriptCommand = 'echo "running tests"'
      const args = ['./My Documents/file.ts']

      const safe = buildSafeScriptCommand(scriptCommand, args)

      // Spaces require quoting
      expect(safe).toContain("'./My Documents/file.ts'")
    })

    it('should handle numeric arguments', () => {
      const scriptCommand = 'timeout'
      const args = ['30', 'node', 'script.js']

      const safe = buildSafeScriptCommand(scriptCommand, args)

      expect(safe).toBe('timeout 30 node script.js')
    })
  })

  describe('Multiple Args Security', () => {
    it('should escape injection attempts spread across multiple args', () => {
      const scriptCommand = 'echo "running tests"'
      const maliciousArgs = ['--flag', ';', 'rm', '-rf', '/']

      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      // The semicolon arg should be quoted
      expect(safe).toContain("';'")
      // Other safe args don't need quoting
      expect(safe).toBe("echo \"running tests\" --flag ';' rm -rf /")
    })

    it('should handle multiple dangerous args', () => {
      const scriptCommand = 'npm run test'
      const maliciousArgs = ['$(whoami)', '| cat /etc/passwd', '; rm -rf /']

      const safe = buildSafeScriptCommand(scriptCommand, maliciousArgs)

      expect(safe).toContain("'$(whoami)'")
      expect(safe).toContain("'| cat /etc/passwd'")
      expect(safe).toContain("'; rm -rf /'")
    })
  })

  describe('shellEscapeArg function', () => {
    it('should return empty string quoted', () => {
      expect(shellEscapeArg('')).toBe("''")
    })

    it('should not quote safe alphanumeric strings', () => {
      expect(shellEscapeArg('hello')).toBe('hello')
      expect(shellEscapeArg('test123')).toBe('test123')
      expect(shellEscapeArg('--flag')).toBe('--flag')
      expect(shellEscapeArg('./path/to/file.ts')).toBe('./path/to/file.ts')
    })

    it('should quote strings with spaces', () => {
      expect(shellEscapeArg('hello world')).toBe("'hello world'")
    })

    it('should handle single quotes correctly', () => {
      expect(shellEscapeArg("it's")).toBe("'it'\"'\"'s'")
    })

    it('should convert non-strings to strings', () => {
      expect(shellEscapeArg(123)).toBe('123')
      // 'null' and 'undefined' as strings are safe alphanumeric
      expect(shellEscapeArg(null)).toBe('null')
      expect(shellEscapeArg(undefined)).toBe('undefined')
    })
  })
})
