# pyx

Python execution for Cloudflare Workers using Pyodide. Scientific computing, data analysis, and ML inference at the edge with ~1s cold starts and memory snapshots.

## Installation

```bash
npm install pyx
```

## Features

- **Pyodide Runtime** - Full Python 3.11 in WebAssembly
- **Scientific Stack** - NumPy, Pandas, SciPy out of the box
- **Memory Snapshots** - Sub-second cold starts with pre-warmed state
- **Session Management** - Persistent Python environments
- **Safety Analysis** - Detect dangerous code before execution

## Usage

```typescript
import { py } from 'pyx'

// Execute Python
const result = await py.exec(`
  import numpy as np
  arr = np.array([1, 2, 3, 4, 5])
  np.mean(arr)
`)
console.log(result.result)  // 3.0

// Session with state
const session = await py.session()
await session.exec('x = 42')
await session.exec('y = x * 2')
const { result } = await session.exec('y')  // 84

// Install packages
await py.install('requests')
```

## Configuration

```typescript
import { Pyx } from 'pyx'

const py = new Pyx({
  // Pre-installed packages
  packages: ['numpy', 'pandas', 'scikit-learn'],

  // Memory limits
  memoryLimit: 512 * 1024 * 1024,  // 512MB

  // Snapshot for fast cold starts
  snapshot: snapshotBuffer
})
```

## API

### `py.exec(code: string): Promise<PyExecResult>`

Execute Python code and return the result.

```typescript
interface PyExecResult {
  result: unknown    // Return value of last expression
  stdout: string     // Captured stdout
  stderr: string     // Captured stderr
  duration: number   // Execution time in ms
}
```

### `py.session(): Promise<PySession>`

Create a persistent Python session.

### `py.install(package: string): Promise<void>`

Install a Python package from PyPI.

### `py.snapshot(): Promise<Uint8Array>`

Create a memory snapshot for fast cold starts.

## Cloudflare Workers

```typescript
import { Pyx } from 'pyx'

export default {
  async fetch(request: Request, env: Env) {
    const py = new Pyx({ env })

    const { result } = await py.exec(`
      import json
      data = {'message': 'Hello from Python!'}
      json.dumps(data)
    `)

    return new Response(result)
  }
}
```

## Related

- [@dotdo/pyx](./core) - Core library (no CF dependencies)
- [fsx.do](https://fsx.do) - Filesystem for Workers
- [bashx.do](https://bashx.do) - Shell execution
- [npmx](https://npmx.do) - NPM for edge

## License

MIT
