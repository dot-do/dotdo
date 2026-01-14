/**
 * Python Package Manifest Parsing
 *
 * Parsers for:
 * - pyproject.toml (PEP 517/518/621)
 * - requirements.txt
 * - setup.py (legacy)
 * - setup.cfg (legacy)
 */

export type {
  VersionSpecifier,
  VersionOperator,
  PythonVersionConstraint,
  Requirement,
  PersonInfo,
  LicenseInfo,
  ProjectSection,
  BuildSystemSection,
  PyprojectToml,
  PackageMetadata,
  ParsedDependency,
} from './types'

export {
  parseVersionSpecifier,
  parseVersionSpecifiers,
  parsePythonVersionConstraint,
  normalizePackageName,
  compareVersions,
  satisfies,
  satisfiesSpecifier,
} from './specifiers'

export { parsePyprojectToml } from './pyproject'
export { parseRequirementsTxt } from './requirements'

import type { PackageMetadata } from './types'
import { parsePyprojectToml } from './pyproject'
import { parseRequirementsTxt } from './requirements'
import { normalizePackageName } from './specifiers'

/**
 * Extract package metadata from various Python package manifest formats
 */
export function extractPackageMetadata(
  content: string,
  filename?: string
): PackageMetadata {
  // Auto-detect format from content if filename not provided
  const source = detectFormat(content, filename)

  switch (source) {
    case 'pyproject.toml':
      return extractFromPyproject(content)
    case 'setup.py':
      return extractFromSetupPy(content)
    case 'setup.cfg':
      return extractFromSetupCfg(content)
    default:
      // Try pyproject.toml format
      return extractFromPyproject(content)
  }
}

/**
 * Detect the format of package manifest content
 */
function detectFormat(
  content: string,
  filename?: string
): 'pyproject.toml' | 'setup.py' | 'setup.cfg' {
  if (filename) {
    if (filename.endsWith('pyproject.toml')) return 'pyproject.toml'
    if (filename.endsWith('setup.py')) return 'setup.py'
    if (filename.endsWith('setup.cfg')) return 'setup.cfg'
  }

  // Auto-detect from content
  if (content.includes('[project]') || content.includes('[build-system]')) {
    return 'pyproject.toml'
  }
  if (content.includes('setup(') || content.includes('from setuptools import')) {
    return 'setup.py'
  }
  if (content.includes('[metadata]') || content.includes('[options]')) {
    return 'setup.cfg'
  }

  return 'pyproject.toml'
}

/**
 * Extract metadata from pyproject.toml content
 */
function extractFromPyproject(content: string): PackageMetadata {
  const pyproject = parsePyprojectToml(content)
  const project = pyproject.project

  const metadata: PackageMetadata = {
    source: 'pyproject.toml',
  }

  if (project) {
    metadata.name = project.name
    metadata.normalizedName = project.name ? normalizePackageName(project.name) : undefined
    metadata.version = project.version
    metadata.description = project.description
    metadata.requiresPython = project.requiresPython
    metadata.dependencies = project.dependencies
    metadata.optionalDependencies = project.optionalDependencies

    // Parse dependencies into structured format
    if (project.dependencies && project.dependencies.length > 0) {
      metadata.parsedDependencies = parseRequirementsTxt(project.dependencies.join('\n'))
    }

    // Convert scripts to entry points format
    if (project.scripts) {
      metadata.entryPoints = metadata.entryPoints ?? {}
      metadata.entryPoints.console_scripts = Object.entries(project.scripts).map(
        ([name, value]) => `${name} = ${value}`
      )
    }
    if (project.guiScripts) {
      metadata.entryPoints = metadata.entryPoints ?? {}
      metadata.entryPoints.gui_scripts = Object.entries(project.guiScripts).map(
        ([name, value]) => `${name} = ${value}`
      )
    }
  }

  return metadata
}

/**
 * Extract metadata from setup.py content (basic regex parsing)
 */
