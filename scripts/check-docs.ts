#!/usr/bin/env npx tsx
/**
 * Documentation Completeness Checker (TDD RED/GREEN Validation)
 *
 * Validates that documentation follows TDD principles with clear status indicators.
 *
 * Usage:
 *   npx tsx scripts/check-docs.ts                    # Check all docs
 *   npx tsx scripts/check-docs.ts --root=compat      # Check docs/compat/**
 *   npx tsx scripts/check-docs.ts --root=integrations # Check docs/integrations/**
 *   npx tsx scripts/check-docs.ts --file=docs/compat/index.mdx  # Single file
 *   npx tsx scripts/check-docs.ts --json             # JSON output
 *   npx tsx scripts/check-docs.ts --ci               # Exit code 1 if any RED
 *
 * Status meanings:
 *   RED      - Missing or fails checks (needs work)
 *   GREEN    - Passes all checks
 *   REFACTOR - Has been marked as reviewed (via frontmatter flag)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs'
import { resolve, dirname, relative, join, basename, extname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')
const DOCS_DIR = resolve(ROOT_DIR, 'docs')

// Internal directories that are not public-facing documentation
const INTERNAL_DIRS = ['plans', 'research', 'design', 'spikes']

// ANSI color codes
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
}

type DocStatus = 'RED' | 'GREEN' | 'REFACTOR'

interface CheckResult {
  passed: boolean
  message: string
}

interface DocCheck {
  exists: CheckResult
  frontmatter: CheckResult
  sections: CheckResult
  codeExamples: CheckResult
  links: CheckResult
}

interface DocResult {
  path: string
  relativePath: string
  status: DocStatus
  checks: DocCheck
  isIntegration: boolean
}

interface Summary {
  total: number
  red: number
  green: number
  refactor: number
  results: DocResult[]
  timestamp: string
}

// Required sections for different doc types
// Integration docs should have: Overview/Problem section, Install/Setup, Quick Start/Usage, API/Reference
const INTEGRATION_SECTION_PATTERNS = {
  overview: ['overview', 'problem', 'why', 'introduction', 'intro', 'what is', 'about'],
  install: ['install', 'setup', 'getting started', 'configuration', 'configure'],
  quickstart: ['quick start', 'quickstart', 'quick', 'start', 'usage', 'example', 'how to', 'available'],
  api: ['api', 'reference', 'methods', 'functions', 'sdk', 'available', 'full list'],
}
const GENERAL_SECTIONS = ['description', 'title']

/**
 * Parse YAML frontmatter from MDX/MD content
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) return {}

  const yaml = frontmatterMatch[1]
  const result: Record<string, unknown> = {}

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    let value: string | boolean = line.slice(colonIdx + 1).trim()

    // Handle quoted strings
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    // Handle booleans
    if (value === 'true') value = true as unknown as string
    if (value === 'false') value = false as unknown as string

    result[key] = value
  }

  return result
}

/**
 * Extract heading text from markdown (handles MDX components)
 */
function extractHeadings(content: string): string[] {
  const headings: string[] = []

  // Match markdown headings
  const headingRegex = /^#{1,6}\s+(.+)$/gm
  let match
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push(match[1].toLowerCase().trim())
  }

  return headings
}

/**
 * Check if content has code blocks
 */
function hasCodeBlocks(content: string): boolean {
  // Match fenced code blocks
  const codeBlockRegex = /```[\s\S]*?```/g
  return codeBlockRegex.test(content)
}

/**
 * Find potentially broken internal links
 */
