/**
 * Language Detector Tests (RED Phase)
 *
 * Tests for detecting the programming language of input for multi-language shell support.
 * This module enables bashx to intelligently route commands to the appropriate
 * interpreter (Python, Ruby, Node.js, Go, Rust, or bash).
 *
 * Detection strategies (in priority order):
 * 1. Shebang - highest confidence (~0.95)
 * 2. Interpreter command - high confidence (~0.90)
 * 3. File extension - medium-high confidence (~0.85)
 * 4. Syntax patterns - medium confidence (~0.60-0.75)
 * 5. Default to bash - low confidence (~0.50)
 *
 * These tests are expected to FAIL initially (RED phase).
 * The implementation will be done in the GREEN phase.
 */

import { describe, it, expect } from 'vitest'

import {
  detectLanguage,
  CONFIDENCE,
  type SupportedLanguage,
  type DetectionMethod,
  type LanguageDetectionResult,
  type LanguageDetectionDetails,
} from '../../../core/classify/language-detector.js'

// =============================================================================
// SHEBANG DETECTION TESTS
// =============================================================================
describe('detectLanguage - shebang', () => {
  describe('Python shebangs', () => {
    it('detects python from #!/usr/bin/env python3', () => {
      const input = '#!/usr/bin/env python3\nprint("hello")'
      const result = detectLanguage(input)

      expect(result.language).toBe('python')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects python from #!/usr/bin/python3', () => {
      const input = '#!/usr/bin/python3\nprint("hello")'
      const result = detectLanguage(input)

      expect(result.language).toBe('python')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects python from #!/usr/bin/env python', () => {
      const input = '#!/usr/bin/env python\nprint("hello")'
      const result = detectLanguage(input)

      expect(result.language).toBe('python')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects python from #!/usr/local/bin/python3.11', () => {
      const input = '#!/usr/local/bin/python3.11\nprint("hello")'
      const result = detectLanguage(input)

      expect(result.language).toBe('python')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
      expect(result.details.runtime).toBe('python3.11')
    })
  })

  describe('Ruby shebangs', () => {
    it('detects ruby from #!/usr/bin/ruby', () => {
      const input = '#!/usr/bin/ruby\nputs "hello"'
      const result = detectLanguage(input)

      expect(result.language).toBe('ruby')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects ruby from #!/usr/bin/env ruby', () => {
      const input = '#!/usr/bin/env ruby\nputs "hello"'
      const result = detectLanguage(input)

      expect(result.language).toBe('ruby')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects ruby from #!/usr/local/bin/ruby3.2', () => {
      const input = '#!/usr/local/bin/ruby3.2\nputs "hello"'
      const result = detectLanguage(input)

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('shebang')
      expect(result.details.runtime).toBe('ruby3.2')
    })
  })

  describe('Node.js shebangs', () => {
    it('detects node from #!/usr/bin/env node', () => {
      const input = '#!/usr/bin/env node\nconsole.log("hello")'
      const result = detectLanguage(input)

      expect(result.language).toBe('node')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects node from #!/usr/bin/node', () => {
      const input = '#!/usr/bin/node\nconsole.log("hello")'
      const result = detectLanguage(input)

      expect(result.language).toBe('node')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects node from #!/usr/local/bin/node18', () => {
      const input = '#!/usr/local/bin/node18\nconsole.log("hello")'
      const result = detectLanguage(input)

      expect(result.language).toBe('node')
      expect(result.method).toBe('shebang')
      expect(result.details.runtime).toBe('node18')
    })

    it('detects node from #!/usr/bin/env deno', () => {
      const input = '#!/usr/bin/env deno\nconsole.log("hello")'
      const result = detectLanguage(input)

      // Deno runs JS/TS, so classify as node
      expect(result.language).toBe('node')
      expect(result.method).toBe('shebang')
    })

    it('detects node from #!/usr/bin/env bun', () => {
      const input = '#!/usr/bin/env bun\nconsole.log("hello")'
      const result = detectLanguage(input)

      // Bun runs JS/TS, so classify as node
      expect(result.language).toBe('node')
      expect(result.method).toBe('shebang')
    })
  })

  describe('Bash shebangs', () => {
    it('detects bash from #!/bin/bash', () => {
      const input = '#!/bin/bash\necho "hello"'
      const result = detectLanguage(input)

      expect(result.language).toBe('bash')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects bash from #!/usr/bin/env bash', () => {
      const input = '#!/usr/bin/env bash\necho "hello"'
      const result = detectLanguage(input)

      expect(result.language).toBe('bash')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects bash from #!/bin/sh', () => {
      const input = '#!/bin/sh\necho "hello"'
      const result = detectLanguage(input)

      expect(result.language).toBe('bash')
      expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      expect(result.method).toBe('shebang')
    })

    it('detects bash from #!/usr/bin/env zsh', () => {
      const input = '#!/usr/bin/env zsh\necho "hello"'
      const result = detectLanguage(input)

      // zsh is close enough to bash for our purposes
      expect(result.language).toBe('bash')
      expect(result.method).toBe('shebang')
    })
  })

  describe('Runtime version extraction', () => {
    it('extracts runtime version from shebang', () => {
      const input = '#!/usr/bin/env python3.11\nprint("hello")'
      const result = detectLanguage(input)

      expect(result.details.runtime).toBe('python3.11')
    })

    it('extracts node version from shebang path', () => {
      const input = '#!/usr/local/bin/node20\nconsole.log("hello")'
      const result = detectLanguage(input)

      expect(result.details.runtime).toBe('node20')
    })

    it('extracts ruby version from shebang', () => {
      const input = '#!/usr/bin/env ruby3.3\nputs "hello"'
      const result = detectLanguage(input)

      expect(result.details.runtime).toBe('ruby3.3')
    })
  })
})

