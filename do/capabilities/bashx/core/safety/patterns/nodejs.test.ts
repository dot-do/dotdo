/**
 * Node.js Safety Pattern Detection Tests (RED Phase)
 *
 * Tests for detecting dangerous patterns in Node.js code.
 * This enables multi-language safety analysis in bashx.
 *
 * Detection categories:
 * 1. eval/Function - Arbitrary code execution (critical impact)
 * 2. vm module - Sandboxed code execution (high impact)
 * 3. Prototype pollution - __proto__/setPrototypeOf attacks (critical impact)
 * 4. child_process - System command execution (high impact)
 * 5. Dynamic require - Module injection (high impact)
 * 6. Safe code - Allowed patterns (low impact)
 *
 * These tests are expected to FAIL initially (RED phase).
 * The analyzeNodeSafety implementation will be done in the GREEN phase.
 *
 * Total: 14 tests
 * - eval/Function: 3 tests
 * - vm module: 1 test
 * - prototype pollution: 3 tests
 * - child_process: 3 tests
 * - dynamic require: 2 tests
 * - safe code: 2 tests
 */

import { describe, it, expect } from 'vitest'

import {
  analyzeNodeSafety,
  type NodeSafetyAnalysis,
  type DetectedPattern,
} from './nodejs.js'

describe('analyzeNodeSafety', () => {
  // ==========================================================================
  // eval/Function Detection (3 tests)
  // Critical impact - arbitrary code execution vulnerability
  // ==========================================================================
  describe('eval/Function detection', () => {
    it('detects eval() as critical impact', () => {
      const result = analyzeNodeSafety('const result = eval(userInput)')

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

    it('detects new Function() as critical impact', () => {
      const result = analyzeNodeSafety('const fn = new Function("return " + code)')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('execute')
      expect(result.classification.reversible).toBe(false)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'function_constructor',
          impact: 'critical',
        })
      )
    })

    it('detects Function() without new as critical impact', () => {
      const result = analyzeNodeSafety('const fn = Function("a", "b", "return a + b")')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('execute')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'function_constructor',
          impact: 'critical',
        })
      )
    })
  })

  // ==========================================================================
  // vm Module Detection (1 test)
  // High impact - sandboxed code execution can still be dangerous
  // ==========================================================================
  describe('vm module detection', () => {
    it('detects vm.runInContext() as high impact', () => {
      const result = analyzeNodeSafety(`
        const vm = require('vm')
        vm.runInContext(userCode, context)
      `)

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('execute')
      expect(result.requires).toContain('vm')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'vm_execution',
          impact: 'high',
        })
      )
    })
  })

  // ==========================================================================
  // Prototype Pollution Detection (3 tests)
  // Critical impact - can compromise entire application security
  // ==========================================================================
  describe('prototype pollution detection', () => {
    it('detects __proto__ assignment as critical impact', () => {
      const result = analyzeNodeSafety('obj.__proto__.isAdmin = true')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('system')
      expect(result.classification.reversible).toBe(false)
      expect(result.hasPrototypePollution).toBe(true)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'prototype_pollution',
          impact: 'critical',
        })
      )
    })

    it('detects Object.setPrototypeOf on prototype as critical', () => {
      const result = analyzeNodeSafety('Object.setPrototypeOf(target, maliciousProto)')

      expect(result.classification.impact).toBe('critical')
      expect(result.classification.type).toBe('system')
      expect(result.hasPrototypePollution).toBe(true)
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'prototype_pollution',
          impact: 'critical',
        })
      )
    })

    it('sets hasPrototypePollution flag correctly', () => {
      const safeResult = analyzeNodeSafety('const obj = { name: "test" }')
      expect(safeResult.hasPrototypePollution).toBe(false)

      const unsafeResult = analyzeNodeSafety('obj["__proto__"]["polluted"] = true')
      expect(unsafeResult.hasPrototypePollution).toBe(true)
    })
  })

  // ==========================================================================
  // child_process Detection (3 tests)
  // High impact - system command execution
  // ==========================================================================
  describe('child_process detection', () => {
    it('detects child_process.exec() as high impact', () => {
      const result = analyzeNodeSafety(`
        const { exec } = require('child_process')
        exec(userCommand, callback)
      `)

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.requires).toContain('child_process')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'child_process',
          impact: 'high',
        })
      )
    })

    it('detects child_process.spawn() as high impact', () => {
      const result = analyzeNodeSafety(`
        const cp = require('child_process')
        cp.spawn('rm', ['-rf', path])
      `)

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('system')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'child_process',
          impact: 'high',
        })
      )
    })

    it('detects require("child_process") in requires', () => {
      const result = analyzeNodeSafety(`
        const childProcess = require('child_process')
        childProcess.execFile('/bin/sh', ['-c', cmd])
      `)

      expect(result.requires).toContain('child_process')
      expect(result.classification.impact).toBe('high')
    })
  })

  // ==========================================================================
  // Dynamic require Detection (2 tests)
  // High impact - module injection vulnerability
  // ==========================================================================
  describe('dynamic require detection', () => {
    it('detects require with variable as high impact', () => {
      const result = analyzeNodeSafety('const mod = require(moduleName)')

      expect(result.classification.impact).toBe('high')
      expect(result.classification.type).toBe('execute')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'dynamic_require',
          impact: 'high',
        })
      )
    })

    it('detects require with template literal as high impact', () => {
      const result = analyzeNodeSafety('const mod = require(`./plugins/${pluginName}`)')

      expect(result.classification.impact).toBe('high')
      expect(result.patterns).toContainEqual(
        expect.objectContaining({
          type: 'dynamic_require',
          impact: 'high',
        })
      )
    })
  })

  // ==========================================================================
  // Safe Code Detection (2 tests)
  // Low impact - allowed patterns
  // ==========================================================================
  describe('safe code detection', () => {
    it('allows safe console.log (low impact)', () => {
      const result = analyzeNodeSafety('console.log("Hello, World!")')

      expect(result.classification.impact).toBe('low')
      expect(result.classification.type).toBe('read')
      expect(result.hasPrototypePollution).toBe(false)
      expect(result.patterns).toHaveLength(0)
    })

    it('allows safe require of known modules', () => {
      const result = analyzeNodeSafety(`
        const fs = require('fs')
        const path = require('path')
        const data = fs.readFileSync(path.join(__dirname, 'config.json'))
      `)

      expect(result.classification.impact).toBe('low')
      expect(result.requires).toContain('fs')
      expect(result.requires).toContain('path')
      // Should not contain critical or high impact patterns
      const dangerousPatterns = result.patterns.filter(
        p => p.impact === 'high' || p.impact === 'critical'
      )
      expect(dangerousPatterns).toHaveLength(0)
    })
  })
})
