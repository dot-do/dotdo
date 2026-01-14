/**
 * Tagged Template Tests
 *
 * Tests for the enhanced tagged template support in bashx.
 * Covers shell escaping, options factory, raw mode, and .with() helper.
 */

import { describe, it, expect } from 'vitest'
import {
  shellEscape,
  shellEscapeArg,
  createShellTemplate,
  rawTemplate,
  safeTemplate,
} from '../src/escape.js'

describe('Shell Escaping', () => {
  describe('shellEscapeArg', () => {
    it('should return empty quotes for empty string', () => {
      expect(shellEscapeArg('')).toBe("''")
    })

    it('should not quote simple alphanumeric strings', () => {
      expect(shellEscapeArg('hello')).toBe('hello')
      expect(shellEscapeArg('file123')).toBe('file123')
      expect(shellEscapeArg('my_var')).toBe('my_var')
    })

    it('should not quote paths with safe characters', () => {
      expect(shellEscapeArg('/usr/local/bin')).toBe('/usr/local/bin')
      expect(shellEscapeArg('./relative/path')).toBe('./relative/path')
      expect(shellEscapeArg('file.txt')).toBe('file.txt')
      expect(shellEscapeArg('my-file.js')).toBe('my-file.js')
    })

    it('should not quote strings with colons and equals', () => {
      expect(shellEscapeArg('key=value')).toBe('key=value')
      expect(shellEscapeArg('http://example.com.ai')).toBe('http://example.com.ai')
    })

    it('should not quote strings with at signs', () => {
      expect(shellEscapeArg('user@host')).toBe('user@host')
      expect(shellEscapeArg('@scope/package')).toBe('@scope/package')
    })

    it('should quote strings with spaces', () => {
      expect(shellEscapeArg('hello world')).toBe("'hello world'")
      expect(shellEscapeArg('my file.txt')).toBe("'my file.txt'")
    })

    it('should quote strings with shell metacharacters', () => {
      expect(shellEscapeArg('file; rm -rf /')).toBe("'file; rm -rf /'")
      expect(shellEscapeArg('$(whoami)')).toBe("'$(whoami)'")
      expect(shellEscapeArg('`whoami`')).toBe("'`whoami`'")
      expect(shellEscapeArg('a && b')).toBe("'a && b'")
      expect(shellEscapeArg('a || b')).toBe("'a || b'")
      expect(shellEscapeArg('a | b')).toBe("'a | b'")
    })

    it('should quote strings with redirection characters', () => {
      expect(shellEscapeArg('file > output')).toBe("'file > output'")
      expect(shellEscapeArg('file < input')).toBe("'file < input'")
      expect(shellEscapeArg('2>&1')).toBe("'2>&1'")
    })

    it('should quote strings with glob characters', () => {
      expect(shellEscapeArg('*.txt')).toBe("'*.txt'")
      expect(shellEscapeArg('file?.txt')).toBe("'file?.txt'")
      expect(shellEscapeArg('[abc].txt')).toBe("'[abc].txt'")
    })

    it('should handle strings with single quotes', () => {
      const result = shellEscapeArg("it's fine")
      expect(result).toBe("'it'\"'\"'s fine'")
      // When evaluated by shell, this becomes: it's fine
    })

    it('should handle strings with multiple single quotes', () => {
      const result = shellEscapeArg("it's a 'test'")
      expect(result).toBe("'it'\"'\"'s a '\"'\"'test'\"'\"''")
    })

    it('should handle strings with double quotes', () => {
      expect(shellEscapeArg('"quoted"')).toBe("'\"quoted\"'")
    })

    it('should handle strings with backslashes', () => {
      expect(shellEscapeArg('path\\file')).toBe("'path\\file'")
    })

    it('should handle strings with newlines', () => {
      expect(shellEscapeArg('line1\nline2')).toBe("'line1\nline2'")
    })

    it('should handle strings with dollar signs', () => {
      expect(shellEscapeArg('$HOME')).toBe("'$HOME'")
      expect(shellEscapeArg('${var}')).toBe("'${var}'")
    })

    it('should convert non-string values to strings', () => {
      expect(shellEscapeArg(123)).toBe('123')
      expect(shellEscapeArg(true)).toBe('true')
      expect(shellEscapeArg(null)).toBe('null')
      expect(shellEscapeArg(undefined)).toBe('undefined')
    })
  })

  describe('shellEscape (multiple args)', () => {
    it('should join multiple arguments with spaces', () => {
      expect(shellEscape('ls', '-la', '/tmp')).toBe('ls -la /tmp')
    })

    it('should escape arguments that need it', () => {
      expect(shellEscape('cat', 'my file.txt')).toBe("cat 'my file.txt'")
    })

    it('should handle mixed safe and unsafe arguments', () => {
      expect(shellEscape('git', 'commit', '-m', 'fix: it works!')).toBe(
        "git commit -m 'fix: it works!'"
      )
    })

    it('should handle command injection attempts', () => {
      const dangerous = '; rm -rf /'
      expect(shellEscape('echo', dangerous)).toBe("echo '; rm -rf /'")
    })
  })
})