// =============================================================================
// INTERPRETER COMMAND DETECTION TESTS
// =============================================================================
describe('detectLanguage - interpreter', () => {
  describe('Python interpreter commands', () => {
    it('detects python from "python script.py"', () => {
      const result = detectLanguage('python script.py')

      expect(result.language).toBe('python')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.method).toBe('interpreter')
      expect(result.details.file).toBe('script.py')
    })

    it('detects python from "python3 script.py"', () => {
      const result = detectLanguage('python3 script.py')

      expect(result.language).toBe('python')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.method).toBe('interpreter')
      expect(result.details.file).toBe('script.py')
    })

    it('detects python from "python3 -c \'print(1)\'"', () => {
      const result = detectLanguage("python3 -c 'print(1)'")

      expect(result.language).toBe('python')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.method).toBe('interpreter')
      expect(result.details.inline).toBe(true)
    })

    it('detects python from "python -m pytest"', () => {
      const result = detectLanguage('python -m pytest')

      expect(result.language).toBe('python')
      expect(result.method).toBe('interpreter')
    })

    it('detects python from "python3.11 app.py"', () => {
      const result = detectLanguage('python3.11 app.py')

      expect(result.language).toBe('python')
      expect(result.method).toBe('interpreter')
      expect(result.details.runtime).toBe('python3.11')
    })
  })

  describe('Ruby interpreter commands', () => {
    it('detects ruby from "ruby script.rb"', () => {
      const result = detectLanguage('ruby script.rb')

      expect(result.language).toBe('ruby')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.method).toBe('interpreter')
      expect(result.details.file).toBe('script.rb')
    })

    it('detects ruby from "ruby -e \'puts 1\'"', () => {
      const result = detectLanguage("ruby -e 'puts 1'")

      expect(result.language).toBe('ruby')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.method).toBe('interpreter')
      expect(result.details.inline).toBe(true)
    })

    it('detects ruby from "bundle exec ruby script.rb"', () => {
      const result = detectLanguage('bundle exec ruby script.rb')

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('interpreter')
    })

    it('detects ruby from "ruby3.2 app.rb"', () => {
      const result = detectLanguage('ruby3.2 app.rb')

      expect(result.language).toBe('ruby')
      expect(result.details.runtime).toBe('ruby3.2')
    })
  })

  describe('Node.js interpreter commands', () => {
    it('detects node from "node script.js"', () => {
      const result = detectLanguage('node script.js')

      expect(result.language).toBe('node')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.method).toBe('interpreter')
      expect(result.details.file).toBe('script.js')
    })

    it('detects node from "node --eval \'console.log(1)\'"', () => {
      const result = detectLanguage("node --eval 'console.log(1)'")

      expect(result.language).toBe('node')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.method).toBe('interpreter')
      expect(result.details.inline).toBe(true)
    })

    it('detects node from "node -e \'console.log(1)\'"', () => {
      const result = detectLanguage("node -e 'console.log(1)'")

      expect(result.language).toBe('node')
      expect(result.method).toBe('interpreter')
      expect(result.details.inline).toBe(true)
    })

    it('detects node from "node --inspect app.js"', () => {
      const result = detectLanguage('node --inspect app.js')

      expect(result.language).toBe('node')
      expect(result.method).toBe('interpreter')
    })

    it('detects node from "deno run script.ts"', () => {
      const result = detectLanguage('deno run script.ts')

      expect(result.language).toBe('node')
      expect(result.method).toBe('interpreter')
      expect(result.details.file).toBe('script.ts')
    })

    it('detects node from "bun run script.js"', () => {
      const result = detectLanguage('bun run script.js')

      expect(result.language).toBe('node')
      expect(result.method).toBe('interpreter')
    })

    it('detects node from "npx ts-node script.ts"', () => {
      const result = detectLanguage('npx ts-node script.ts')

      expect(result.language).toBe('node')
      expect(result.method).toBe('interpreter')
    })
  })

  describe('Go interpreter commands', () => {
    it('detects go from "go run main.go"', () => {
      const result = detectLanguage('go run main.go')

      expect(result.language).toBe('go')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.method).toBe('interpreter')
      expect(result.details.file).toBe('main.go')
    })

    it('detects go from "go run ."', () => {
      const result = detectLanguage('go run .')

      expect(result.language).toBe('go')
      expect(result.method).toBe('interpreter')
    })

    it('detects go from "go run ./cmd/app"', () => {
      const result = detectLanguage('go run ./cmd/app')

      expect(result.language).toBe('go')
      expect(result.method).toBe('interpreter')
    })
  })

  describe('Rust interpreter commands', () => {
    it('detects rust from "cargo run"', () => {
      const result = detectLanguage('cargo run')

      expect(result.language).toBe('rust')
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
      expect(result.method).toBe('interpreter')
    })

    it('detects rust from "cargo run --release"', () => {
      const result = detectLanguage('cargo run --release')

      expect(result.language).toBe('rust')
      expect(result.method).toBe('interpreter')
    })

    it('detects rust from "cargo run --bin myapp"', () => {
      const result = detectLanguage('cargo run --bin myapp')

      expect(result.language).toBe('rust')
      expect(result.method).toBe('interpreter')
    })

    it('detects rust from "rustc main.rs && ./main"', () => {
      const result = detectLanguage('rustc main.rs && ./main')

      expect(result.language).toBe('rust')
      expect(result.method).toBe('interpreter')
    })
  })
})

