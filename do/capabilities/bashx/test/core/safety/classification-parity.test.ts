/**
 * Classification Parity Tests (RED phase)
 *
 * Documents the duplication problem between core/safety/analyze.ts and
 * src/ast/analyze.ts. Both files contain identical command classification
 * data (READ_ONLY_COMMANDS, DELETE_COMMANDS, etc.) that can diverge.
 *
 * This test verifies that both implementations classify commands identically.
 * Any divergence between the two implementations will cause these tests to fail.
 *
 * @module test/safety/classification-parity.test.ts
 */

import { describe, it, expect } from 'vitest'
import { classifyCommand as coreClassifyCommand } from '../../../core/safety/analyze.js'
import { classifyCommand as srcClassifyCommand } from '../../../src/ast/analyze.js'

describe('classification parity', () => {
  /**
   * Test commands covering all categories:
   * - Read operations (ls, cat)
   * - Delete operations (rm)
   * - Network operations (curl)
   * - Elevated/system operations (sudo)
   * - Write operations (touch, chmod)
   */
  const testCommands: Array<{ cmd: string; args: string[] }> = [
    // Read-only commands
    { cmd: 'ls', args: ['-la'] },
    { cmd: 'cat', args: ['file.txt'] },
    { cmd: 'grep', args: ['pattern', 'file.txt'] },
    { cmd: 'find', args: ['.', '-name', '*.ts'] },
    { cmd: 'pwd', args: [] },
    { cmd: 'echo', args: ['hello'] },
    { cmd: 'git', args: ['status'] },
    { cmd: 'git', args: ['log'] },

    // Delete commands
    { cmd: 'rm', args: ['file.txt'] },
    { cmd: 'rm', args: ['-rf', '/'] },
    { cmd: 'rm', args: ['-r', 'directory'] },
    { cmd: 'rmdir', args: ['empty-dir'] },

    // Write commands
    { cmd: 'touch', args: ['newfile.txt'] },
    { cmd: 'mkdir', args: ['newdir'] },
    { cmd: 'cp', args: ['src.txt', 'dest.txt'] },
    { cmd: 'mv', args: ['old.txt', 'new.txt'] },
    { cmd: 'chmod', args: ['755', 'script.sh'] },
    { cmd: 'chown', args: ['user:group', 'file.txt'] },

    // Network commands
    { cmd: 'curl', args: ['https://api.example.com'] },
    { cmd: 'curl', args: ['-X', 'POST', 'https://api.example.com'] },
    { cmd: 'wget', args: ['https://example.com/file.zip'] },
    { cmd: 'ssh', args: ['user@host'] },
    { cmd: 'scp', args: ['file.txt', 'user@host:/path/'] },

    // Git network operations
    { cmd: 'git', args: ['push'] },
    { cmd: 'git', args: ['pull'] },
    { cmd: 'git', args: ['fetch'] },
    { cmd: 'git', args: ['clone', 'https://github.com/repo'] },

    // Elevated commands
    { cmd: 'sudo', args: ['apt', 'install', 'vim'] },
    { cmd: 'sudo', args: ['rm', '-rf', '/tmp/cache'] },
    { cmd: 'su', args: ['root'] },
    { cmd: 'doas', args: ['pkg_add', 'vim'] },

    // System commands
    { cmd: 'shutdown', args: ['-h', 'now'] },
    { cmd: 'reboot', args: [] },
    { cmd: 'systemctl', args: ['restart', 'nginx'] },
    { cmd: 'mount', args: ['/dev/sda1', '/mnt'] },

    // Execute commands
    { cmd: 'eval', args: ['$cmd'] },
    { cmd: 'source', args: ['script.sh'] },
    { cmd: 'bash', args: ['-c', 'echo test'] },
    { cmd: 'exec', args: ['/bin/sh'] },

    // npm commands
    { cmd: 'npm', args: ['install'] },
    { cmd: 'npm', args: ['publish'] },
    { cmd: 'npm', args: ['list'] },

    // Kill commands
    { cmd: 'kill', args: ['1234'] },
    { cmd: 'kill', args: ['-9', '1234'] },
    { cmd: 'killall', args: ['process'] },

    // dd command
    { cmd: 'dd', args: ['if=/dev/zero', 'of=/dev/sda'] },
    { cmd: 'dd', args: ['if=input.img', 'of=output.img'] },

    // Unknown command
    { cmd: 'unknown-tool', args: ['--flag', 'arg'] },
  ]

  testCommands.forEach(({ cmd, args }) => {
    const argsStr = args.length > 0 ? ` ${args.join(' ')}` : ''
    it(`should classify "${cmd}${argsStr}" identically in core and src`, () => {
      const coreResult = coreClassifyCommand(cmd, args)
      const srcResult = srcClassifyCommand(cmd, args)

      // Compare type classification
      expect(coreResult.type).toBe(srcResult.type)

      // Compare impact level
      expect(coreResult.impact).toBe(srcResult.impact)

      // Compare reversibility
      expect(coreResult.reversible).toBe(srcResult.reversible)

      // Reason may differ slightly in wording, but should be semantically equivalent
      // For strict parity, we require identical reasons too
      expect(coreResult.reason).toBe(srcResult.reason)
    })
  })

  describe('command set parity', () => {
    it('should have identical READ_ONLY_COMMANDS sets', () => {
      // Test a selection of read-only commands to verify both recognize them
      const readOnlyCommands = [
        'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'awk', 'sed',
        'find', 'which', 'whereis', 'type', 'file', 'stat', 'wc', 'sort',
        'uniq', 'diff', 'cmp', 'pwd', 'echo', 'printf', 'date', 'cal',
        'whoami', 'id', 'groups', 'uname', 'hostname', 'uptime', 'free',
        'df', 'du', 'ps', 'top', 'htop', 'pgrep', 'env', 'printenv',
        'test', '[', '[[', 'true', 'false', 'expr', 'bc', 'seq',
        'basename', 'dirname', 'realpath', 'readlink', 'md5sum', 'sha256sum',
        'man', 'help', 'info', 'apropos', 'whatis',
        'cd', 'pushd', 'popd', 'dirs', 'alias', 'unalias', 'export', 'set', 'unset',
      ]

      for (const cmd of readOnlyCommands) {
        const coreResult = coreClassifyCommand(cmd, [])
        const srcResult = srcClassifyCommand(cmd, [])
        expect(coreResult.type, `${cmd} should be classified identically`).toBe(srcResult.type)
      }
    })

    it('should have identical DELETE_COMMANDS sets', () => {
      const deleteCommands = ['rm', 'rmdir', 'unlink', 'shred']

      for (const cmd of deleteCommands) {
        const coreResult = coreClassifyCommand(cmd, ['target'])
        const srcResult = srcClassifyCommand(cmd, ['target'])
        expect(coreResult.type, `${cmd} should be classified identically`).toBe(srcResult.type)
      }
    })

    it('should have identical NETWORK_COMMANDS sets', () => {
      const networkCommands = [
        'curl', 'wget', 'nc', 'netcat', 'ssh', 'scp', 'sftp', 'rsync',
        'ftp', 'telnet', 'ping', 'traceroute', 'nslookup', 'dig', 'host',
        'nmap', 'netstat', 'ss', 'ip', 'ifconfig', 'route',
      ]

      for (const cmd of networkCommands) {
        const coreResult = coreClassifyCommand(cmd, [])
        const srcResult = srcClassifyCommand(cmd, [])
        expect(coreResult.type, `${cmd} should be classified identically`).toBe(srcResult.type)
      }
    })

    it('should have identical CRITICAL_SYSTEM_COMMANDS sets', () => {
      const criticalCommands = [
        'shutdown', 'reboot', 'poweroff', 'halt', 'init',
        'dd', 'mkfs', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.btrfs',
        'fdisk', 'parted', 'gdisk', 'mkswap', 'swapon', 'swapoff',
        'mount', 'umount', 'losetup',
        'iptables', 'ip6tables', 'firewall-cmd', 'ufw',
        'systemctl', 'service', 'chkconfig',
        'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel',
        'passwd', 'chpasswd', 'visudo',
      ]

      for (const cmd of criticalCommands) {
        const coreResult = coreClassifyCommand(cmd, [])
        const srcResult = srcClassifyCommand(cmd, [])
        expect(coreResult.type, `${cmd} should be classified identically`).toBe(srcResult.type)
        expect(coreResult.impact, `${cmd} impact should be identical`).toBe(srcResult.impact)
      }
    })
  })
})
