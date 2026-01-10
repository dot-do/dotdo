import { execSync } from 'child_process'
import { describe, it, expect } from 'vitest'

describe('Security Audit', () => {
  it('should have no high or critical vulnerabilities', () => {
    // Run pnpm audit and parse results
    let auditResult: { metadata: { vulnerabilities: { high: number; critical: number } } }

    try {
      const result = execSync('pnpm audit --json 2>/dev/null', {
        encoding: 'utf-8',
        cwd: process.cwd()
      })
      auditResult = JSON.parse(result)
    } catch (error: any) {
      // pnpm audit exits with non-zero when vulnerabilities found
      if (error.stdout) {
        auditResult = JSON.parse(error.stdout)
      } else {
        throw error
      }
    }

    expect(auditResult.metadata.vulnerabilities.high).toBe(0)
    expect(auditResult.metadata.vulnerabilities.critical).toBe(0)
  })
})