// =============================================================================
// FILE EXTENSION DETECTION TESTS
// =============================================================================
describe('detectLanguage - extension', () => {
  describe('Python file extensions', () => {
    it('detects python from .py file', () => {
      const result = detectLanguage('./script.py')

      expect(result.language).toBe('python')
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      expect(result.method).toBe('extension')
      expect(result.details.file).toBe('./script.py')
    })

    it('detects python from .pyw file', () => {
      const result = detectLanguage('app.pyw')

      expect(result.language).toBe('python')
      expect(result.method).toBe('extension')
    })

    it('detects python from full path with .py', () => {
      const result = detectLanguage('/usr/local/scripts/process.py')

      expect(result.language).toBe('python')
      expect(result.method).toBe('extension')
    })
  })

  describe('Ruby file extensions', () => {
    it('detects ruby from .rb file', () => {
      const result = detectLanguage('./script.rb')

      expect(result.language).toBe('ruby')
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      expect(result.method).toBe('extension')
      expect(result.details.file).toBe('./script.rb')
    })

    it('detects ruby from Gemfile', () => {
      const result = detectLanguage('Gemfile')

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('extension')
    })

    it('detects ruby from Rakefile', () => {
      const result = detectLanguage('Rakefile')

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('extension')
    })
  })

  describe('Node.js file extensions', () => {
    it('detects node from explicit .js execution', () => {
      const result = detectLanguage('./script.js')

      expect(result.language).toBe('node')
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      expect(result.method).toBe('extension')
      expect(result.details.file).toBe('./script.js')
    })

    it('detects node from .mjs file', () => {
      const result = detectLanguage('module.mjs')

      expect(result.language).toBe('node')
      expect(result.method).toBe('extension')
    })

    it('detects node from .cjs file', () => {
      const result = detectLanguage('config.cjs')

      expect(result.language).toBe('node')
      expect(result.method).toBe('extension')
    })

    it('detects node from .ts file', () => {
      const result = detectLanguage('app.ts')

      expect(result.language).toBe('node')
      expect(result.method).toBe('extension')
    })

    it('detects node from .tsx file', () => {
      const result = detectLanguage('component.tsx')

      expect(result.language).toBe('node')
      expect(result.method).toBe('extension')
    })
  })

  describe('Go file extensions', () => {
    it('detects go from .go file', () => {
      const result = detectLanguage('./main.go')

      expect(result.language).toBe('go')
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      expect(result.method).toBe('extension')
      expect(result.details.file).toBe('./main.go')
    })

    it('detects go from full path with .go', () => {
      const result = detectLanguage('/home/user/project/cmd/server/main.go')

      expect(result.language).toBe('go')
      expect(result.method).toBe('extension')
    })
  })

  describe('Rust file extensions', () => {
    it('detects rust from .rs file', () => {
      const result = detectLanguage('./main.rs')

      expect(result.language).toBe('rust')
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      expect(result.method).toBe('extension')
      expect(result.details.file).toBe('./main.rs')
    })

    it('detects rust from Cargo.toml path context', () => {
      const result = detectLanguage('./src/lib.rs')

      expect(result.language).toBe('rust')
      expect(result.method).toBe('extension')
    })
  })

  describe('Bash file extensions', () => {
    it('detects bash from .sh file', () => {
      const result = detectLanguage('./script.sh')

      expect(result.language).toBe('bash')
      expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      expect(result.method).toBe('extension')
    })

    it('detects bash from .bash file', () => {
      const result = detectLanguage('setup.bash')

      expect(result.language).toBe('bash')
      expect(result.method).toBe('extension')
    })

    it('detects bash from .zsh file', () => {
      const result = detectLanguage('config.zsh')

      expect(result.language).toBe('bash')
      expect(result.method).toBe('extension')
    })
  })
})

