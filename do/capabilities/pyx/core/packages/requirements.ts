/**
 * requirements.txt Parser
 */

import type { Requirement } from './types'
import { normalizePackageName } from './specifiers'

/**
 * Known pip options that take a value
 */
const PIP_OPTIONS_WITH_VALUE = [
  '--index-url', '-i',
  '--extra-index-url',
  '--no-index',
  '--constraint', '-c',
  '--requirement', '-r',
  '--editable', '-e',
  '--find-links', '-f',
  '--no-binary',
  '--only-binary',
  '--prefer-binary',
  '--require-hashes',
  '--pre',
  '--trusted-host',
  '--use-feature',
  '--no-build-isolation',
  '--config-settings',
  '--global-option',
  '--hash',
]

/**
 * Version specifier operators (ordered by length for proper matching)
 */
const VERSION_OPERATORS = ['===', '~=', '==', '!=', '<=', '>=', '<', '>']

/**
 * Parse a requirements.txt file content
 */
export function parseRequirementsTxt(content: string): Requirement[] {
  const requirements: Requirement[] = []

  // Handle line continuations first
  const normalizedContent = content.replace(/\\\n\s*/g, '')

  const lines = normalizedContent.split('\n')

  for (const rawLine of lines) {
    // Check if line starts with a comment
    const trimmedRaw = rawLine.trim()
    if (trimmedRaw.startsWith('#')) continue
    if (!trimmedRaw) continue

    // For lines with URLs (git+, http://, etc), don't strip # as comments
    // since # is used for fragments like #egg=package
    let line: string
    if (trimmedRaw.includes('git+') || trimmedRaw.includes('://')) {
      // Don't remove anything after # for URL lines
      line = trimmedRaw
    } else {
      // Remove inline comments for non-URL lines
      const commentIndex = trimmedRaw.indexOf('#')
      line = (commentIndex >= 0 ? trimmedRaw.slice(0, commentIndex) : trimmedRaw).trim()
    }

    if (!line) continue

    const req = parseLine(line)
    if (req) {
      requirements.push(req)
    }
  }

  return requirements
}

/**
 * Parse a single requirements line
 */
function parseLine(line: string): Requirement | null {
  // Handle -r / --requirement (includes)
  if (line.startsWith('-r ') || line.startsWith('--requirement ')) {
    const path = line.replace(/^(-r|--requirement)\s+/, '').trim()
    return { type: 'include', path }
  }

  // Handle -c / --constraint
  if (line.startsWith('-c ') || line.startsWith('--constraint ')) {
    const path = line.replace(/^(-c|--constraint)\s+/, '').trim()
    return { type: 'constraint', path }
  }

  // Handle -e / --editable
  if (line.startsWith('-e ') || line.startsWith('--editable ')) {
    const value = line.replace(/^(-e|--editable)\s+/, '').trim()

    // Check if it's a URL or path
    if (value.includes('://') || value.startsWith('git+')) {
      return { type: 'editable', editable: true, url: value }
    }
    return { type: 'editable', editable: true, path: value }
  }

  // Handle other pip options
  for (const opt of PIP_OPTIONS_WITH_VALUE) {
    if (line.startsWith(opt + ' ') || line.startsWith(opt + '=')) {
      const value = line.slice(opt.length + 1).trim()
      return { type: 'option', option: opt, value }
    }
    // Handle short options without space (e.g., -i)
    if (opt.startsWith('-') && !opt.startsWith('--') && line.startsWith(opt)) {
      const value = line.slice(opt.length).trim()
      return { type: 'option', option: opt, value }
    }
  }

  // Parse package requirement
  return parsePackageRequirement(line)
}

/**
 * Parse a package requirement string
 */
function parsePackageRequirement(line: string): Requirement | null {
  let remaining = line.trim()
  let name = ''
  let extras: string[] = []
  let specifiers: Array<{ op: string; version: string }> = []
  let marker: string | undefined
  let url: string | undefined

  // Check for environment markers (split on ';' not inside quotes)
  const markerMatch = remaining.match(/;\s*(.+)$/)
  if (markerMatch) {
    marker = markerMatch[1].trim()
    remaining = remaining.slice(0, remaining.length - markerMatch[0].length).trim()
  }

  // Check for URL-based requirement (package @ url)
  const urlMatch = remaining.match(/^([a-zA-Z0-9_.-]+)(\[[^\]]+\])?\s*@\s*(.+)$/)
  if (urlMatch) {
    name = urlMatch[1]
    if (urlMatch[2]) {
      extras = urlMatch[2].slice(1, -1).split(',').map(e => e.trim())
    }
    url = urlMatch[3].trim()

    return {
      type: 'package',
      name,
      normalizedName: normalizePackageName(name),
      extras: extras.length > 0 ? extras : undefined,
      specifiers: [],
      url,
      marker,
    }
  }

  // Parse package name and extras
  const nameExtrasMatch = remaining.match(/^([a-zA-Z0-9_.-]+)(\[[^\]]+\])?/)
  if (!nameExtrasMatch) {
    return null
  }

  name = nameExtrasMatch[1]
  if (nameExtrasMatch[2]) {
    extras = nameExtrasMatch[2].slice(1, -1).split(',').map(e => e.trim())
  }
  remaining = remaining.slice(nameExtrasMatch[0].length).trim()

  // Parse version specifiers
  if (remaining) {
    specifiers = parseSpecifiers(remaining)
  }

  return {
    type: 'package',
    name,
    normalizedName: normalizePackageName(name),
    extras: extras.length > 0 ? extras : undefined,
    specifiers,
    marker,
  }
}

/**
 * Parse version specifiers (e.g., ">=1.0,<2.0")
 */
function parseSpecifiers(specStr: string): Array<{ op: string; version: string }> {
  const specifiers: Array<{ op: string; version: string }> = []
  const parts = specStr.split(',')

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // Find operator
    let op = ''
    let version = ''

    for (const operator of VERSION_OPERATORS) {
      if (trimmed.startsWith(operator)) {
        op = operator
        version = trimmed.slice(operator.length).trim()
        break
      }
    }

    if (op && version) {
      specifiers.push({ op, version })
    }
  }

  return specifiers
}