function findBrokenLinks(content: string, docPath: string): string[] {
  const brokenLinks: string[] = []
  const docDir = dirname(docPath)

  // Match markdown links
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g
  let match

  while ((match = linkRegex.exec(content)) !== null) {
    const href = match[2]

    // Skip external links, anchors, and mailto
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#') || href.startsWith('mailto:')) {
      continue
    }

    // Check internal links starting with / or ./
    if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
      let targetPath: string

      if (href.startsWith('/')) {
        // Absolute path from docs root - map /docs/* to DOCS_DIR
        const cleanHref = href.replace(/^\/docs/, '').replace(/#.*$/, '')
        targetPath = resolve(DOCS_DIR, cleanHref.slice(1))
      } else {
        // Relative path
        targetPath = resolve(docDir, href.replace(/#.*$/, ''))
      }

      // Check if file exists (with common extensions)
      const extensions = ['', '.mdx', '.md', '/index.mdx', '/index.md']
      const fileExists = extensions.some((ext) => existsSync(targetPath + ext))

      if (!fileExists) {
        brokenLinks.push(href)
      }
    }
  }

  return brokenLinks
}

/**
 * Check a single document
 */
function checkDocument(filePath: string): DocResult {
  const relativePath = relative(ROOT_DIR, filePath)
  const isIntegration = relativePath.includes('/compat/') || relativePath.includes('/integrations/')

  // Initialize checks
  const checks: DocCheck = {
    exists: { passed: false, message: '' },
    frontmatter: { passed: false, message: '' },
    sections: { passed: false, message: '' },
    codeExamples: { passed: false, message: '' },
    links: { passed: false, message: '' },
  }

  // Check: exists
  if (!existsSync(filePath)) {
    checks.exists = { passed: false, message: 'File does not exist' }
    return {
      path: filePath,
      relativePath,
      status: 'RED',
      checks,
      isIntegration,
    }
  }
  checks.exists = { passed: true, message: 'File exists' }

  // Read content
  const content = readFileSync(filePath, 'utf-8')

  // Check: frontmatter
  const frontmatter = parseFrontmatter(content)
  const docDir = dirname(filePath)
  const metaJsonPath = resolve(docDir, 'meta.json')
  const hasMetaJson = existsSync(metaJsonPath)

  if (frontmatter.title || frontmatter.description || hasMetaJson) {
    checks.frontmatter = { passed: true, message: 'Has valid frontmatter or meta.json' }
  } else {
    checks.frontmatter = { passed: false, message: 'Missing frontmatter (title/description) and no meta.json in directory' }
  }

  // Check: sections
  const headings = extractHeadings(content)
  const normalizedHeadings = headings.map((h) => h.toLowerCase())

  if (isIntegration) {
    // For integration docs, check for Overview, Install, QuickStart, API sections
    // Use flexible pattern matching
    const missingSections: string[] = []

    for (const [sectionName, patterns] of Object.entries(INTEGRATION_SECTION_PATTERNS)) {
      const found = normalizedHeadings.some((heading) => patterns.some((pattern) => heading.includes(pattern)))
      if (!found) {
        missingSections.push(sectionName)
      }
    }

    if (missingSections.length === 0) {
      checks.sections = { passed: true, message: 'Has all required sections (Overview, Install, QuickStart, API)' }
    } else if (missingSections.length <= 1) {
      // Allow one missing section if the doc has good content
      if (content.length > 3000 && headings.length >= 5) {
        checks.sections = { passed: true, message: `Good coverage (minor: missing ${missingSections.join(', ')})` }
      } else {
        checks.sections = { passed: false, message: `Missing sections: ${missingSections.join(', ')}` }
      }
    } else {
      checks.sections = { passed: false, message: `Missing sections: ${missingSections.join(', ')}` }
    }
  } else {
    // For general docs, just check that it has meaningful content
    if (headings.length > 0 || content.length > 500) {
      checks.sections = { passed: true, message: 'Has content structure' }
    } else {
      checks.sections = { passed: false, message: 'Needs more content structure (add headings)' }
    }
  }

  // Check: codeExamples
  if (hasCodeBlocks(content)) {
    checks.codeExamples = { passed: true, message: 'Has code examples' }
  } else {
    checks.codeExamples = { passed: false, message: 'No code examples found' }
  }

  // Check: links
  const brokenLinks = findBrokenLinks(content, filePath)
  if (brokenLinks.length === 0) {
    checks.links = { passed: true, message: 'No broken internal links' }
  } else {
    checks.links = { passed: false, message: `Broken links: ${brokenLinks.slice(0, 3).join(', ')}${brokenLinks.length > 3 ? ` (+${brokenLinks.length - 3} more)` : ''}` }
  }

  // Determine status
  let status: DocStatus

  // Check for REFACTOR flag in frontmatter
  if (frontmatter.reviewed === true || frontmatter.status === 'refactor' || frontmatter.tdd === 'refactor') {
    status = 'REFACTOR'
  } else {
    // All checks must pass for GREEN
    const allPassed = Object.values(checks).every((check) => check.passed)
    status = allPassed ? 'GREEN' : 'RED'
  }

  return {
    path: filePath,
    relativePath,
    status,
    checks,
    isIntegration,
  }
}

/**
 * Find all documentation files
 */
function findDocFiles(dir: string, pattern?: string, includeInternal = false): string[] {
  const files: string[] = []

  function walk(currentDir: string) {
    if (!existsSync(currentDir)) return

    const entries = readdirSync(currentDir)
    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.startsWith('.') || entry.startsWith('_')) continue

      // Skip internal directories unless explicitly included
      if (!includeInternal) {
        const relPath = relative(DOCS_DIR, join(currentDir, entry))
        const topDir = relPath.split('/')[0]
        if (INTERNAL_DIRS.includes(topDir)) continue
      }

      const fullPath = join(currentDir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase()
        if (ext === '.mdx' || ext === '.md') {
          files.push(fullPath)
        }
      }
    }
  }

  const searchDir = pattern ? join(dir, pattern) : dir
  walk(searchDir)

  return files.sort()
}