// =============================================================================
// SYNTAX PATTERN DETECTION TESTS
// =============================================================================
describe('detectLanguage - syntax', () => {
  describe('Python syntax patterns', () => {
    it('detects python from def keyword', () => {
      const code = `def hello():
    print("world")`
      const result = detectLanguage(code)

      expect(result.language).toBe('python')
      expect(result.confidence).toBeGreaterThanOrEqual(0.6)
      expect(result.confidence).toBeLessThanOrEqual(0.8)
      expect(result.method).toBe('syntax')
    })

    it('detects python from import statement', () => {
      const code = `import os
import sys
print(os.getcwd())`
      const result = detectLanguage(code)

      expect(result.language).toBe('python')
      expect(result.method).toBe('syntax')
    })

    it('detects python from from...import statement', () => {
      const code = `from pathlib import Path
p = Path(".")`
      const result = detectLanguage(code)

      expect(result.language).toBe('python')
      expect(result.method).toBe('syntax')
    })

    it('detects python from class definition', () => {
      const code = `class MyClass:
    def __init__(self):
        pass`
      const result = detectLanguage(code)

      expect(result.language).toBe('python')
      expect(result.method).toBe('syntax')
    })

    it('detects python from print function', () => {
      const result = detectLanguage('print("hello world")')

      expect(result.language).toBe('python')
      expect(result.method).toBe('syntax')
    })

    it('detects python from triple-quoted strings', () => {
      const code = `"""
This is a docstring
"""`
      const result = detectLanguage(code)

      expect(result.language).toBe('python')
      expect(result.method).toBe('syntax')
    })

    it('detects python from list comprehension', () => {
      const code = '[x*2 for x in range(10)]'
      const result = detectLanguage(code)

      expect(result.language).toBe('python')
      expect(result.method).toBe('syntax')
    })
  })

  describe('Ruby syntax patterns', () => {
    it('detects ruby from puts/end keywords', () => {
      const code = `def hello
  puts "world"
end`
      const result = detectLanguage(code)

      expect(result.language).toBe('ruby')
      expect(result.confidence).toBeGreaterThanOrEqual(0.6)
      expect(result.confidence).toBeLessThanOrEqual(0.8)
      expect(result.method).toBe('syntax')
    })

    it('detects ruby from require statement', () => {
      const code = `require 'json'
data = JSON.parse(input)`
      const result = detectLanguage(code)

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('syntax')
    })

    it('detects ruby from class...end block', () => {
      const code = `class MyClass
  def initialize
    @value = 0
  end
end`
      const result = detectLanguage(code)

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('syntax')
    })

    it('detects ruby from do...end block', () => {
      const code = `[1, 2, 3].each do |x|
  puts x
end`
      const result = detectLanguage(code)

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('syntax')
    })

    it('detects ruby from symbol syntax', () => {
      const code = 'hash = { :key => "value", :other => 123 }'
      const result = detectLanguage(code)

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('syntax')
    })

    it('detects ruby from attr_accessor', () => {
      const code = `class Person
  attr_accessor :name, :age
end`
      const result = detectLanguage(code)

      expect(result.language).toBe('ruby')
      expect(result.method).toBe('syntax')
    })
  })

  describe('Node.js/JavaScript syntax patterns', () => {
    it('detects node from const/let/async', () => {
      const code = `const x = 1
let y = 2
async function fetch() {}`
      const result = detectLanguage(code)

      expect(result.language).toBe('node')
      expect(result.confidence).toBeGreaterThanOrEqual(0.6)
      expect(result.confidence).toBeLessThanOrEqual(0.8)
      expect(result.method).toBe('syntax')
    })

    it('detects node from console.log', () => {
      const result = detectLanguage('console.log("hello")')

      expect(result.language).toBe('node')
      expect(result.method).toBe('syntax')
    })

    it('detects node from require syntax', () => {
      const code = `const fs = require('fs')
const path = require('path')`
      const result = detectLanguage(code)

      expect(result.language).toBe('node')
      expect(result.method).toBe('syntax')
    })

    it('detects node from ES module import', () => {
      const code = `import fs from 'fs'
import { join } from 'path'`
      const result = detectLanguage(code)

      expect(result.language).toBe('node')
      expect(result.method).toBe('syntax')
    })

    it('detects node from arrow function', () => {
      const code = 'const add = (a, b) => a + b'
      const result = detectLanguage(code)

      expect(result.language).toBe('node')
      expect(result.method).toBe('syntax')
    })

    it('detects node from async/await', () => {
      const code = `async function getData() {
  const response = await fetch(url)
  return response.json()
}`
      const result = detectLanguage(code)

      expect(result.language).toBe('node')
      expect(result.method).toBe('syntax')
    })

    it('detects node from export statement', () => {
      const code = `export const value = 42
export default function() {}`
      const result = detectLanguage(code)

      expect(result.language).toBe('node')
      expect(result.method).toBe('syntax')
    })

    it('detects node from TypeScript type annotation', () => {
      const code = `const x: number = 1
function add(a: number, b: number): number {
  return a + b
}`
      const result = detectLanguage(code)

      expect(result.language).toBe('node')
      expect(result.method).toBe('syntax')
    })
  })

  describe('Go syntax patterns', () => {
    it('detects go from package declaration', () => {
      const code = `package main

import "fmt"

func main() {
    fmt.Println("hello")
}`
      const result = detectLanguage(code)

      expect(result.language).toBe('go')
      expect(result.method).toBe('syntax')
    })

    it('detects go from func keyword', () => {
      const code = `func add(a, b int) int {
    return a + b
}`
      const result = detectLanguage(code)

      expect(result.language).toBe('go')
      expect(result.method).toBe('syntax')
    })

    it('detects go from go keyword (goroutine)', () => {
      const code = `go func() {
    processData()
}()`
      const result = detectLanguage(code)

      expect(result.language).toBe('go')
      expect(result.method).toBe('syntax')
    })

    it('detects go from chan keyword', () => {
      const code = 'ch := make(chan int)'
      const result = detectLanguage(code)

      expect(result.language).toBe('go')
      expect(result.method).toBe('syntax')
    })

    it('detects go from := assignment', () => {
      const code = `x := 1
y := "hello"`
      const result = detectLanguage(code)

      expect(result.language).toBe('go')
      expect(result.method).toBe('syntax')
    })
  })

  describe('Rust syntax patterns', () => {
    it('detects rust from fn keyword', () => {
      const code = `fn main() {
    println!("hello");
}`
      const result = detectLanguage(code)

      expect(result.language).toBe('rust')
      expect(result.method).toBe('syntax')
    })

    it('detects rust from let mut', () => {
      const code = `let mut x = 1;
x += 1;`
      const result = detectLanguage(code)

      expect(result.language).toBe('rust')
      expect(result.method).toBe('syntax')
    })

    it('detects rust from macro syntax (println!)', () => {
      const result = detectLanguage('println!("hello world");')

      expect(result.language).toBe('rust')
      expect(result.method).toBe('syntax')
    })

    it('detects rust from use/mod statements', () => {
      const code = `use std::io;
mod utils;`
      const result = detectLanguage(code)

      expect(result.language).toBe('rust')
      expect(result.method).toBe('syntax')
    })

    it('detects rust from impl block', () => {
      const code = `impl MyStruct {
    fn new() -> Self {
        MyStruct {}
    }
}`
      const result = detectLanguage(code)

      expect(result.language).toBe('rust')
      expect(result.method).toBe('syntax')
    })

    it('detects rust from lifetime annotations', () => {
      const code = "fn longest<'a>(x: &'a str, y: &'a str) -> &'a str { x }"
      const result = detectLanguage(code)

      expect(result.language).toBe('rust')
      expect(result.method).toBe('syntax')
    })
  })

  describe('Default to bash for ambiguous/unknown input', () => {
    it('defaults to bash for ambiguous input', () => {
      const result = detectLanguage('x = 1')

      expect(result.language).toBe('bash')
      expect(result.confidence).toBeLessThanOrEqual(0.6)
      expect(result.method).toBe('default')
    })

    it('defaults to bash for unknown syntax', () => {
      const result = detectLanguage('some random text')

      expect(result.language).toBe('bash')
      expect(result.confidence).toBeLessThanOrEqual(0.6)
      expect(result.method).toBe('default')
    })

    it('defaults to bash for empty input', () => {
      const result = detectLanguage('')

      expect(result.language).toBe('bash')
      expect(result.confidence).toBeLessThanOrEqual(0.6)
      expect(result.method).toBe('default')
    })

    it('defaults to bash for whitespace-only input', () => {
      const result = detectLanguage('   \n\t  ')

      expect(result.language).toBe('bash')
      expect(result.method).toBe('default')
    })

    it('defaults to bash for common shell commands', () => {
      const result = detectLanguage('ls -la')

      expect(result.language).toBe('bash')
      expect(result.method).toBe('default')
    })

    it('defaults to bash for pipe commands', () => {
      const result = detectLanguage('cat file.txt | grep pattern')

      expect(result.language).toBe('bash')
      expect(result.method).toBe('default')
    })
  })
})

