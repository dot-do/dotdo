/**
 * Python Safety Pattern Detection Tests (RED Phase)
 *
 * Tests for detecting dangerous patterns in Python code.
 * This enables multi-language safety analysis in bashx.
 *
 * Detection categories:
 * 1. eval/exec - Arbitrary code execution (critical impact)
 * 2. os.system/subprocess - System command execution (high impact)
 * 3. pickle/import injection - Deserialization & dynamic imports (high impact)
 * 4. File operations - Write/read operations (medium/low impact)
 *
 * These tests are expected to FAIL initially (RED phase).
 * The analyzePythonSafety implementation will be done in the GREEN phase.
 *
 * Total: 15 tests
 * - eval/exec: 4 tests
 * - system exec: 5 tests
 * - pickle/imports: 4 tests
 * - file ops: 2 tests
 */

import { describe, it, expect } from 'vitest'

import {
  analyzePythonSafety,
  type PythonSafetyAnalysis,
  type DetectedPattern,
} from './python.js'

describe('analyzePythonSafety', () => {
  // ==========================================================================
  // eval/exec Detection (4 tests)
  // Critical impact - arbitrary code execution vulnerability
  // ==========================================================================
  describe('eval/exec detection', () => {
    it('detects eval() as critical impact', () => {
      const result = analyzePythonSafety('result = eval(user_input)')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.reversible).toBe(false)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'eval',
          impact: 'critical',
        })
      )
    })

    it('detects exec() as critical impact', () => {
      const result = analyzePythonSafety('exec(code_string)')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.reversible).toBe(false)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'exec',
          impact: 'critical',
        })
      )
    })

    it('detects compile() as high impact', () => {
      const result = analyzePythonSafety('code = compile(source, "<string>", "exec")')

      expect(result.classification.impact).toBe('high')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'compile',
          impact: 'high',
        })
      )
    })

    it('allows safe print statements (low impact)', () => {
      const result = analyzePythonSafety('print("Hello, World!")')

      expect(result.classification.impact).toBe('low')
      expect(result.classification.type).toBe('read')
      expect(result.patterns).toHaveLength(0)
    })
  })

  // ==========================================================================
  // os.system/subprocess Detection (5 tests)
  // High impact - system command execution
  // ==========================================================================
  describe('system exec detection', () => {
    it('detects os.system() as high impact with type=system', () => {
      const result = analyzePythonSafety('import os\nos.system("rm -rf /")')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'system',
          impact: 'high',
        })
      )
    })

    it('detects subprocess.run() as high impact', () => {
      const result = analyzePythonSafety('import subprocess\nsubprocess.run(["ls", "-la"])')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'subprocess',
          impact: 'high',
        })
      )
    })

    it('detects subprocess.Popen() as high impact', () => {
      const result = analyzePythonSafety('subprocess.Popen(cmd, shell=True)')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'subprocess',
          impact: 'high',
        })
      )
    })

    it('detects os.popen() as high impact', () => {
      const result = analyzePythonSafety('output = os.popen("whoami").read()')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'popen',
          impact: 'high',
        })
      )
    })

    it('tracks subprocess in imports', () => {
      const result = analyzePythonSafety('import subprocess\nsubprocess.call(["echo", "hi"])')

      expect(result.imports).toContain('subprocess')
    })
  })

  // ==========================================================================
  // pickle/import injection Detection (4 tests)
  // High impact - deserialization attacks and dynamic imports
  // ==========================================================================
  describe('pickle/imports detection', () => {
    it('detects pickle.loads() as high impact', () => {
      const result = analyzePythonSafety('import pickle\nobj = pickle.loads(data)')

      expect(result.classification.impact).toBe('high')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'pickle',
          impact: 'high',
        })
      )
    })

    it('detects pickle.load() as high impact', () => {
      const result = analyzePythonSafety('with open("data.pkl", "rb") as f:\n  obj = pickle.load(f)')

      expect(result.classification.impact).toBe('high')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'pickle',
          impact: 'high',
        })
      )
    })

    it('detects __import__() as high impact', () => {
      const result = analyzePythonSafety('module = __import__(module_name)')

      expect(result.classification.impact).toBe('high')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'import_injection',
          impact: 'high',
        })
      )
    })

    it('allows safe json.loads() (low impact)', () => {
      const result = analyzePythonSafety('import json\ndata = json.loads(text)')

      expect(result.classification.impact).toBe('low')
      expect(result.classification.type).toBe('read')
      expect(result.imports).toContain('json')
      // Should not contain any high-impact patterns
      const highImpactPatterns = result.patterns.filter(p => p.impact === 'high' || p.impact === 'critical')
      expect(highImpactPatterns).toHaveLength(0)
    })
  })

  // ==========================================================================
  // File Operations Detection (2 tests)
  // Medium/low impact - file read/write operations
  // ==========================================================================
  describe('file operations detection', () => {
    it('detects open() with write mode as medium impact', () => {
      const result = analyzePythonSafety('with open("output.txt", "w") as f:\n  f.write("data")')

      expect(result.classification.impact).toBe('medium')
      expect(result.classification.type).toBe('write')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'file_write',
          impact: 'medium',
        })
      )
    })

    it('allows open() with read mode (low impact)', () => {
      const result = analyzePythonSafety('with open("input.txt", "r") as f:\n  data = f.read()')

      expect(result.classification.impact).toBe('low')
      expect(result.classification.type).toBe('read')
      // Should have file_read pattern or no dangerous patterns
      const dangerousPatterns = result.patterns.filter(
        p => p.impact === 'high' || p.impact === 'critical' || p.impact === 'medium'
      )
      expect(dangerousPatterns).toHaveLength(0)
    })
  })
})
