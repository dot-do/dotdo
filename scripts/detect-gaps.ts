#!/usr/bin/env npx tsx
/**
 * API Gap Detection Pipeline
 *
 * Compares our compat SDK exports against official SDK signatures to identify
 * missing methods, types, and implementation gaps.
 *
 * Usage:
 *   npx tsx scripts/detect-gaps.ts              # Run for all integrations
 *   npx tsx scripts/detect-gaps.ts stripe       # Run for specific integration
 *   npx tsx scripts/detect-gaps.ts --summary    # Only output summary
 *
 * Output:
 *   - docs/_gaps/{integration}.json  - Per-integration gap report
 *   - docs/_gaps/summary.md          - Full markdown report
 */

import * as ts from 'typescript'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { officialSDKs, type OfficialSDK, type OfficialExport, type Severity } from './fixtures/official-sdks'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const gapsDir = join(rootDir, 'docs', '_gaps')

// =============================================================================
// Types
// =============================================================================

export type GapType = 'missing-method' | 'missing-type' | 'missing-class' | 'missing-function' | 'missing-constant' | 'signature-mismatch'

export interface Gap {
  name: string
  type: GapType
  severity: Severity
  description?: string
  /** Parent path for nested exports (e.g., "Stripe" for "Stripe.webhooks") */
  parent?: string
}

export interface IntegrationReport {
  integration: string
  package: string
  compatPath: string
  docsUrl: string
  timestamp: string
  totalExpected: number
  totalFound: number
  coverage: number // percentage
  gaps: Gap[]
  // Breakdown by severity
  p0Gaps: number
  p1Gaps: number
  p2Gaps: number
  // Breakdown by type
  missingMethods: number
  missingTypes: number
  missingClasses: number
}

// =============================================================================
// TypeScript Export Extraction
// =============================================================================

interface ExtractedExport {
  name: string
  kind: 'class' | 'function' | 'type' | 'interface' | 'const' | 'variable' | 'enum' | 'namespace'
  isTypeOnly: boolean
  members?: string[] // For classes/interfaces
}

