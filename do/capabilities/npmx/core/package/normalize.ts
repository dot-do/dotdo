/**
 * Package.json Normalization Functions
 *
 * Functions to normalize various package.json fields to canonical forms.
 * This module has ZERO Cloudflare dependencies.
 */

import type {
  NormalizedRepository,
  RepositoryField,
} from './types.js'

// =============================================================================
// Repository Normalization
// =============================================================================

/**
 * Normalizes a repository field to a standard object format.
 *
 * Handles:
 * - GitHub shorthand: "user/repo" or "github:user/repo"
 * - GitLab shorthand: "gitlab:user/repo"
 * - Bitbucket shorthand: "bitbucket:user/repo"
 * - git:// URLs
 * - SSH URLs: git@github.com:user/repo.git
 * - Full repository objects
 */
export function normalizeRepository(
  repository: RepositoryField | undefined
): NormalizedRepository | undefined {
  if (repository === undefined || repository === null) {
    return undefined
  }

  // Already an object
  if (typeof repository === 'object') {
    // Normalize the URL if it's a git:// URL
    let url = repository.url
    if (url.startsWith('git://')) {
      url = `git+https://${url.slice(6)}`
    }
    return {
      type: repository.type,
      url,
      ...(repository.directory ? { directory: repository.directory } : {}),
    }
  }

  // String repository
  const repo = repository.trim()

  // GitHub shorthand: "user/repo"
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repo)) {
    return {
      type: 'git',
      url: `git+https://github.com/${repo}.git`,
    }
  }

  // Provider shorthand: "github:user/repo", "gitlab:user/repo", "bitbucket:user/repo"
  const providerMatch = repo.match(/^(github|gitlab|bitbucket):([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)$/)
  if (providerMatch) {
    const [, provider, path] = providerMatch
    const hosts: Record<string, string> = {
      github: 'github.com',
      gitlab: 'gitlab.com',
      bitbucket: 'bitbucket.org',
    }
    const host = hosts[provider!]
    return {
      type: 'git',
      url: `git+https://${host}/${path}.git`,
    }
  }

  // git:// URL
  if (repo.startsWith('git://')) {
    return {
      type: 'git',
      url: `git+https://${repo.slice(6)}`,
    }
  }

  // SSH URL: git@github.com:user/repo.git
  const sshMatch = repo.match(/^git@([^:]+):(.+)$/)
  if (sshMatch) {
    const [, host, path] = sshMatch
    return {
      type: 'git',
      url: `git+ssh://git@${host}/${path}`,
    }
  }

  // Already a full URL
  if (repo.startsWith('http://') || repo.startsWith('https://') || repo.startsWith('git+')) {
    return {
      type: 'git',
      url: repo,
    }
  }

  // Unknown format, return as-is
  return {
    type: 'git',
    url: repo,
  }
}

// =============================================================================
// Path Normalization
// =============================================================================

/**
 * Normalizes a file path to start with "./"
 */
export function normalizePath(path: string): string {
  if (!path) return path
  if (path.startsWith('./') || path.startsWith('../') || path.startsWith('/')) {
    return path
  }
  return `./${path}`
}

// =============================================================================
// Keywords Normalization
// =============================================================================

/**
 * Normalizes keywords array:
 * - Lowercase
 * - Trim whitespace
 * - Remove duplicates
 * - Filter empty strings
 * - Filter non-strings
 */
export function normalizeKeywords(keywords: unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const keyword of keywords) {
    if (typeof keyword !== 'string') continue

    const normalized = keyword.trim().toLowerCase()
    if (normalized.length === 0) continue
    if (seen.has(normalized)) continue

    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

// =============================================================================
// Author/Person Normalization
// =============================================================================

/**
 * Parses a person string into an object.
 * Format: "Name <email> (url)"
 */
export function parsePerson(person: string): { name: string; email?: string; url?: string } {
  const emailMatch = person.match(/<([^>]+)>/)
  const urlMatch = person.match(/\(([^)]+)\)/)

  let name = person
  if (emailMatch) {
    name = name.replace(emailMatch[0], '').trim()
  }
  if (urlMatch) {
    name = name.replace(urlMatch[0], '').trim()
  }

  return {
    name,
    ...(emailMatch ? { email: emailMatch[1] } : {}),
    ...(urlMatch ? { url: urlMatch[1] } : {}),
  }
}