// =============================================================================
// RESULT STRUCTURE TESTS
// =============================================================================
describe('detectLanguage - result structure', () => {
  it('returns all required fields', () => {
    const result = detectLanguage('echo hello')

    expect(result).toHaveProperty('language')
    expect(result).toHaveProperty('confidence')
    expect(result).toHaveProperty('method')
    expect(result).toHaveProperty('details')
  })

  it('returns valid SupportedLanguage', () => {
    const validLanguages: SupportedLanguage[] = ['bash', 'python', 'ruby', 'node', 'go', 'rust']
    const result = detectLanguage('echo hello')

    expect(validLanguages).toContain(result.language)
  })

  it('returns valid DetectionMethod', () => {
    const validMethods: DetectionMethod[] = ['shebang', 'interpreter', 'extension', 'syntax', 'default']
    const result = detectLanguage('echo hello')

    expect(validMethods).toContain(result.method)
  })

  it('returns confidence between 0 and 1', () => {
    const inputs = [
      '#!/usr/bin/env python3\nprint("hello")',
      'python3 script.py',
      './script.py',
      'def hello(): pass',
      'echo hello',
    ]

    for (const input of inputs) {
      const result = detectLanguage(input)
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('returns details object (may be empty)', () => {
    const result = detectLanguage('echo hello')

    expect(result.details).toBeDefined()
    expect(typeof result.details).toBe('object')
  })
})

// =============================================================================
// CONFIDENCE ORDERING TESTS
// =============================================================================
describe('detectLanguage - confidence ordering', () => {
  it('shebang has highest confidence (~0.95)', () => {
    const result = detectLanguage('#!/usr/bin/env python3\nprint("hello")')

    expect(result.method).toBe('shebang')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('interpreter command has high confidence (~0.90)', () => {
    const result = detectLanguage('python3 script.py')

    expect(result.method).toBe('interpreter')
    expect(result.confidence).toBeGreaterThanOrEqual(0.85)
    expect(result.confidence).toBeLessThan(0.95)
  })

  it('file extension has medium-high confidence (~0.85)', () => {
    const result = detectLanguage('./script.py')

    expect(result.method).toBe('extension')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
    expect(result.confidence).toBeLessThan(0.9)
  })

  it('syntax patterns have medium confidence (~0.60-0.75)', () => {
    const result = detectLanguage('def hello(): pass')

    expect(result.method).toBe('syntax')
    expect(result.confidence).toBeGreaterThanOrEqual(0.6)
    expect(result.confidence).toBeLessThanOrEqual(0.8)
  })

  it('default has low confidence (~0.50)', () => {
    const result = detectLanguage('unknown command')

    expect(result.method).toBe('default')
    expect(result.confidence).toBeLessThanOrEqual(0.6)
    expect(result.confidence).toBeGreaterThanOrEqual(0.4)
  })

  it('shebang takes priority over syntax patterns', () => {
    // This has both shebang and Python syntax
    const code = `#!/usr/bin/env python3
def hello():
    print("world")
`
    const result = detectLanguage(code)

    expect(result.method).toBe('shebang')
    expect(result.language).toBe('python')
  })

  it('interpreter takes priority over extension', () => {
    // python script.py - interpreter is detected first
    const result = detectLanguage('python script.py')

    expect(result.method).toBe('interpreter')
  })
})

// =============================================================================
// EDGE CASES AND COMPLEX INPUTS
// =============================================================================
describe('detectLanguage - edge cases', () => {
  it('handles mixed language scripts (uses shebang)', () => {
    // Python script that runs shell commands
    const code = `#!/usr/bin/env python3
import subprocess
subprocess.run(['ls', '-la'])`
    const result = detectLanguage(code)

    expect(result.language).toBe('python')
    expect(result.method).toBe('shebang')
  })

  it('handles code with comments', () => {
    const code = `# This is a Python script
def main():
    pass`
    const result = detectLanguage(code)

    expect(result.language).toBe('python')
    expect(result.method).toBe('syntax')
  })

  it('handles multiline strings', () => {
    const code = `const template = \`
line 1
line 2
\``
    const result = detectLanguage(code)

    expect(result.language).toBe('node')
    expect(result.method).toBe('syntax')
  })

  it('handles unicode content', () => {
    const code = 'puts "Hello, \u4E16\u754C!"'
    const result = detectLanguage(code)

    expect(result.language).toBe('ruby')
    expect(result.method).toBe('syntax')
  })

  it('handles very long input', () => {
    const longCode = 'print("x")\n'.repeat(1000)
    const result = detectLanguage(longCode)

    expect(result.language).toBe('python')
  })

  it('handles input with only whitespace and comments', () => {
    const code = `# just a comment
# another comment`
    const result = detectLanguage(code)

    // Comments only - defaults to bash since # is valid bash comment
    expect(result.language).toBe('bash')
  })

  it('handles shebang with flags', () => {
    const code = '#!/usr/bin/env python3 -u\nprint("hello")'
    const result = detectLanguage(code)

    expect(result.language).toBe('python')
    expect(result.method).toBe('shebang')
  })

  it('handles Windows line endings', () => {
    const code = '#!/usr/bin/env python3\r\nprint("hello")\r\n'
    const result = detectLanguage(code)

    expect(result.language).toBe('python')
  })
})

// =============================================================================
// TYPE DEFINITIONS TESTS
// =============================================================================
describe('Type Definitions', () => {
  it('SupportedLanguage type includes all languages', () => {
    const languages: SupportedLanguage[] = ['bash', 'python', 'ruby', 'node', 'go', 'rust']
    expect(languages).toHaveLength(6)
  })

  it('DetectionMethod type includes all methods', () => {
    const methods: DetectionMethod[] = ['shebang', 'interpreter', 'extension', 'syntax', 'default']
    expect(methods).toHaveLength(5)
  })

  it('LanguageDetectionResult has correct structure', () => {
    const mockResult: LanguageDetectionResult = {
      language: 'python',
      confidence: 0.95,
      method: 'shebang',
      details: {
        runtime: 'python3.11',
        inline: false,
        file: undefined,
      },
    }

    expect(mockResult.language).toBe('python')
    expect(mockResult.confidence).toBe(0.95)
    expect(mockResult.method).toBe('shebang')
    expect(mockResult.details.runtime).toBe('python3.11')
  })

  it('LanguageDetectionDetails allows optional fields', () => {
    const emptyDetails: LanguageDetectionDetails = {}
    expect(emptyDetails.runtime).toBeUndefined()
    expect(emptyDetails.inline).toBeUndefined()
    expect(emptyDetails.file).toBeUndefined()

    const partialDetails: LanguageDetectionDetails = {
      runtime: 'node18',
    }
    expect(partialDetails.runtime).toBe('node18')
    expect(partialDetails.inline).toBeUndefined()
  })
})

// =============================================================================
// CONFIDENCE CONSTANTS TESTS
// =============================================================================
describe('CONFIDENCE constants', () => {
  it('should export CONFIDENCE object', () => {
    expect(CONFIDENCE).toBeDefined()
    expect(typeof CONFIDENCE).toBe('object')
  })

  it('should have SHEBANG confidence of 0.95', () => {
    expect(CONFIDENCE.SHEBANG).toBe(0.95)
  })

  it('should have INTERPRETER confidence of 0.90', () => {
    expect(CONFIDENCE.INTERPRETER).toBe(0.90)
  })

  it('should have EXTENSION confidence of 0.85', () => {
    expect(CONFIDENCE.EXTENSION).toBe(0.85)
  })

  it('should have syntax confidence levels for pattern matching', () => {
    // Various confidence levels for syntax pattern detection
    expect(CONFIDENCE.SYNTAX_HIGH).toBe(0.75)
    expect(CONFIDENCE.SYNTAX_MEDIUM).toBe(0.70)
    expect(CONFIDENCE.SYNTAX_LOW).toBe(0.65)
    expect(CONFIDENCE.SYNTAX_LOWER).toBe(0.60)
    expect(CONFIDENCE.SYNTAX_LOWEST).toBe(0.55)
  })

  it('should have DEFAULT confidence of 0.50', () => {
    expect(CONFIDENCE.DEFAULT).toBe(0.50)
  })

  it('should use CONFIDENCE.SHEBANG in shebang detection results', () => {
    const result = detectLanguage('#!/usr/bin/env python3\nprint("hello")')
    expect(result.confidence).toBe(CONFIDENCE.SHEBANG)
  })

  it('should use CONFIDENCE.INTERPRETER in interpreter detection results', () => {
    const result = detectLanguage('python script.py')
    expect(result.confidence).toBe(CONFIDENCE.INTERPRETER)
  })

  it('should use CONFIDENCE.EXTENSION in extension detection results', () => {
    const result = detectLanguage('./analyze.py')
    expect(result.confidence).toBe(CONFIDENCE.EXTENSION)
  })

  it('should use CONFIDENCE.DEFAULT in default detection results', () => {
    const result = detectLanguage('echo "hello"')
    expect(result.confidence).toBe(CONFIDENCE.DEFAULT)
  })

  it('confidence values should be in descending order of reliability', () => {
    expect(CONFIDENCE.SHEBANG).toBeGreaterThan(CONFIDENCE.INTERPRETER)
    expect(CONFIDENCE.INTERPRETER).toBeGreaterThan(CONFIDENCE.EXTENSION)
    expect(CONFIDENCE.EXTENSION).toBeGreaterThan(CONFIDENCE.SYNTAX_HIGH)
    expect(CONFIDENCE.SYNTAX_HIGH).toBeGreaterThan(CONFIDENCE.DEFAULT)
  })
})
