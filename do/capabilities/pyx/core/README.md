# @dotdo/pyx

Platform-agnostic Python execution utilities. AST parsing, safety analysis, code transformations, and package management for Pyodide and other Python runtimes. Zero Cloudflare dependencies.

## Installation

```bash
npm install @dotdo/pyx
```

## Features

- **AST Parser** - Full Python AST parser in TypeScript
- **Safety Analyzer** - Detect dangerous code patterns
- **Code Transforms** - Async wrapping, import rewriting, output capture
- **Package Parsing** - pyproject.toml, requirements.txt, setup.py
- **Virtual Env** - Manage packages with dependency resolution

## Usage

```typescript
import {
  parse,
  analyzeSafety,
  wrapAsync,
  parseRequirements,
  VirtualEnv
} from '@dotdo/pyx'

// Parse Python AST
const ast = parse('def hello(): return "world"')

// Safety analysis
const report = analyzeSafety(`
  import os
  os.system('rm -rf /')
`)
// { safe: false, violations: [{ type: 'dangerous_import', ... }] }

// Transform for Pyodide
const wrapped = wrapAsync('await fetch("url")')

// Parse requirements
const deps = parseRequirements('numpy>=1.20\npandas~=1.4')

// Virtual environment
const venv = new VirtualEnv()
await venv.install('numpy', '1.24.0')
```

## Subpath Exports

```typescript
import { parse, walk, ASTNode, ASTVisitor } from '@dotdo/pyx/ast'
import { analyze, SafetyReport, rules } from '@dotdo/pyx/safety'
import { wrapAsync, rewriteImports, capturePrint } from '@dotdo/pyx/transform'
import { parsePyproject, parseRequirements } from '@dotdo/pyx/packages'
import { VirtualEnv, checkCompatibility } from '@dotdo/pyx/venv'
```

## API

### AST (`@dotdo/pyx/ast`)

- `parse(code: string): Module` - Parse Python to AST
- `parseExpression(code: string): Expression` - Parse single expression
- `walk(node: ASTNode, visitor: ASTVisitor)` - Walk AST
- `getNodesOfType(node: ASTNode, type: string): ASTNode[]`

### Safety (`@dotdo/pyx/safety`)

- `analyze(code: string): SafetyReport`
- `SafetyReport.safe: boolean`
- `SafetyReport.violations: Violation[]`

Detects:
- Dangerous imports (os, subprocess, socket)
- Code execution (exec, eval, compile)
- Filesystem/network access
- Infinite loops
- Pickle deserialization

### Transform (`@dotdo/pyx/transform`)

- `wrapAsync(code: string): string` - Wrap for async execution
- `wrapTopLevelAwait(code: string): string`
- `rewriteImports(code: string, mapping): string`
- `capturePrint(code: string): string`
- `mockInput(code: string, inputs: string[]): string`

### Packages (`@dotdo/pyx/packages`)

- `parsePyproject(toml: string): PackageMetadata`
- `parseRequirements(txt: string): Dependency[]`
- `parseSetupPy(code: string): PackageMetadata`

### VirtualEnv (`@dotdo/pyx/venv`)

- `VirtualEnv.install(name: string, version?: string)`
- `VirtualEnv.uninstall(name: string)`
- `VirtualEnv.list(): InstalledPackage[]`
- `VirtualEnv.export(format: 'json' | 'requirements'): string`
- `checkPyodideCompatibility(package: string): boolean`

## Related

- [pyx](https://pyx.do) - Managed service for Workers
- [fsx.do](https://fsx.do) - Filesystem
- [bashx.do](https://bashx.do) - Shell execution

## License

MIT
