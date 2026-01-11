# Primitive Shell Scripting

**Shell scripts. Zero VMs. Pennies per million.**

```typescript
import { DO } from 'dotdo'
import { withBash, withFs } from 'dotdo/mixins'

class BuildAgent extends withBash(withFs(DO)) {
  async build(repoUrl: string) {
    await this.$.bash`git clone ${repoUrl} ./project`
    await this.$.bash`cd project && npm install`
    await this.$.bash`cd project && npm run build`

    return await this.$.fs.glob('project/dist/**/*')
  }
}
```

**You just ran a build pipeline. Cost: $0.0001**

---

## The Problem

You need to run shell commands for your AI agents. But:

- VMs are expensive ($0.10/hour minimum)
- Cold starts kill latency (10-30 seconds)
- Managing Linux instances is a full-time job
- Security is terrifying (what if the AI runs `rm -rf /`?)

## The Solution

bashx executes shell commands on Cloudflare's edge network. Every command is:

1. **AST-parsed** - Structural analysis, not regex
2. **Safety-classified** - Read/write/delete/system with impact levels
3. **Tier-optimized** - Native, RPC, or sandbox based on command
4. **Blocked if dangerous** - `rm -rf /` never executes

```
Input: "npm run build"
         ↓
┌─────────────────────────────────────┐
│         AST Parser                  │
│    tree-sitter-bash (WASM)          │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│         Safety Classification       │
│    type: 'execute'                  │
│    impact: 'low'                    │
│    reversible: true                 │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│         Tier 2: npm.do RPC          │
│    Execute via npm service          │
│    ~5ms latency                     │
└─────────────────────────────────────┘
         ↓
Output: Build artifacts
```

---

## How It Works

### Tiered Execution

Commands run in the optimal tier for performance:

| Tier | Latency | Examples | Implementation |
|------|---------|----------|----------------|
| 1 | <1ms | `cat`, `ls`, `echo` | Native Workers APIs |
| 2 | <5ms | `git`, `npm`, `jq` | RPC to specialized services |
| 3 | <10ms | npm packages | Dynamic V8 isolate loading |
| 4 | 2-3s | `python`, `ffmpeg` | Sandboxed Linux container |

### Safety Analysis

Every command is classified before execution:

```typescript
// Safe - executes immediately
await $.bash`ls -la`
// → { type: 'read', impact: 'none' }

// Dangerous - blocked
await $.bash`rm -rf /`
// → { blocked: true, reason: 'Recursive delete targeting root filesystem' }

// High impact - requires confirmation
await $.bash`chmod -R 777 /app`
// → { requiresConfirm: true }

// With explicit confirmation
await $.bash.exec('rm', ['-rf', 'node_modules'], { confirm: true })
// → executes
```

### Command Chaining

Unix pipes and operators work as expected:

```typescript
// Find errors in logs
await $.bash`grep ERROR access.log | sort | uniq -c | head -10`

// Conditional execution
await $.bash`npm test && npm run build`

// Background processing
await $.bash`ffmpeg -i video.mp4 output.webm &`
```

---

## Examples

### Build Automation

```typescript
class ProjectBuilder extends withBash(withFs(DO)) {
  async buildProject(repoUrl: string) {
    // Clone repository
    await this.$.bash`git clone ${repoUrl} ./project`

    // Install dependencies
    await this.$.bash`cd project && npm install`

    // Run build
    const result = await this.$.bash`cd project && npm run build`

    if (result.exitCode !== 0) {
      throw new Error(`Build failed: ${result.stderr}`)
    }

    // Return artifacts
    return {
      artifacts: await this.$.fs.glob('project/dist/**/*'),
      output: result.stdout
    }
  }
}
```

### Image Processing

```typescript
class ImageProcessor extends withBash(withFs(DO)) {
  async processImage(imageUrl: string) {
    // Fetch and save input
    const response = await fetch(imageUrl)
    await this.$.fs.write('input.jpg', await response.arrayBuffer())

    // Resize with ImageMagick
    await this.$.bash`convert input.jpg -resize 800x600 -quality 85 output.jpg`

    // Create thumbnail
    await this.$.bash`convert input.jpg -thumbnail 150x150^ thumb.jpg`

    return {
      full: await this.$.fs.read('output.jpg'),
      thumb: await this.$.fs.read('thumb.jpg')
    }
  }
}
```

### Python Execution

```typescript
class DataAnalyzer extends withBash(withFs(DO)) {
  async analyze(data: object) {
    // Write input data
    await this.$.fs.write('data.json', JSON.stringify(data))

    // Run Python analysis
    const result = await this.$.bash`python3 analyze.py --input data.json`

    return JSON.parse(result.stdout)
  }
}
```