describe('Shell Templates', () => {
  describe('createShellTemplate', () => {
    it('should create a template that escapes values by default', () => {
      const template = createShellTemplate()
      const file = 'my file.txt'
      expect(template`cat ${file}`).toBe("cat 'my file.txt'")
    })

    it('should handle multiple interpolations', () => {
      const template = createShellTemplate()
      const src = 'source file.txt'
      const dst = 'dest file.txt'
      expect(template`cp ${src} ${dst}`).toBe("cp 'source file.txt' 'dest file.txt'")
    })

    it('should handle no interpolations', () => {
      const template = createShellTemplate()
      expect(template`ls -la`).toBe('ls -la')
    })

    it('should handle trailing interpolation', () => {
      const template = createShellTemplate()
      const path = '/my path'
      expect(template`ls ${path}`).toBe("ls '/my path'")
    })

    it('should handle leading interpolation', () => {
      const template = createShellTemplate()
      const cmd = 'ls'
      expect(template`${cmd} -la`).toBe('ls -la')
    })

    it('should prevent command injection', () => {
      const template = createShellTemplate()
      const userInput = 'file; rm -rf /'
      expect(template`cat ${userInput}`).toBe("cat 'file; rm -rf /'")
    })
  })

  describe('createShellTemplate with escape: false', () => {
    it('should not escape values', () => {
      const template = createShellTemplate({ escape: false })
      const pattern = '*.ts'
      expect(template`find . -name ${pattern}`).toBe('find . -name *.ts')
    })

    it('should pass through dangerous values unescaped', () => {
      const template = createShellTemplate({ escape: false })
      const cmd = 'rm -rf /'
      // This is dangerous! Only use for trusted input
      expect(template`${cmd}`).toBe('rm -rf /')
    })
  })

  describe('safeTemplate', () => {
    it('should be the same as createShellTemplate with defaults', () => {
      const dangerous = '; rm -rf /'
      expect(safeTemplate`echo ${dangerous}`).toBe("echo '; rm -rf /'")
    })
  })

  describe('rawTemplate', () => {
    it('should not escape values', () => {
      const pattern = '*.ts'
      expect(rawTemplate`find . -name ${pattern}`).toBe('find . -name *.ts')
    })
  })
})

describe('Edge Cases', () => {
  it('should handle very long strings', () => {
    const longString = 'a'.repeat(10000)
    const escaped = shellEscapeArg(longString)
    expect(escaped).toBe(longString) // All alphanumeric, no quotes needed
  })

  it('should handle strings with only special characters', () => {
    expect(shellEscapeArg('!@#$%')).toBe("'!@#$%'")
  })

  it('should handle unicode strings', () => {
    expect(shellEscapeArg('hello')).toBe('hello')
    expect(shellEscapeArg('hello world')).toBe("'hello world'")
  })

  it('should handle tab characters', () => {
    expect(shellEscapeArg('col1\tcol2')).toBe("'col1\tcol2'")
  })

  it('should handle carriage returns', () => {
    expect(shellEscapeArg('line1\r\nline2')).toBe("'line1\r\nline2'")
  })

  it('should handle null bytes', () => {
    expect(shellEscapeArg('before\0after')).toBe("'before\0after'")
  })
})

describe('Real-World Command Examples', () => {
  const template = createShellTemplate()

  it('should safely build git commit command', () => {
    const message = "fix: handle edge case when file doesn't exist"
    expect(template`git commit -m ${message}`).toBe(
      "git commit -m 'fix: handle edge case when file doesn'\"'\"'t exist'"
    )
  })

  it('should safely build grep command with pattern', () => {
    const pattern = 'error.*failed'
    expect(template`grep ${pattern} log.txt`).toBe("grep 'error.*failed' log.txt")
  })

  it('should safely build curl command', () => {
    const url = 'https://api.example.com.ai/data?foo=bar&baz=qux'
    expect(template`curl ${url}`).toBe("curl 'https://api.example.com.ai/data?foo=bar&baz=qux'")
  })

  it('should safely build docker run command', () => {
    const image = 'myapp:latest'
    const env = 'NODE_ENV=production'
    expect(template`docker run -e ${env} ${image}`).toBe(
      'docker run -e NODE_ENV=production myapp:latest'
    )
  })

  it('should safely build find command with exec', () => {
    const dir = '/path with spaces'
    const name = '*.log'
    // Note: for glob patterns, you'd typically use rawTemplate
    expect(template`find ${dir} -name ${name}`).toBe("find '/path with spaces' -name '*.log'")
  })

  it('should safely build ssh command', () => {
    const host = 'user@example.com.ai'
    const cmd = 'ls -la /var/log'
    expect(template`ssh ${host} ${cmd}`).toBe("ssh user@example.com.ai 'ls -la /var/log'")
  })
})

describe('Comparison with Raw', () => {
  it('should demonstrate safe vs raw behavior', () => {
    const safe = createShellTemplate()
    const raw = createShellTemplate({ escape: false })

    const userInput = '$(whoami)'

    // Safe: command substitution is quoted, won't execute
    expect(safe`echo ${userInput}`).toBe("echo '$(whoami)'")

    // Raw: DANGEROUS - command substitution would execute!
    expect(raw`echo ${userInput}`).toBe('echo $(whoami)')
  })
})
