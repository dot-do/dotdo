/**
 * Shared Command Classification Data
 *
 * Single source of truth for command categorization across bashx.
 * This module is imported by both core/safety/analyze.ts and src/ast/analyze.ts
 * to ensure consistent command classification behavior.
 *
 * @packageDocumentation
 */

// ============================================================================
// Read-Only Commands
// ============================================================================

/**
 * Commands that only read data and have no side effects.
 * These commands are safe to execute without confirmation.
 */
export const READ_ONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'awk', 'sed',
  'find', 'which', 'whereis', 'type', 'file', 'stat', 'wc', 'sort',
  'uniq', 'diff', 'cmp', 'pwd', 'echo', 'printf', 'date', 'cal',
  'whoami', 'id', 'groups', 'uname', 'hostname', 'uptime', 'free',
  'df', 'du', 'ps', 'top', 'htop', 'pgrep', 'env', 'printenv',
  'test', '[', '[[', 'true', 'false', 'expr', 'bc', 'seq',
  'basename', 'dirname', 'realpath', 'readlink', 'md5sum', 'sha256sum',
  'git', 'npm', 'node', 'python', 'python3', 'ruby', 'perl',
  'man', 'help', 'info', 'apropos', 'whatis',
  // Shell builtins that don't modify filesystem
  'cd', 'pushd', 'popd', 'dirs', 'alias', 'unalias', 'export', 'set', 'unset',
  'read', 'declare', 'local', 'typeset', 'readonly', 'shift', 'wait', 'jobs',
  'fg', 'bg', 'disown', 'builtin', 'command', 'enable', 'hash', 'history',
  'let', 'logout', 'mapfile', 'readarray', 'return', 'trap', 'ulimit', 'umask',
])

// ============================================================================
// Git Subcommand Classification
// ============================================================================

/**
 * Read-only git subcommands.
 * These git operations only read repository state.
 */
export const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'tag', 'remote',
  'stash', 'describe', 'rev-parse', 'ls-files', 'ls-tree',
  'cat-file', 'shortlog', 'blame', 'bisect', 'config',
])

/**
 * Network-related git subcommands.
 * These git operations require network access.
 */
export const GIT_NETWORK_SUBCOMMANDS = new Set([
  'push', 'fetch', 'pull', 'clone',
])

// ============================================================================
// File Operation Commands
// ============================================================================

/**
 * Commands that delete data.
 * These operations are irreversible and require caution.
 */
export const DELETE_COMMANDS = new Set([
  'rm', 'rmdir', 'unlink', 'shred',
])

/**
 * Commands that write/modify data.
 * These operations modify the filesystem.
 */
export const WRITE_COMMANDS = new Set([
  'cp', 'mv', 'touch', 'mkdir', 'ln',
  'chmod', 'chown', 'chgrp', 'chattr',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'xz',
  'tee', 'install', 'patch',
])

// ============================================================================
// Network Commands
// ============================================================================

/**
 * Commands that perform network operations.
 * These commands access external resources.
 */
export const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'nc', 'netcat', 'ssh', 'scp', 'sftp', 'rsync',
  'ftp', 'telnet', 'ping', 'traceroute', 'nslookup', 'dig', 'host',
  'nmap', 'netstat', 'ss', 'ip', 'ifconfig', 'route',
])

// ============================================================================
// Execute Commands
// ============================================================================

/**
 * Commands that execute other code.
 * These commands run external programs or scripts.
 */
export const EXECUTE_COMMANDS = new Set([
  'exec', 'eval', 'source', '.', 'bash', 'sh', 'zsh', 'fish',
  'xargs', 'parallel', 'nohup', 'timeout', 'time', 'watch',
  'sudo', 'su', 'doas', 'runuser',
])

// ============================================================================
// Critical System Commands
// ============================================================================

/**
 * Critical system commands that should always require confirmation.
 * These commands can cause significant system changes or data loss.
 */
export const CRITICAL_SYSTEM_COMMANDS = new Set([
  'shutdown', 'reboot', 'poweroff', 'halt', 'init',
  'dd', 'mkfs', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.btrfs',
  'fdisk', 'parted', 'gdisk', 'mkswap', 'swapon', 'swapoff',
  'mount', 'umount', 'losetup',
  'iptables', 'ip6tables', 'firewall-cmd', 'ufw',
  'systemctl', 'service', 'chkconfig',
  'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel',
  'passwd', 'chpasswd', 'visudo',
])

// ============================================================================
// Path Classification
// ============================================================================

/**
 * Critical system paths that require elevated privileges.
 * Operations on these paths are considered high-risk.
 */
export const SYSTEM_PATHS = [
  '/', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64',
  '/boot', '/dev', '/sys', '/proc', '/var', '/root', '/home',
]

/**
 * Paths that indicate device access.
 * Operations on these paths can cause data loss.
 */
export const DEVICE_PATHS = ['/dev/sd', '/dev/hd', '/dev/nvme', '/dev/vd', '/dev/loop']