### FFmpeg Media Processing

```typescript
class MediaProcessor extends withBash(withFs(DO)) {
  async transcodeVideo(videoUrl: string) {
    // Download video
    await this.$.bash`curl -o input.mp4 ${videoUrl}`

    // Transcode to WebM
    await this.$.bash`ffmpeg -i input.mp4 -c:v libvpx-vp9 -crf 30 output.webm`

    // Extract audio
    await this.$.bash`ffmpeg -i input.mp4 -vn -acodec libmp3lame audio.mp3`

    return {
      video: await this.$.fs.read('output.webm'),
      audio: await this.$.fs.read('audio.mp3')
    }
  }
}
```

### CI/CD Pipeline

```typescript
class Pipeline extends withBash(withFs(DO)) {
  async run(options: { lint?: boolean; test?: boolean; build?: boolean }) {
    const results = []

    if (options.lint) {
      const lint = await this.$.bash`npm run lint`
      results.push({ stage: 'lint', success: lint.exitCode === 0 })
    }

    if (options.test) {
      const test = await this.$.bash`npm test`
      results.push({ stage: 'test', success: test.exitCode === 0 })
    }

    if (options.build) {
      const build = await this.$.bash`npm run build`
      results.push({ stage: 'build', success: build.exitCode === 0 })
    }

    return results
  }
}
```

---

## Running the Example

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# In another terminal, try some commands:

# Build a project
curl -X POST http://localhost:8787/build \
  -H 'Content-Type: application/json' \
  -d '{"repo": "https://github.com/user/app"}'

# Process an image
curl -X POST http://localhost:8787/image/process \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/photo.jpg"}'

# Analyze a command for safety
curl -X POST http://localhost:8787/analyze \
  -H 'Content-Type: application/json' \
  -d '{"command": "rm -rf /"}'
# → { "dangerous": true, "reason": "Recursive delete targeting root filesystem" }

# Execute a safe command
curl -X POST http://localhost:8787/exec \
  -H 'Content-Type: application/json' \
  -d '{"command": "ls -la"}'

# Run Python analysis
curl -X POST http://localhost:8787/python/analyze \
  -H 'Content-Type: application/json' \
  -d '{"values": [1, 2, 3, 4, 5]}'
```

---

## API Reference

### Template Literal Syntax

```typescript
// Basic execution
await $.bash`command`

// With interpolation (auto-escaped)
const file = 'my file.txt'
await $.bash`cat ${file}`  // → cat 'my file.txt'

// With options
await $.bash.exec('rm', ['-rf', 'node_modules'], { confirm: true })
```

### Safety Analysis

```typescript
// Analyze without executing
const analysis = $.bash.analyze('rm -rf /')
// {
//   classification: { type: 'delete', impact: 'critical', reversible: false },
//   intent: { commands: ['rm'], deletes: ['/'], ... }
// }

// Check if dangerous
const check = $.bash.isDangerous('rm -rf /')
// { dangerous: true, reason: 'Recursive delete targeting root filesystem' }
```

### Result Type

```typescript
interface BashResult {
  stdout: string           // Command output
  stderr: string           // Error output
  exitCode: number         // Exit code

  intent: {                // Extracted intent
    commands: string[]     // Commands in pipeline
    reads: string[]        // Files read
    writes: string[]       // Files written
    deletes: string[]      // Files deleted
    network: boolean       // Uses network
    elevated: boolean      // Requires sudo
  }

  classification: {        // Safety classification
    type: 'read' | 'write' | 'delete' | 'execute' | 'network' | 'system'
    impact: 'none' | 'low' | 'medium' | 'high' | 'critical'
    reversible: boolean
    reason: string
  }

  blocked?: boolean        // Was execution blocked?
  blockReason?: string     // Why it was blocked
}
```

---

## Comparison

| Feature | Traditional VMs | bashx |
|---------|----------------|-------|
| Cold start | 10-30s | 0ms |
| Cost per execution | ~$0.001 | ~$0.00001 |
| Global latency | 100-500ms | <50ms |
| Safety analysis | None | AST-based |
| Dangerous command blocking | Manual | Automatic |
| Scaling | Manual | Automatic |

---

## Deploy

```bash
npm run deploy
```

Your shell scripts now run globally on Cloudflare's edge network.

---

Built with [dotdo](https://dotdo.dev) | Powered by [bashx.do](https://bashx.do)