function extractExportsFromFile(filePath: string): ExtractedExport[] {
  if (!existsSync(filePath)) {
    console.warn(`  Warning: File not found: ${filePath}`)
    return []
  }

  const sourceText = readFileSync(filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )

  const exports: ExtractedExport[] = []
  const seenNames = new Set<string>()

  function visit(node: ts.Node) {
    // Handle export declarations: export { A, B } from './module'
    if (ts.isExportDeclaration(node)) {
      const exportClause = node.exportClause
      if (exportClause && ts.isNamedExports(exportClause)) {
        for (const element of exportClause.elements) {
          const name = element.name.text
          if (seenNames.has(name)) continue
          seenNames.add(name)

          const isTypeOnly = node.isTypeOnly || element.isTypeOnly
          exports.push({
            name,
            kind: isTypeOnly ? 'type' : 'variable',
            isTypeOnly,
          })
        }
      }
    }

    // Handle export type { A, B }
    if (ts.isExportDeclaration(node) && node.isTypeOnly) {
      const exportClause = node.exportClause
      if (exportClause && ts.isNamedExports(exportClause)) {
        for (const element of exportClause.elements) {
          const name = element.name.text
          if (seenNames.has(name)) continue
          seenNames.add(name)

          exports.push({
            name,
            kind: 'type',
            isTypeOnly: true,
          })
        }
      }
    }

    // Handle direct exports: export class Foo {}
    if (ts.isClassDeclaration(node) && node.name && hasExportModifier(node)) {
      const name = node.name.text
      if (!seenNames.has(name)) {
        seenNames.add(name)
        exports.push({
          name,
          kind: 'class',
          isTypeOnly: false,
          members: extractClassMembers(node),
        })
      }
    }

    // Handle export function
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
      const name = node.name.text
      if (!seenNames.has(name)) {
        seenNames.add(name)
        exports.push({
          name,
          kind: 'function',
          isTypeOnly: false,
        })
      }
    }

    // Handle export interface
    if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) {
      const name = node.name.text
      if (!seenNames.has(name)) {
        seenNames.add(name)
        exports.push({
          name,
          kind: 'interface',
          isTypeOnly: true,
        })
      }
    }

    // Handle export type
    if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) {
      const name = node.name.text
      if (!seenNames.has(name)) {
        seenNames.add(name)
        exports.push({
          name,
          kind: 'type',
          isTypeOnly: true,
        })
      }
    }

    // Handle export const/let/var
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text
          if (!seenNames.has(name)) {
            seenNames.add(name)
            exports.push({
              name,
              kind: 'const',
              isTypeOnly: false,
            })
          }
        }
      }
    }

    // Handle export enum
    if (ts.isEnumDeclaration(node) && hasExportModifier(node)) {
      const name = node.name.text
      if (!seenNames.has(name)) {
        seenNames.add(name)
        exports.push({
          name,
          kind: 'enum',
          isTypeOnly: false,
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return exports
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function extractClassMembers(node: ts.ClassDeclaration): string[] {
  const members: string[] = []
  for (const member of node.members) {
    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      members.push(member.name.text)
    }
    if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      members.push(member.name.text)
    }
  }
  return members
}

// =============================================================================
// Gap Detection
// =============================================================================

function detectGaps(sdk: OfficialSDK, ourExports: ExtractedExport[], compatPath: string): Gap[] {
  const gaps: Gap[] = []
  const exportNames = new Set(ourExports.map(e => e.name))
  const exportNamesLower = new Set(ourExports.map(e => e.name.toLowerCase()))

  // Try to load additional exports from implementation files
  const additionalExports = extractExportsFromImplementation(compatPath)
  for (const exp of additionalExports) {
    exportNames.add(exp)
    exportNamesLower.add(exp.toLowerCase())
  }

  for (const expected of sdk.exports) {
    const found = ourExports.find(e => e.name === expected.name)

    if (!found) {
      // Completely missing export
      const gapType = mapExportTypeToGapType(expected.type)
      gaps.push({
        name: expected.name,
        type: gapType,
        severity: expected.severity,
        description: expected.description,
      })
    } else if (expected.methods && expected.methods.length > 0) {
      // Check for missing methods on classes/namespaces
      const foundMembers = found.members || []
      const memberSet = new Set(foundMembers)

      for (const method of expected.methods) {
        // Check various naming patterns for the method
        const methodName = method.name
        const resourceName = `${capitalizeFirst(methodName)}Resource`
        const sessionsResource = `${capitalizeFirst(methodName)}SessionsResource`

        // Check if method exists as:
        // 1. Direct member of the class
        // 2. Exported as *Resource (e.g., CustomersResource)
        // 3. Exported as *SessionsResource (e.g., CheckoutSessionsResource)
        // 4. Exported as * (e.g., Webhooks)
        // 5. Case-insensitive match in any export
        const methodExists =
          memberSet.has(methodName) ||
          exportNames.has(resourceName) ||
          exportNames.has(sessionsResource) ||
          exportNames.has(capitalizeFirst(methodName)) ||
          exportNamesLower.has(methodName.toLowerCase())

        if (!methodExists) {
          gaps.push({
            name: methodName,
            type: 'missing-method',
            severity: method.severity,
            description: method.description,
            parent: expected.name,
          })
        }
      }
    }
  }

  return gaps
}

/**
 * Extract additional exports from implementation files
 * This helps catch classes/functions that are implemented but the detection
 * doesn't catch from just the index.ts re-exports
 */
function extractExportsFromImplementation(compatPath: string): string[] {
  const exports: string[] = []
  const baseDir = join(rootDir, compatPath)

  // Look for common implementation patterns
  const filesToCheck = [
    join(baseDir, 'stripe.ts'),
    join(baseDir, 'client.ts'),
    join(baseDir, 'pusher.ts'),
    join(baseDir, 'postgres.ts'),
  ]

  for (const filePath of filesToCheck) {
    if (!existsSync(filePath)) continue

    const sourceText = readFileSync(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )

    // Extract class names and their public members
    function visit(node: ts.Node) {
      if (ts.isClassDeclaration(node) && node.name) {
        exports.push(node.name.text)

        // Also add public members/getters as potential "resources"
        for (const member of node.members) {
          if (ts.isGetAccessor(member) && member.name && ts.isIdentifier(member.name)) {
            exports.push(member.name.text)
          }
          if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            exports.push(member.name.text)
          }
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return exports
}

function mapExportTypeToGapType(exportType: string): GapType {
  switch (exportType) {
    case 'class':
      return 'missing-class'
    case 'function':
      return 'missing-function'
    case 'type':
      return 'missing-type'
    case 'constant':
      return 'missing-constant'
    case 'namespace':
      return 'missing-method' // Namespaces are checked via methods
    default:
      return 'missing-type'
  }
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// =============================================================================
// Report Generation
// =============================================================================

function analyzeIntegration(name: string): IntegrationReport | null {
  const sdk = officialSDKs[name]
  if (!sdk) {
    console.warn(`  Warning: No official SDK definition for "${name}"`)
    return null
  }

  const compatIndexPath = join(rootDir, sdk.compatPath, 'index.ts')
  console.log(`  Analyzing ${name} (${compatIndexPath})`)

  const ourExports = extractExportsFromFile(compatIndexPath)
  const gaps = detectGaps(sdk, ourExports, sdk.compatPath)

  // Count expected exports (including nested methods)
  let totalExpected = 0
  for (const exp of sdk.exports) {
    totalExpected++
    if (exp.methods) {
      totalExpected += exp.methods.length
    }
  }

  const totalFound = totalExpected - gaps.length
  const coverage = totalExpected > 0 ? Math.round((totalFound / totalExpected) * 100) : 0

  const report: IntegrationReport = {
    integration: name,
    package: sdk.package,
    compatPath: sdk.compatPath,
    docsUrl: sdk.docsUrl,
    timestamp: new Date().toISOString(),
    totalExpected,
    totalFound,
    coverage,
    gaps,
    p0Gaps: gaps.filter(g => g.severity === 'P0').length,
    p1Gaps: gaps.filter(g => g.severity === 'P1').length,
    p2Gaps: gaps.filter(g => g.severity === 'P2').length,
    missingMethods: gaps.filter(g => g.type === 'missing-method').length,
    missingTypes: gaps.filter(g => g.type === 'missing-type').length,
    missingClasses: gaps.filter(g => g.type === 'missing-class' || g.type === 'missing-function').length,
  }

  return report
}

function generateSummaryMarkdown(reports: IntegrationReport[]): string {
  const timestamp = new Date().toISOString()

  // Sort by coverage (lowest first)
  const sorted = [...reports].sort((a, b) => a.coverage - b.coverage)

  // Calculate totals
  const totalP0 = reports.reduce((sum, r) => sum + r.p0Gaps, 0)
  const totalP1 = reports.reduce((sum, r) => sum + r.p1Gaps, 0)
  const totalP2 = reports.reduce((sum, r) => sum + r.p2Gaps, 0)
  const totalGaps = totalP0 + totalP1 + totalP2

  let md = `# API Gap Detection Report

Generated: ${timestamp}

## Summary

| Metric | Count |
|--------|-------|
| Integrations Analyzed | ${reports.length} |
| Total Gaps | ${totalGaps} |
| P0 (Critical) | ${totalP0} |
| P1 (Important) | ${totalP1} |
| P2 (Nice-to-have) | ${totalP2} |

## Coverage by Integration

| Integration | Coverage | P0 | P1 | P2 | Total Gaps |
|-------------|----------|-----|-----|-----|------------|
`

  for (const report of sorted) {
    const coverageEmoji = report.coverage >= 90 ? '++' : report.coverage >= 70 ? '+' : report.coverage >= 50 ? '~' : '--'
    md += `| [${report.integration}](#${report.integration}) | ${coverageEmoji} ${report.coverage}% | ${report.p0Gaps} | ${report.p1Gaps} | ${report.p2Gaps} | ${report.gaps.length} |\n`
  }

  md += `\n## Detailed Gap Reports\n`

  for (const report of sorted) {
    md += `\n### ${report.integration}\n\n`
    md += `**Package:** \`${report.package}\`  \n`
    md += `**Compat Path:** \`${report.compatPath}\`  \n`
    md += `**Coverage:** ${report.coverage}% (${report.totalFound}/${report.totalExpected})  \n`
    md += `**Docs:** [${report.docsUrl}](${report.docsUrl})\n\n`

    if (report.gaps.length === 0) {
      md += `No gaps detected.\n`
    } else {
      // Group by severity
      const p0Gaps = report.gaps.filter(g => g.severity === 'P0')
      const p1Gaps = report.gaps.filter(g => g.severity === 'P1')
      const p2Gaps = report.gaps.filter(g => g.severity === 'P2')

      if (p0Gaps.length > 0) {
        md += `#### P0 (Critical)\n\n`
        md += `| Name | Type | Description |\n`
        md += `|------|------|-------------|\n`
        for (const gap of p0Gaps) {
          const fullName = gap.parent ? `${gap.parent}.${gap.name}` : gap.name
          md += `| \`${fullName}\` | ${gap.type} | ${gap.description || '-'} |\n`
        }
        md += `\n`
      }

      if (p1Gaps.length > 0) {
        md += `#### P1 (Important)\n\n`
        md += `| Name | Type | Description |\n`
        md += `|------|------|-------------|\n`
        for (const gap of p1Gaps) {
          const fullName = gap.parent ? `${gap.parent}.${gap.name}` : gap.name
          md += `| \`${fullName}\` | ${gap.type} | ${gap.description || '-'} |\n`
        }
        md += `\n`
      }

      if (p2Gaps.length > 0) {
        md += `<details>\n<summary>P2 (Nice-to-have) - ${p2Gaps.length} gaps</summary>\n\n`
        md += `| Name | Type | Description |\n`
        md += `|------|------|-------------|\n`
        for (const gap of p2Gaps) {
          const fullName = gap.parent ? `${gap.parent}.${gap.name}` : gap.name
          md += `| \`${fullName}\` | ${gap.type} | ${gap.description || '-'} |\n`
        }
        md += `\n</details>\n\n`
      }
    }
  }

  md += `---\n\n*Generated by \`scripts/detect-gaps.ts\`*\n`

  return md
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2)
  const summaryOnly = args.includes('--summary')
  const specificIntegration = args.find(a => !a.startsWith('--'))

  console.log('API Gap Detection Pipeline')
  console.log('==========================\n')

  // Get list of integrations to analyze
  let integrations: string[]

  if (specificIntegration) {
    if (!officialSDKs[specificIntegration]) {
      console.error(`Error: Unknown integration "${specificIntegration}"`)
      console.error(`Available integrations: ${Object.keys(officialSDKs).join(', ')}`)
      process.exit(1)
    }
    integrations = [specificIntegration]
  } else {
    // Analyze all integrations with official SDK definitions
    integrations = Object.keys(officialSDKs)
  }

  console.log(`Analyzing ${integrations.length} integration(s)...\n`)

  const reports: IntegrationReport[] = []

  for (const name of integrations) {
    const report = analyzeIntegration(name)
    if (report) {
      reports.push(report)

      // Write individual JSON report
      if (!summaryOnly) {
        const jsonPath = join(gapsDir, `${name}.json`)
        writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n')
        console.log(`    Wrote ${jsonPath}`)
      }
    }
  }

  // Write summary markdown
  const summaryPath = join(gapsDir, 'summary.md')
  const summaryContent = generateSummaryMarkdown(reports)
  writeFileSync(summaryPath, summaryContent)
  console.log(`\nWrote summary to ${summaryPath}`)

  // Print quick summary to console
  console.log('\n' + '='.repeat(60))
  console.log('Quick Summary')
  console.log('='.repeat(60))

  const totalP0 = reports.reduce((sum, r) => sum + r.p0Gaps, 0)
  const totalP1 = reports.reduce((sum, r) => sum + r.p1Gaps, 0)
  const totalP2 = reports.reduce((sum, r) => sum + r.p2Gaps, 0)

  console.log(`\nIntegrations: ${reports.length}`)
  console.log(`Total gaps: ${totalP0 + totalP1 + totalP2}`)
  console.log(`  P0 (Critical):    ${totalP0}`)
  console.log(`  P1 (Important):   ${totalP1}`)
  console.log(`  P2 (Nice-to-have): ${totalP2}`)

  console.log('\nCoverage by integration:')
  for (const report of reports.sort((a, b) => a.coverage - b.coverage)) {
    const bar = '='.repeat(Math.floor(report.coverage / 5)) + '-'.repeat(20 - Math.floor(report.coverage / 5))
    const status = report.p0Gaps > 0 ? '[!]' : report.coverage >= 90 ? '[+]' : '[ ]'
    console.log(`  ${status} ${report.integration.padEnd(12)} [${bar}] ${report.coverage}%`)
  }

  if (totalP0 > 0) {
    console.log(`\nWarning: ${totalP0} P0 (critical) gaps found!`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