/**
 * Generate summary markdown
 */
function generateSummaryMarkdown(summary: Summary): string {
  const lines: string[] = [
    '# Documentation Status Summary',
    '',
    `Generated: ${summary.timestamp}`,
    '',
    '## Overview',
    '',
    '| Status | Count | Percentage |',
    '|--------|-------|------------|',
    `| RED | ${summary.red} | ${((summary.red / summary.total) * 100).toFixed(1)}% |`,
    `| GREEN | ${summary.green} | ${((summary.green / summary.total) * 100).toFixed(1)}% |`,
    `| REFACTOR | ${summary.refactor} | ${((summary.refactor / summary.total) * 100).toFixed(1)}% |`,
    `| **Total** | **${summary.total}** | **100%** |`,
    '',
  ]

  // Group by status
  const redDocs = summary.results.filter((r) => r.status === 'RED')
  const greenDocs = summary.results.filter((r) => r.status === 'GREEN')
  const refactorDocs = summary.results.filter((r) => r.status === 'REFACTOR')

  if (redDocs.length > 0) {
    lines.push('## RED (Needs Work)', '')
    lines.push('| File | Issues |')
    lines.push('|------|--------|')
    for (const doc of redDocs) {
      const issues = Object.entries(doc.checks)
        .filter(([, check]) => !check.passed)
        .map(([name]) => name)
        .join(', ')
      lines.push(`| \`${doc.relativePath}\` | ${issues} |`)
    }
    lines.push('')
  }

  if (greenDocs.length > 0) {
    lines.push('## GREEN (Complete)', '')
    for (const doc of greenDocs) {
      lines.push(`- \`${doc.relativePath}\``)
    }
    lines.push('')
  }

  if (refactorDocs.length > 0) {
    lines.push('## REFACTOR (Reviewed)', '')
    for (const doc of refactorDocs) {
      lines.push(`- \`${doc.relativePath}\``)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Print colored status
 */
function printStatus(status: DocStatus): string {
  switch (status) {
    case 'RED':
      return `${colors.red}${colors.bold}RED${colors.reset}`
    case 'GREEN':
      return `${colors.green}${colors.bold}GREEN${colors.reset}`
    case 'REFACTOR':
      return `${colors.yellow}${colors.bold}REFACTOR${colors.reset}`
  }
}

/**
 * Print check result
 */
function printCheck(name: string, check: CheckResult): void {
  const icon = check.passed ? `${colors.green}+${colors.reset}` : `${colors.red}x${colors.reset}`
  const message = check.passed ? `${colors.dim}${check.message}${colors.reset}` : `${colors.red}${check.message}${colors.reset}`
  console.log(`    ${icon} ${name}: ${message}`)
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  let rootFilter: string | undefined
  let fileFilter: string | undefined
  let jsonOutput = false
  let ciMode = false
  let verbose = false
  let includeInternal = false

  for (const arg of args) {
    if (arg.startsWith('--root=')) {
      rootFilter = arg.slice(7)
    } else if (arg.startsWith('--file=')) {
      fileFilter = arg.slice(7)
    } else if (arg === '--json') {
      jsonOutput = true
    } else if (arg === '--ci') {
      ciMode = true
    } else if (arg === '-v' || arg === '--verbose') {
      verbose = true
    } else if (arg === '--include-internal' || arg === '-i') {
      includeInternal = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Documentation Completeness Checker (TDD RED/GREEN Validation)

Usage:
  npx tsx scripts/check-docs.ts                    # Check all public docs
  npx tsx scripts/check-docs.ts --root=compat      # Check docs/compat/**
  npx tsx scripts/check-docs.ts --root=integrations # Check docs/integrations/**
  npx tsx scripts/check-docs.ts --file=docs/compat/index.mdx  # Single file
  npx tsx scripts/check-docs.ts --json             # JSON output
  npx tsx scripts/check-docs.ts --ci               # Exit code 1 if any RED
  npx tsx scripts/check-docs.ts -v                 # Verbose output
  npx tsx scripts/check-docs.ts -i                 # Include internal docs (plans, research, design, spikes)

Status meanings:
  RED      - Missing or fails checks (needs work)
  GREEN    - Passes all checks
  REFACTOR - Has been marked as reviewed (via frontmatter flag)

Checks performed:
  - exists: File exists
  - frontmatter: Has valid frontmatter or meta.json in directory
  - sections: Has required sections (integration docs: Overview, Install, QuickStart, API)
  - codeExamples: Has at least one code block
  - links: No obviously broken internal links (starts with / or ./)

Excluded by default (use -i to include):
  - docs/plans/     - Internal planning documents
  - docs/research/  - Research notes
  - docs/design/    - Design documents
  - docs/spikes/    - Proof of concept notes

To mark a doc as REFACTOR, add to frontmatter:
  reviewed: true
      `)
      process.exit(0)
    }
  }

  // Collect files to check
  let files: string[] = []

  if (fileFilter) {
    const filePath = resolve(ROOT_DIR, fileFilter)
    files = [filePath]
  } else if (rootFilter) {
    // When using --root, always include that specific directory (even if internal)
    files = findDocFiles(DOCS_DIR, rootFilter, true)
  } else {
    files = findDocFiles(DOCS_DIR, undefined, includeInternal)
  }

  if (files.length === 0) {
    console.error(`${colors.red}No documentation files found${colors.reset}`)
    process.exit(1)
  }

  // Check all files
  const results: DocResult[] = files.map(checkDocument)

  // Calculate summary
  const summary: Summary = {
    total: results.length,
    red: results.filter((r) => r.status === 'RED').length,
    green: results.filter((r) => r.status === 'GREEN').length,
    refactor: results.filter((r) => r.status === 'REFACTOR').length,
    results,
    timestamp: new Date().toISOString(),
  }

  // Output results
  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    // Console output
    console.log('')
    console.log(`${colors.bold}Documentation Completeness Check${colors.reset}`)
    console.log(`${colors.dim}${'='.repeat(50)}${colors.reset}`)
    console.log('')

    // Group by directory for cleaner output
    const byDir = new Map<string, DocResult[]>()
    for (const result of results) {
      const dir = dirname(result.relativePath)
      if (!byDir.has(dir)) byDir.set(dir, [])
      byDir.get(dir)!.push(result)
    }

    for (const [dir, dirResults] of byDir) {
      console.log(`${colors.cyan}${dir}/${colors.reset}`)

      for (const result of dirResults) {
        const fileName = basename(result.relativePath)
        console.log(`  ${printStatus(result.status)} ${fileName}`)

        // Show failed checks (or all checks in verbose mode)
        if (verbose || result.status === 'RED') {
          for (const [name, check] of Object.entries(result.checks)) {
            if (verbose || !check.passed) {
              printCheck(name, check)
            }
          }
        }
      }
      console.log('')
    }

    // Summary
    console.log(`${colors.dim}${'='.repeat(50)}${colors.reset}`)
    console.log('')
    console.log(`${colors.bold}Summary${colors.reset}`)
    console.log(`  Total: ${summary.total}`)
    console.log(`  ${colors.red}RED${colors.reset}: ${summary.red} (${((summary.red / summary.total) * 100).toFixed(1)}%)`)
    console.log(`  ${colors.green}GREEN${colors.reset}: ${summary.green} (${((summary.green / summary.total) * 100).toFixed(1)}%)`)
    console.log(`  ${colors.yellow}REFACTOR${colors.reset}: ${summary.refactor} (${((summary.refactor / summary.total) * 100).toFixed(1)}%)`)
    console.log('')
  }

  // Write summary file
  const statusDir = resolve(DOCS_DIR, '_status')
  if (!existsSync(statusDir)) {
    mkdirSync(statusDir, { recursive: true })
  }

  const summaryPath = resolve(statusDir, 'summary.md')
  const summaryMarkdown = generateSummaryMarkdown(summary)
  writeFileSync(summaryPath, summaryMarkdown)

  if (!jsonOutput) {
    console.log(`${colors.dim}Summary written to: ${relative(ROOT_DIR, summaryPath)}${colors.reset}`)
    console.log('')
  }

  // CI mode exit code
  if (ciMode && summary.red > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`)
  process.exit(1)
})
