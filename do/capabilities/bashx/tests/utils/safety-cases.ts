/**
 * Safety Test Cases
 *
 * Comprehensive test cases for command safety classification.
 * Organized by safety level: safe, dangerous, and critical.
 */

import type { CommandClassification, Intent } from '../../src/types.js'

export interface SafetyTestCase {
  /** The command to test */
  command: string
  /** Human-readable description */
  description: string
  /** Expected classification */
  expectedClassification: CommandClassification
  /** Expected intent extraction */
  expectedIntent: Intent
}

// ============================================================================
// SAFE Commands (no confirmation required)
// ============================================================================

export const SAFE_COMMANDS: SafetyTestCase[] = [
  {
    command: 'ls',
    description: 'Simple directory listing',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only command that lists directory contents',
    },
    expectedIntent: {
      commands: ['ls'],
      reads: ['.'],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'ls -la /tmp',
    description: 'Detailed directory listing',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only command that lists directory contents',
    },
    expectedIntent: {
      commands: ['ls'],
      reads: ['/tmp'],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'cat package.json',
    description: 'Read file contents',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only command that displays file contents',
    },
    expectedIntent: {
      commands: ['cat'],
      reads: ['package.json'],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'pwd',
    description: 'Print working directory',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only command that prints current directory',
    },
    expectedIntent: {
      commands: ['pwd'],
      reads: ['.'],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'echo "hello world"',
    description: 'Echo text',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only command that echoes text',
    },
    expectedIntent: {
      commands: ['echo'],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'git status',
    description: 'Git repository status',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only git command',
    },
    expectedIntent: {
      commands: ['git'],
      reads: ['.git'],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'git log --oneline -5',
    description: 'Git log history',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only git command',
    },
    expectedIntent: {
      commands: ['git'],
      reads: ['.git'],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'which node',
    description: 'Locate command binary',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only command lookup',
    },
    expectedIntent: {
      commands: ['which'],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'date',
    description: 'Display current date',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only system information',
    },
    expectedIntent: {
      commands: ['date'],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'head -20 README.md',
    description: 'Read first lines of file',
    expectedClassification: {
      type: 'read',
      impact: 'none',
      reversible: true,
      reason: 'Read-only file access',
    },
    expectedIntent: {
      commands: ['head'],
      reads: ['README.md'],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
]

// ============================================================================
// DANGEROUS Commands (may require confirmation)
// ============================================================================

export const DANGEROUS_COMMANDS: SafetyTestCase[] = [
  {
    command: 'rm file.txt',
    description: 'Remove a single file',
    expectedClassification: {
      type: 'delete',
      impact: 'medium',
      reversible: false,
      reason: 'Deletes file permanently',
    },
    expectedIntent: {
      commands: ['rm'],
      reads: [],
      writes: [],
      deletes: ['file.txt'],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'rm -r directory/',
    description: 'Remove directory recursively',
    expectedClassification: {
      type: 'delete',
      impact: 'high',
      reversible: false,
      reason: 'Recursively deletes directory and contents',
    },
    expectedIntent: {
      commands: ['rm'],
      reads: [],
      writes: [],
      deletes: ['directory/'],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'mv important.txt /tmp/',
    description: 'Move file to different location',
    expectedClassification: {
      type: 'write',
      impact: 'medium',
      reversible: true,
      reason: 'Moves file to new location',
    },
    expectedIntent: {
      commands: ['mv'],
      reads: ['important.txt'],
      writes: ['/tmp/'],
      deletes: ['important.txt'],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'chmod 755 script.sh',
    description: 'Change file permissions',
    expectedClassification: {
      type: 'write',
      impact: 'medium',
      reversible: true,
      reason: 'Modifies file permissions',
    },
    expectedIntent: {
      commands: ['chmod'],
      reads: [],
      writes: ['script.sh'],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'chown user:group file.txt',
    description: 'Change file ownership',
    expectedClassification: {
      type: 'write',
      impact: 'medium',
      reversible: true,
      reason: 'Modifies file ownership',
    },
    expectedIntent: {
      commands: ['chown'],
      reads: [],
      writes: ['file.txt'],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'git push origin main',
    description: 'Push to remote repository',
    expectedClassification: {
      type: 'network',
      impact: 'medium',
      reversible: true,
      reason: 'Pushes changes to remote repository',
    },
    expectedIntent: {
      commands: ['git'],
      reads: ['.git'],
      writes: [],
      deletes: [],
      network: true,
      elevated: false,
    },
  },
  {
    command: 'npm publish',
    description: 'Publish package to npm registry',
    expectedClassification: {
      type: 'network',
      impact: 'high',
      reversible: false,
      reason: 'Publishes package to public registry',
    },
    expectedIntent: {
      commands: ['npm'],
      reads: ['.'],
      writes: [],
      deletes: [],
      network: true,
      elevated: false,
    },
  },
  {
    command: 'curl -X POST https://api.example.com.ai/data',
    description: 'HTTP POST request',
    expectedClassification: {
      type: 'network',
      impact: 'medium',
      reversible: false,
      reason: 'Sends data to remote server',
    },
    expectedIntent: {
      commands: ['curl'],
      reads: [],
      writes: [],
      deletes: [],
      network: true,
      elevated: false,
    },
  },
  {
    command: 'echo "secret" > /etc/passwd',
    description: 'Write to system file',
    expectedClassification: {
      type: 'write',
      impact: 'high',
      reversible: false,
      reason: 'Writes to system configuration file',
    },
    expectedIntent: {
      commands: ['echo'],
      reads: [],
      writes: ['/etc/passwd'],
      deletes: [],
      network: false,
      elevated: true,
    },
  },
  {
    command: 'kill -9 1234',
    description: 'Force kill process',
    expectedClassification: {
      type: 'system',
      impact: 'high',
      reversible: false,
      reason: 'Force terminates a running process',
    },
    expectedIntent: {
      commands: ['kill'],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
]

// ============================================================================
// CRITICAL Commands (always require explicit confirmation)
// ============================================================================

export const CRITICAL_COMMANDS: SafetyTestCase[] = [
  {
    command: 'rm -rf /',
    description: 'Recursive delete of root filesystem',
    expectedClassification: {
      type: 'delete',
      impact: 'critical',
      reversible: false,
      reason: 'Attempts to delete entire filesystem',
    },
    expectedIntent: {
      commands: ['rm'],
      reads: [],
      writes: [],
      deletes: ['/'],
      network: false,
      elevated: true,
    },
  },
  {
    command: 'rm -rf /*',
    description: 'Delete all root-level directories',
    expectedClassification: {
      type: 'delete',
      impact: 'critical',
      reversible: false,
      reason: 'Deletes all root-level directories',
    },
    expectedIntent: {
      commands: ['rm'],
      reads: [],
      writes: [],
      deletes: ['/*'],
      network: false,
      elevated: true,
    },
  },
  {
    command: 'rm -rf ~/',
    description: 'Delete entire home directory',
    expectedClassification: {
      type: 'delete',
      impact: 'critical',
      reversible: false,
      reason: 'Deletes entire home directory',
    },
    expectedIntent: {
      commands: ['rm'],
      reads: [],
      writes: [],
      deletes: ['~/'],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'sudo rm -rf /',
    description: 'Elevated recursive delete of root',
    expectedClassification: {
      type: 'delete',
      impact: 'critical',
      reversible: false,
      reason: 'Elevated command to delete entire filesystem',
    },
    expectedIntent: {
      commands: ['sudo', 'rm'],
      reads: [],
      writes: [],
      deletes: ['/'],
      network: false,
      elevated: true,
    },
  },
  {
    command: 'chmod -R 777 /',
    description: 'Recursively set permissive permissions on root',
    expectedClassification: {
      type: 'system',
      impact: 'critical',
      reversible: false,
      reason: 'Sets unsafe permissions on entire filesystem',
    },
    expectedIntent: {
      commands: ['chmod'],
      reads: [],
      writes: ['/'],
      deletes: [],
      network: false,
      elevated: true,
    },
  },
  {
    command: 'chown -R root:root /',
    description: 'Recursively change ownership of root',
    expectedClassification: {
      type: 'system',
      impact: 'critical',
      reversible: false,
      reason: 'Changes ownership of entire filesystem',
    },
    expectedIntent: {
      commands: ['chown'],
      reads: [],
      writes: ['/'],
      deletes: [],
      network: false,
      elevated: true,
    },
  },
  {
    command: 'dd if=/dev/zero of=/dev/sda',
    description: 'Overwrite disk device',
    expectedClassification: {
      type: 'system',
      impact: 'critical',
      reversible: false,
      reason: 'Overwrites disk device with zeros',
    },
    expectedIntent: {
      commands: ['dd'],
      reads: ['/dev/zero'],
      writes: ['/dev/sda'],
      deletes: [],
      network: false,
      elevated: true,
    },
  },
  {
    command: 'mkfs.ext4 /dev/sda1',
    description: 'Format disk partition',
    expectedClassification: {
      type: 'system',
      impact: 'critical',
      reversible: false,
      reason: 'Formats disk partition, destroying all data',
    },
    expectedIntent: {
      commands: ['mkfs.ext4'],
      reads: [],
      writes: ['/dev/sda1'],
      deletes: [],
      network: false,
      elevated: true,
    },
  },
  {
    command: ':(){ :|:& };:',
    description: 'Fork bomb',
    expectedClassification: {
      type: 'system',
      impact: 'critical',
      reversible: false,
      reason: 'Fork bomb that crashes the system',
    },
    expectedIntent: {
      commands: [':'],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
  },
  {
    command: 'shutdown -h now',
    description: 'Immediate system shutdown',
    expectedClassification: {
      type: 'system',
      impact: 'critical',
      reversible: false,
      reason: 'Immediately shuts down the system',
    },
    expectedIntent: {
      commands: ['shutdown'],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: true,
    },
  },
  {
    command: 'reboot',
    description: 'System reboot',
    expectedClassification: {
      type: 'system',
      impact: 'critical',
      reversible: false,
      reason: 'Reboots the system',
    },
    expectedIntent: {
      commands: ['reboot'],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: true,
    },
  },
]

// ============================================================================
// ALL COMMANDS (for convenience)
// ============================================================================

export const ALL_SAFETY_CASES = [
  ...SAFE_COMMANDS,
  ...DANGEROUS_COMMANDS,
  ...CRITICAL_COMMANDS,
]

// ============================================================================
// Helper functions
// ============================================================================

export function getSafetyCaseByCommand(command: string): SafetyTestCase | undefined {
  return ALL_SAFETY_CASES.find((c) => c.command === command)
}

export function getSafeCases(): SafetyTestCase[] {
  return SAFE_COMMANDS
}

export function getDangerousCases(): SafetyTestCase[] {
  return DANGEROUS_COMMANDS
}

export function getCriticalCases(): SafetyTestCase[] {
  return CRITICAL_COMMANDS
}