function extractFromSetupPy(content: string): PackageMetadata {
  const metadata: PackageMetadata = {
    source: 'setup.py',
  }

  // Extract name
  const nameMatch = content.match(/name\s*=\s*['"]([^'"]+)['"]/)
  if (nameMatch) {
    metadata.name = nameMatch[1]
    metadata.normalizedName = normalizePackageName(nameMatch[1])
  }

  // Extract version
  const versionMatch = content.match(/version\s*=\s*['"]([^'"]+)['"]/)
  if (versionMatch) {
    metadata.version = versionMatch[1]
  }

  // Extract description
  const descMatch = content.match(/description\s*=\s*['"]([^'"]+)['"]/)
  if (descMatch) {
    metadata.description = descMatch[1]
  }

  // Extract install_requires
  const installRequiresMatch = content.match(/install_requires\s*=\s*\[([\s\S]*?)\]/)
  if (installRequiresMatch) {
    const deps = extractListItems(installRequiresMatch[1])
    metadata.dependencies = deps
    if (deps.length > 0) {
      metadata.parsedDependencies = parseRequirementsTxt(deps.join('\n'))
    }
  }

  // Extract extras_require
  const extrasMatch = content.match(/extras_require\s*=\s*\{([\s\S]*?)\}/)
  if (extrasMatch) {
    metadata.optionalDependencies = parseExtrasDict(extrasMatch[1])
  }

  // Extract python_requires
  const pythonRequiresMatch = content.match(/python_requires\s*=\s*['"]([^'"]+)['"]/)
  if (pythonRequiresMatch) {
    metadata.requiresPython = pythonRequiresMatch[1]
  }

  return metadata
}

/**
 * Extract metadata from setup.cfg content (INI-like parsing)
 */
function extractFromSetupCfg(content: string): PackageMetadata {
  const metadata: PackageMetadata = {
    source: 'setup.cfg',
  }

  const sections = parseIniSections(content)

  // [metadata] section
  const metadataSection = sections.metadata
  if (metadataSection) {
    metadata.name = metadataSection.name?.trim()
    metadata.normalizedName = metadata.name ? normalizePackageName(metadata.name) : undefined
    metadata.version = metadataSection.version?.trim()
    metadata.description = metadataSection.description?.trim()
  }

  // [options] section
  const optionsSection = sections.options
  if (optionsSection) {
    if (optionsSection.python_requires) {
      metadata.requiresPython = optionsSection.python_requires.trim()
    }
    if (optionsSection.install_requires) {
      const deps = optionsSection.install_requires
        .split('\n')
        .map(d => d.trim())
        .filter(d => d && !d.startsWith('#'))
      metadata.dependencies = deps
      if (deps.length > 0) {
        metadata.parsedDependencies = parseRequirementsTxt(deps.join('\n'))
      }
    }
  }

  // [options.extras_require] section
  const extrasSection = sections['options.extras_require']
  if (extrasSection) {
    metadata.optionalDependencies = {}
    for (const [key, value] of Object.entries(extrasSection)) {
      if (typeof value === 'string') {
        metadata.optionalDependencies[key] = value
          .split('\n')
          .map(d => d.trim())
          .filter(d => d && !d.startsWith('#'))
      }
    }
  }

  return metadata
}

/**
 * Extract list items from a Python list literal string
 */
function extractListItems(listContent: string): string[] {
  const items: string[] = []
  const matches = listContent.matchAll(/['"]([^'"]+)['"]/g)
  for (const match of matches) {
    items.push(match[1])
  }
  return items
}

/**
 * Parse a Python dict literal for extras_require
 */
function parseExtrasDict(dictContent: string): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const keyValuePattern = /['"]([^'"]+)['"]\s*:\s*\[([\s\S]*?)\]/g

  let match
  while ((match = keyValuePattern.exec(dictContent)) !== null) {
    const key = match[1]
    const items = extractListItems(match[2])
    result[key] = items
  }

  return result
}

/**
 * Parse INI-like sections from setup.cfg
 */
function parseIniSections(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {}
  let currentSection = ''

  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue
    }

    // Check for section header
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      sections[currentSection] = {}
      continue
    }

    // Parse key = value
    if (currentSection) {
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim()
        const value = trimmed.slice(eqIndex + 1).trim()
        sections[currentSection][key] = value
      } else if (
        !trimmed.includes('=') &&
        Object.keys(sections[currentSection]).length > 0
      ) {
        // Continuation line (indented value)
        const lastKey = Object.keys(sections[currentSection]).pop()
        if (lastKey) {
          sections[currentSection][lastKey] += '\n' + trimmed
        }
      }
    }
  }

  return sections
}
