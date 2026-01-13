[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / FsCapability

# Interface: FsCapability

Defined in: [types/capabilities.ts:173](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L173)

Filesystem capability interface for workflows that need file access.

Provides a unified API for file operations that can be backed by
different implementations (DurableObjectStorage, fsx.do, etc.).

All paths should be absolute (starting with `/`). Paths are automatically
normalized to handle trailing slashes and ensure consistency.

## Example

```typescript
const processConfig = async ($: WorkflowContext) => {
  if (!hasFs($)) {
    throw new CapabilityError('fs', 'not_available', 'Filesystem required')
  }

  const config = await $.fs.read('/config.json')
  const parsed = JSON.parse(config)
  return parsed
}
```

## Extends

- [`CapabilityModule`](CapabilityModule.md)

## Methods

### copy()

> **copy**(`src`, `dest`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:294](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L294)

Copy a file to a new location.

#### Parameters

##### src

`string`

Source file path

##### dest

`string`

Destination file path

#### Returns

`Promise`\<`void`\>

#### Throws

Error if source doesn't exist

#### Example

```typescript
await $.fs.copy('/app/config.json', '/backup/config.json')
```

***

### delete()

> **delete**(`path`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:249](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L249)

Delete a file or empty directory.

#### Parameters

##### path

`string`

Absolute path to delete

#### Returns

`Promise`\<`void`\>

#### Throws

Error if path doesn't exist

#### Example

```typescript
await $.fs.delete('/app/temp/cache.json')
```

***

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

### exists()

> **exists**(`path`): `Promise`\<`boolean`\>

Defined in: [types/capabilities.ts:236](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L236)

Check if a file or directory exists at the given path.

#### Parameters

##### path

`string`

Path to check

#### Returns

`Promise`\<`boolean`\>

True if path exists, false otherwise

#### Example

```typescript
if (await $.fs.exists('/app/config.json')) {
  // Load config
}
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

### list()

> **list**(`path`, `options?`): `Promise`\<[`FsEntry`](FsEntry.md)[]\>

Defined in: [types/capabilities.ts:221](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L221)

List entries in a directory.

#### Parameters

##### path

`string`

Absolute path to directory

##### options?

[`FsListOptions`](FsListOptions.md)

List options (filter function)

#### Returns

`Promise`\<[`FsEntry`](FsEntry.md)[]\>

Array of directory entries with name and isDirectory flag

#### Example

```typescript
const entries = await $.fs.list('/app/src')
const files = entries.filter(e => !e.isDirectory)
```

***

### mkdir()

> **mkdir**(`path`, `options?`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:263](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L263)

Create a directory at the given path.

#### Parameters

##### path

`string`

Path where directory should be created

##### options?

[`MkdirOptions`](MkdirOptions.md)

Options for directory creation

#### Returns

`Promise`\<`void`\>

#### Throws

Error if parent doesn't exist (unless recursive: true)

#### Example

```typescript
await $.fs.mkdir('/app/data/cache', { recursive: true })
```

***

### move()

> **move**(`src`, `dest`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:311](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L311)

Move a file to a new location.

This is an atomic operation: the source is deleted only after
the destination is successfully written.

#### Parameters

##### src

`string`

Source file path

##### dest

`string`

Destination file path

#### Returns

`Promise`\<`void`\>

#### Throws

Error if source doesn't exist

#### Example

```typescript
await $.fs.move('/tmp/upload.json', '/data/file.json')
```

***

### read()

> **read**(`path`, `options?`): `Promise`\<`string`\>

Defined in: [types/capabilities.ts:189](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L189)

Read file content as a string.

#### Parameters

##### path

`string`

Absolute path to the file

##### options?

[`FsReadOptions`](FsReadOptions.md)

Read options (encoding)

#### Returns

`Promise`\<`string`\>

File content as string

#### Throws

Error if file doesn't exist or cannot be read

#### Example

```typescript
const content = await $.fs.read('/app/config.json')
```

***

### stat()

> **stat**(`path`): `Promise`\<[`FileStats`](FileStats.md)\>

Defined in: [types/capabilities.ts:280](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L280)

Get file or directory metadata.

#### Parameters

##### path

`string`

Absolute path to stat

#### Returns

`Promise`\<[`FileStats`](FileStats.md)\>

File statistics object

#### Throws

Error if path doesn't exist

#### Example

```typescript
const stats = await $.fs.stat('/app/data.json')
if (stats.isFile && stats.size > 0) {
  // Process file
}
```

***

### write()

> **write**(`path`, `content`, `options?`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L206)

Write content to a file, creating it if it doesn't exist.

Parent directories are NOT automatically created. Use `mkdir` with
`recursive: true` first if needed.

#### Parameters

##### path

`string`

Absolute path to the file

##### content

`string`

String content to write

##### options?

[`FsWriteOptions`](FsWriteOptions.md)

Write options (encoding)

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await $.fs.write('/app/output.txt', 'Hello, World!')
```

## Properties

### name

> `readonly` **name**: `"fs"`

Defined in: [types/capabilities.ts:174](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L174)

Unique identifier for this capability module

#### Overrides

[`CapabilityModule`](CapabilityModule.md).[`name`](CapabilityModule.md#name)
