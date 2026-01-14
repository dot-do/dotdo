/**
 * Formatting utilities for CLI output
 */

import type { LsEntry, LsFormatOptions } from '../types'

/**
 * Format permission mode to string (e.g., -rw-r--r--)
 */
export function formatMode(mode: number, type: 'file' | 'directory' | 'symlink'): string {
  const prefix = type === 'directory' ? 'd' : type === 'symlink' ? 'l' : '-'
  const perms = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-',
  ].join('')
  return prefix + perms
}

/**
 * Month names for date formatting
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/**
 * Format date for ls -l output
 */
export function formatDate(mtime: number): string {
  const date = new Date(mtime)
  const month = MONTHS[date.getMonth()]
  const day = date.getDate().toString().padStart(2, ' ')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${month} ${day} ${hours}:${minutes}`
}

/**
 * Format ls output with support for long format and showAll
 */
export function formatLsOutput(entries: LsEntry[], options: LsFormatOptions = {}): string {
  const { long = false, showAll = false } = options

  // Add . and .. if showAll is true
  let allEntries = [...entries]
  if (showAll) {
    const now = Date.now()
    allEntries = [
      { name: '.', type: 'directory' as const, size: 0, mode: 0o755, mtime: now },
      { name: '..', type: 'directory' as const, size: 0, mode: 0o755, mtime: now },
      ...allEntries
    ]
  }

  if (!long) {
    return allEntries.map(e => e.name).join('\n')
  }

  // Long format: permissions, size, date, name
  return allEntries.map(entry => {
    const perms = formatMode(entry.mode, entry.type)
    const size = entry.size.toString().padStart(8, ' ')
    const date = formatDate(entry.mtime)
    return `${perms} ${size} ${date} ${entry.name}`
  }).join('\n')
}
