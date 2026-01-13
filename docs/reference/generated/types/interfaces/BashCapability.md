[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / BashCapability

# Interface: BashCapability

Defined in: [types/capabilities.ts:758](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L758)

Bash capability interface for workflows that need shell access.

Provides command execution and process spawning functionality.

## Example

```typescript
const runBuild = async ($: WorkflowContext) => {
  if (!hasBash($)) {
    throw new CapabilityError('bash', 'not_available', 'Bash required')
  }

  const result = await $.bash.exec('npm run build', { cwd: '/app' })
  if (result.exitCode !== 0) {
    throw new Error(`Build failed: ${result.stderr}`)
  }
  return result.stdout
}
```

## Extends

- [`CapabilityModule`](CapabilityModule.md)

## Methods

### dispose()?

> `optional` **dispose**(): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L52)

Optional cleanup hook called when the capability is unloaded.
Use for releasing resources, closing connections, etc.

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`CapabilityModule`](CapabilityModule.md).[`dispose`](CapabilityModule.md#dispose)

***

### exec()

> **exec**(`command`, `options?`): `Promise`\<[`ExecResult`](ExecResult.md)\>

Defined in: [types/capabilities.ts:780](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L780)

Execute a shell command and wait for completion.

#### Parameters

##### command

`string`

Command to execute

##### options?

[`ExecOptions`](ExecOptions.md)

Execution options

#### Returns

`Promise`\<[`ExecResult`](ExecResult.md)\>

Result with stdout, stderr, and exit code

#### Example

```typescript
const result = await $.bash.exec('ls -la')
console.log(result.stdout)

const build = await $.bash.exec('npm run build', {
  cwd: '/app',
  timeout: 60000,
  env: { NODE_ENV: 'production' }
})
```

***

### initialize()?

> `optional` **initialize**(): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L46)

Optional initialization hook called when the module is first loaded.
Use for async setup operations.

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`CapabilityModule`](CapabilityModule.md).[`initialize`](CapabilityModule.md#initialize)

***

### run()?

> `optional` **run**(`command`, `options?`): `Promise`\<`string`\>

Defined in: [types/capabilities.ts:813](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L813)

Run a command with automatic error handling.
Throws if the command fails (non-zero exit code).

#### Parameters

##### command

`string`

Command to run

##### options?

[`ExecOptions`](ExecOptions.md)

Execution options

#### Returns

`Promise`\<`string`\>

stdout on success

#### Throws

Error if command fails

#### Example

```typescript
const output = await $.bash.run('git status')
```

***

### spawn()

> **spawn**(`command`, `args?`, `options?`): [`SpawnedProcess`](SpawnedProcess.md)

Defined in: [types/capabilities.ts:797](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L797)

Spawn a child process without waiting for completion.

#### Parameters

##### command

`string`

Command to spawn

##### args?

`string`[]

Arguments to pass to the command

##### options?

[`SpawnOptions`](SpawnOptions.md)

Spawn options

#### Returns

[`SpawnedProcess`](SpawnedProcess.md)

Process handle for interaction

#### Example

```typescript
const proc = await $.bash.spawn('npm', ['run', 'dev'])
// Later...
proc.kill()
```

***

### which()?

> `optional` **which**(`command`): `Promise`\<`boolean`\>

Defined in: [types/capabilities.ts:828](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L828)

Check if a command exists in PATH.

#### Parameters

##### command

`string`

Command name to check

#### Returns

`Promise`\<`boolean`\>

True if command is available

#### Example

```typescript
if (await $.bash.which('docker')) {
  await $.bash.exec('docker build .')
}
```

## Properties

### name

> `readonly` **name**: `"bash"`

Defined in: [types/capabilities.ts:759](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L759)

Unique identifier for this capability module

#### Overrides

[`CapabilityModule`](CapabilityModule.md).[`name`](CapabilityModule.md#name)
