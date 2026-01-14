/**
 * Language Router Tests (RED Phase)
 *
 * Tests for the LanguageRouter facade that combines language detection
 * with execution routing logic.
 *
 * LanguageRouter unifies:
 * 1. Language detection (from language-detector.ts)
 * 2. Package manager to language mappings (from tiered-executor.ts)
 * 3. Worker availability-based routing decisions
 *
 * Routing destinations:
 * - 'polyglot': Route to language-specific worker when available
 * - 'sandbox': Route to container sandbox when no worker available
 *
 * These tests are expected to FAIL initially (RED phase).
 */

import { describe, it, expect } from 'vitest'

import {
  LanguageRouter,
  type RoutingResult,
  type RoutingDestination,
} from './language-router.js'

describe('LanguageRouter', () => {
  // ==========================================================================
  // Basic Language Routing (Python)
  // ==========================================================================
  describe('Python Routing', () => {
    it('should route Python code to polyglot when worker is available', () => {
      const router = new LanguageRouter()
      const result = router.route('python3 script.py', ['python'])

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('polyglot')
      expect(result.worker).toBe('python')
      expect(result.detection).toBeDefined()
      expect(result.detection.method).toBe('interpreter')
    })

    it('should route Python code to sandbox when no worker available', () => {
      const router = new LanguageRouter()
      const result = router.route('python3 script.py', [])

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('sandbox')
      expect(result.worker).toBeUndefined()
    })

    it('should route Python code to sandbox when availableWorkers not provided', () => {
      const router = new LanguageRouter()
      const result = router.route('python3 script.py')

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('sandbox')
      expect(result.worker).toBeUndefined()
    })

    it('should detect Python from shebang and route correctly', () => {
      const router = new LanguageRouter()
      const result = router.route('#!/usr/bin/env python3\nprint("hello")', ['python'])

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('polyglot')
      expect(result.detection.method).toBe('shebang')
    })
  })

  // ==========================================================================
  // Package Manager Routing
  // ==========================================================================
  describe('Package Manager Routing', () => {
    it('should route pip to Python worker when available', () => {
      const router = new LanguageRouter()
      const result = router.route('pip install requests', ['python'])

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('polyglot')
      expect(result.worker).toBe('python')
      expect(result.packageManager).toBe('pip')
    })

    it('should route pip3 to Python worker when available', () => {
      const router = new LanguageRouter()
      const result = router.route('pip3 install numpy', ['python'])

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('polyglot')
      expect(result.worker).toBe('python')
      expect(result.packageManager).toBe('pip3')
    })

    it('should route pipx to Python worker when available', () => {
      const router = new LanguageRouter()
      const result = router.route('pipx install black', ['python'])

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('polyglot')
      expect(result.packageManager).toBe('pipx')
    })

    it('should route uvx to Python worker when available', () => {
      const router = new LanguageRouter()
      const result = router.route('uvx run ruff check .', ['python'])

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('polyglot')
      expect(result.packageManager).toBe('uvx')
    })

    it('should route pyx to Python worker when available', () => {
      const router = new LanguageRouter()
      const result = router.route('pyx install package', ['python'])

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('polyglot')
      expect(result.packageManager).toBe('pyx')
    })

    it('should route gem to Ruby worker when available', () => {
      const router = new LanguageRouter()
      const result = router.route('gem install rails', ['ruby'])

      expect(result.language).toBe('ruby')
      expect(result.routeTo).toBe('polyglot')
      expect(result.worker).toBe('ruby')
      expect(result.packageManager).toBe('gem')
    })

    it('should route bundle to Ruby worker when available', () => {
      const router = new LanguageRouter()
      const result = router.route('bundle install', ['ruby'])

      expect(result.language).toBe('ruby')
      expect(result.routeTo).toBe('polyglot')
      expect(result.packageManager).toBe('bundle')
    })

    it('should route package manager to sandbox when no worker available', () => {
      const router = new LanguageRouter()
      const result = router.route('pip install requests', [])

      expect(result.language).toBe('python')
      expect(result.routeTo).toBe('sandbox')
      expect(result.worker).toBeUndefined()
      expect(result.packageManager).toBe('pip')
    })
  })

  // ==========================================================================
  // Node.js Routing
  // ==========================================================================
  describe('Node.js Routing', () => {
    it('should route Node.js code to polyglot when worker available', () => {
      const router = new LanguageRouter()
      const result = router.route('node script.js', ['node'])

      expect(result.language).toBe('node')
      expect(result.routeTo).toBe('polyglot')
      expect(result.worker).toBe('node')
    })

    it('should route Node.js code to sandbox when no worker', () => {
      const router = new LanguageRouter()
      const result = router.route('node script.js', [])

      expect(result.language).toBe('node')
      expect(result.routeTo).toBe('sandbox')
    })

    it('should detect Node from syntax and route correctly', () => {
      const router = new LanguageRouter()
      const result = router.route('const x = 42\nconsole.log(x)', ['node'])

      expect(result.language).toBe('node')
      expect(result.routeTo).toBe('polyglot')
      expect(result.detection.method).toBe('syntax')
    })
  })

  // ==========================================================================
  // Bash Commands (No Routing Change)
  // ==========================================================================
  describe('Bash Command Routing', () => {
    it('should keep bash commands as bash with no routing change', () => {
      const router = new LanguageRouter()
      const result = router.route('ls -la', ['python', 'node'])

      expect(result.language).toBe('bash')
      expect(result.routeTo).toBe('sandbox')
      expect(result.worker).toBeUndefined()
    })

    it('should recognize bash from echo command', () => {
      const router = new LanguageRouter()
      const result = router.route('echo "hello world"', ['python'])

      expect(result.language).toBe('bash')
      expect(result.routeTo).toBe('sandbox')
    })

    it('should route bash scripts to sandbox', () => {
      const router = new LanguageRouter()
      const result = router.route('#!/bin/bash\necho "hello"', ['python'])

      expect(result.language).toBe('bash')
      expect(result.routeTo).toBe('sandbox')
    })
  })

  // ==========================================================================
  // Ruby Routing
  // ==========================================================================
  describe('Ruby Routing', () => {
    it('should route Ruby code to polyglot when worker available', () => {
      const router = new LanguageRouter()
      const result = router.route('ruby script.rb', ['ruby'])

      expect(result.language).toBe('ruby')
      expect(result.routeTo).toBe('polyglot')
      expect(result.worker).toBe('ruby')
    })

    it('should route Ruby code to sandbox when no worker', () => {
      const router = new LanguageRouter()
      const result = router.route('ruby script.rb', [])

      expect(result.language).toBe('ruby')
      expect(result.routeTo).toBe('sandbox')
    })
  })

  // ==========================================================================
  // Go and Rust Routing
  // ==========================================================================
  describe('Go and Rust Routing', () => {
    it('should route Go code to polyglot when worker available', () => {
      const router = new LanguageRouter()
      const result = router.route('go run main.go', ['go'])

      expect(result.language).toBe('go')
      expect(result.routeTo).toBe('polyglot')
      expect(result.worker).toBe('go')
    })

    it('should route Rust/Cargo to polyglot when worker available', () => {
      const router = new LanguageRouter()
      const result = router.route('cargo run', ['rust'])

      expect(result.language).toBe('rust')
      expect(result.routeTo).toBe('polyglot')
      expect(result.worker).toBe('rust')
    })

    it('should route Go to sandbox when no worker', () => {
      const router = new LanguageRouter()
      const result = router.route('go build', [])

      expect(result.language).toBe('go')
      expect(result.routeTo).toBe('sandbox')
    })
  })

  // ==========================================================================
  // Static Methods
  // ==========================================================================
  describe('Static Methods', () => {
    it('should provide package manager mappings via static method', () => {
      const mappings = LanguageRouter.getPackageManagerMappings()

      expect(mappings.pip).toBe('python')
      expect(mappings.pip3).toBe('python')
      expect(mappings.gem).toBe('ruby')
      expect(mappings.bundle).toBe('ruby')
    })

    it('should check if a command is a package manager', () => {
      expect(LanguageRouter.isPackageManager('pip')).toBe(true)
      expect(LanguageRouter.isPackageManager('pip3')).toBe(true)
      expect(LanguageRouter.isPackageManager('gem')).toBe(true)
      expect(LanguageRouter.isPackageManager('ls')).toBe(false)
      expect(LanguageRouter.isPackageManager('python')).toBe(false)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle empty input gracefully', () => {
      const router = new LanguageRouter()
      const result = router.route('', [])

      expect(result.language).toBe('bash')
      expect(result.routeTo).toBe('sandbox')
    })

    it('should handle whitespace-only input', () => {
      const router = new LanguageRouter()
      const result = router.route('   ', [])

      expect(result.language).toBe('bash')
      expect(result.routeTo).toBe('sandbox')
    })

    it('should handle mixed case worker names', () => {
      const router = new LanguageRouter()
      // Workers are case-sensitive, should match exactly
      const result = router.route('python3 script.py', ['Python'])

      // 'Python' !== 'python', so no match
      expect(result.routeTo).toBe('sandbox')
    })
  })
})
