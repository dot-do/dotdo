/**
 * pyproject.toml Parser (PEP 517/518/621)
 */

import * as TOML from '@iarna/toml'
import type { PyprojectToml, ProjectSection, BuildSystemSection } from './types'

/**
 * Parse a pyproject.toml file content
 */
export function parsePyprojectToml(content: string): PyprojectToml {
  const parsed = TOML.parse(content) as Record<string, unknown>

  const result: PyprojectToml = {}

  // Parse [project] section (PEP 621)
  if (parsed.project && typeof parsed.project === 'object') {
    result.project = parseProjectSection(parsed.project as Record<string, unknown>)
  }

  // Parse [build-system] section (PEP 517/518)
  if (parsed['build-system'] && typeof parsed['build-system'] === 'object') {
    result.buildSystem = parseBuildSystemSection(parsed['build-system'] as Record<string, unknown>)
  }

  // Parse [tool.*] sections
  if (parsed.tool && typeof parsed.tool === 'object') {
    result.tool = parsed.tool as Record<string, unknown>
  }

  return result
}

/**
 * Parse the [project] section
 */
function parseProjectSection(data: Record<string, unknown>): ProjectSection {
  const project: ProjectSection = {}

  // Basic fields
  if (typeof data.name === 'string') {
    project.name = data.name
  }
  if (typeof data.version === 'string') {
    project.version = data.version
  }
  if (typeof data.description === 'string') {
    project.description = data.description
  }
  if (data.readme !== undefined) {
    if (typeof data.readme === 'string') {
      project.readme = data.readme
    } else if (typeof data.readme === 'object' && data.readme !== null) {
      const readmeObj = data.readme as Record<string, unknown>
      project.readme = {
        file: typeof readmeObj.file === 'string' ? readmeObj.file : undefined,
        text: typeof readmeObj.text === 'string' ? readmeObj.text : undefined,
        contentType: typeof readmeObj['content-type'] === 'string' ? readmeObj['content-type'] : undefined,
      }
    }
  }
  if (data.license && typeof data.license === 'object') {
    const licenseData = data.license as Record<string, unknown>
    project.license = {
      text: typeof licenseData.text === 'string' ? licenseData.text : undefined,
      file: typeof licenseData.file === 'string' ? licenseData.file : undefined,
    }
  }

  // Authors and maintainers
  if (Array.isArray(data.authors)) {
    project.authors = data.authors.map(parsePersonInfo)
  }
  if (Array.isArray(data.maintainers)) {
    project.maintainers = data.maintainers.map(parsePersonInfo)
  }

  // Keywords and classifiers
  if (Array.isArray(data.keywords)) {
    project.keywords = data.keywords.filter((k): k is string => typeof k === 'string')
  }
  if (Array.isArray(data.classifiers)) {
    project.classifiers = data.classifiers.filter((c): c is string => typeof c === 'string')
  }

  // URLs
  if (data.urls && typeof data.urls === 'object') {
    project.urls = data.urls as Record<string, string>
  }

  // Scripts
  if (data.scripts && typeof data.scripts === 'object') {
    project.scripts = data.scripts as Record<string, string>
  }
  if (data['gui-scripts'] && typeof data['gui-scripts'] === 'object') {
    project.guiScripts = data['gui-scripts'] as Record<string, string>
  }

  // Entry points
  if (data['entry-points'] && typeof data['entry-points'] === 'object') {
    project.entryPoints = data['entry-points'] as Record<string, Record<string, string>>
  }

  // Dependencies
  if (Array.isArray(data.dependencies)) {
    project.dependencies = data.dependencies.filter((d): d is string => typeof d === 'string')
  }

  // Optional dependencies
  if (data['optional-dependencies'] && typeof data['optional-dependencies'] === 'object') {
    project.optionalDependencies = {}
    const optDeps = data['optional-dependencies'] as Record<string, unknown>
    for (const [key, value] of Object.entries(optDeps)) {
      if (Array.isArray(value)) {
        project.optionalDependencies[key] = value.filter((d): d is string => typeof d === 'string')
      }
    }
  }

  // Python version requirement
  if (typeof data['requires-python'] === 'string') {
    project.requiresPython = data['requires-python']
  }

  // Dynamic fields
  if (Array.isArray(data.dynamic)) {
    project.dynamic = data.dynamic.filter((d): d is string => typeof d === 'string')
  }

  return project
}

/**
 * Parse a person info object (author/maintainer)
 */
function parsePersonInfo(data: unknown): { name?: string; email?: string } {
  if (!data || typeof data !== 'object') {
    return {}
  }
  const obj = data as Record<string, unknown>
  return {
    name: typeof obj.name === 'string' ? obj.name : undefined,
    email: typeof obj.email === 'string' ? obj.email : undefined,
  }
}

/**
 * Parse the [build-system] section
 */
function parseBuildSystemSection(data: Record<string, unknown>): BuildSystemSection {
  const buildSystem: BuildSystemSection = {}

  if (Array.isArray(data.requires)) {
    buildSystem.requires = data.requires.filter((r): r is string => typeof r === 'string')
  }
  if (typeof data['build-backend'] === 'string') {
    buildSystem.buildBackend = data['build-backend']
  }
  if (Array.isArray(data['backend-path'])) {
    buildSystem.backendPath = data['backend-path'].filter((p): p is string => typeof p === 'string')
  }

  return buildSystem
}
