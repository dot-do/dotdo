# primitive-multi-tools

**Git + Shell + Files. One isolate. Zero infrastructure.**

Complete DevOps environment inside a Durable Object. Clone repos, modify files, run builds, commit changes, and deploy - all in a single V8 isolate.

## Clone. Build. Deploy. 3 seconds. $0.001.

```typescript
import { DOWithPrimitives } from 'dotdo/presets'

export class DevOpsDO extends DOWithPrimitives {
  async deployWithHotfix(issueId: string, fix: string) {
    // 1. Sync from remote
    await this.$.git.sync()

    // 2. Find and fix the file
    const file = await this.findFileForIssue(issueId)
    const content = await this.$.fs.read(file)
    await this.$.fs.write(file, applyFix(content, fix))

    // 3. Build and test
    await this.$.bash`npm install`
    const test = await this.$.bash`npm test`
    if (test.exitCode !== 0) throw new Error('Tests failed')

    // 4. Commit and push
    await this.$.git.add('.')
    await this.$.git.commit(`fix(${issueId}): ${fix}`)
    await this.$.git.push()

    // 5. Deploy
    await this.$.bash`npm run deploy:production`

    return { deployed: true, commit: this.$.git.binding.commit }
  }
}
```

## Extended Primitives

| Primitive | Purpose | Storage |
|-----------|---------|---------|
| `$.fs` | Filesystem operations | SQLite + R2 tiering |
| `$.git` | Version control | R2 object storage |
| `$.bash` | Shell execution | Safe sandbox |
| `$.npm` | Package management | Registry resolution |

## How It Works

### Filesystem ($.fs)

SQLite-backed virtual filesystem with R2 tiering for large files:

```typescript
await $.fs.write('/src/index.ts', code)
await $.fs.mkdir('/dist', { recursive: true })
const content = await $.fs.read('/package.json')
const files = await $.fs.list('/src')
```

### Git ($.git)

Full git implementation with R2 global object storage:

```typescript
$.git.configure({ repo: 'org/app', branch: 'main', r2: env.R2_BUCKET })
await $.git.init()
await $.git.sync()           // Pull from remote
await $.git.add('.')
await $.git.commit('feat: new feature')
await $.git.push()
```

### Shell ($.bash)

Safe shell execution with command analysis:

```typescript
// Tagged template syntax
const result = await $.bash`npm install`
const output = await $.bash`echo ${userInput}`  // Auto-escaped

// Method syntax
await $.bash.exec('npm', ['run', 'build'])
await $.bash.run('npm install && npm test')

// Safety analysis
const { dangerous, reason } = $.bash.isDangerous('rm -rf /')
```

### Package Manager ($.npm)

npm operations built on $.fs and $.bash:

```typescript
await $.npm.install(['typescript', 'esbuild'])
await $.npm.run('build')
await $.npm.update()
```

## Real-World Patterns

### Blue-Green Deployment

Zero-downtime deployments with instant rollback:

```typescript
async deployBlueGreen() {
  const activeSlot = this.getActiveSlot()  // 'blue' or 'green'
  const targetSlot = activeSlot === 'blue' ? 'green' : 'blue'

  // Build and deploy to inactive slot
  await $.git.sync()
  await $.bash`npm ci && npm run build`
  await $.bash`npm run deploy:${targetSlot}`

  // Health check
  await $.bash`npm run health:${targetSlot}`

  // Switch traffic
  this.activateSlot(targetSlot)

  return { deployed: true, slot: targetSlot }
}

async rollback() {
  const currentSlot = this.getActiveSlot()
  const previousSlot = currentSlot === 'blue' ? 'green' : 'blue'
  this.activateSlot(previousSlot)  // Instant!
}
```

### Scheduled Dependency Updates

Automated PRs for dependency updates:

```typescript
// Runs daily at 3am
$.every.day.at('3am')(async () => {
  await $.git.checkout('deps-update', { create: true })
  await $.bash`npm update`

  // Run tests
  const result = await $.bash`npm test`
  if (result.exitCode !== 0) return

  await $.git.add('package*.json')
  await $.git.commit('chore: update dependencies')
  await $.git.push()

  await this.createPR({
    title: 'Update dependencies',
    base: 'main'
  })
})
```

### CI Pipeline

Complete build pipeline with artifacts:

```typescript
async build() {
  await $.bash`npm ci`
  await $.bash`npm run lint`
  await $.bash`npm run typecheck`
  await $.bash`npm run build`

  const artifacts = await $.fs.list('/dist')
  return { success: true, artifacts }
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/initialize` | POST | Initialize with repo configuration |
| `/api/hotfix` | POST | Deploy a hotfix (find, fix, test, commit, deploy) |
| `/api/deploy` | POST | Blue-green deployment |
| `/api/rollback` | POST | Rollback to previous slot |
| `/api/build` | POST | Run build pipeline |
| `/api/update-deps` | POST | Update dependencies and create PR |
| `/api/status` | GET | Git status, slots, audit log |

## Running

```bash
# Install dependencies
npm install

# Development
npm run dev

# Deploy
npm run deploy

# View logs
npm run tail
```

## Configuration

Set secrets for production:

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put NPM_TOKEN
wrangler secret put DEPLOY_KEY
```

## Why This Architecture?

Traditional CI/CD requires:
- VMs or containers (cold starts, resource overhead)
- Complex orchestration (Kubernetes, ECS)
- Separate services (GitHub Actions, Jenkins, CircleCI)
- Network hops between components

With dotdo primitives:
- **Single V8 isolate** - No VMs, no containers
- **Zero cold starts** - Instant execution
- **Edge deployment** - 300+ cities worldwide
- **Persistent state** - SQLite + R2 storage
- **Sub-millisecond latency** - Everything in-process

The entire DevOps pipeline runs in the same isolate that serves your API.

## License

MIT
