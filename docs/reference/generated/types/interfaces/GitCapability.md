[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / GitCapability

# Interface: GitCapability

Defined in: [types/capabilities.ts:454](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L454)

Git capability interface for workflows that need version control.

Provides git operations for managing repositories, commits, and branches.

## Example

```typescript
const commitChanges = async ($: WorkflowContext) => {
  if (!hasGit($)) {
    throw new CapabilityError('git', 'not_available', 'Git required')
  }

  const status = await $.git.status()
  if (status.unstaged.length > 0) {
    await $.git.add(status.unstaged)
    await $.git.commit('Auto-commit changes')
  }
}
```

## Extends

- [`CapabilityModule`](CapabilityModule.md)

## Methods

### add()

> **add**(`files`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:483](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L483)

Stage files for commit.

#### Parameters

##### files

File path or array of file paths to stage

`string` | `string`[]

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await $.git.add('src/index.ts')
await $.git.add(['src/a.ts', 'src/b.ts'])
await $.git.add('.') // Stage all changes
```

***

### branch()?

> `optional` **branch**(`name`, `startPoint?`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:597](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L597)

Create a new branch.

#### Parameters

##### name

`string`

Branch name

##### startPoint?

`string`

Starting reference (default: HEAD)

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await $.git.branch('feature/new-feature')
await $.git.branch('hotfix/fix-bug', 'v1.0.0')
```

***

### checkout()?

> `optional` **checkout**(`ref`, `options?`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:583](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L583)

Checkout a branch, tag, or commit.

#### Parameters

##### ref

`string`

Branch name, tag, or commit hash

##### options?

Checkout options

###### create?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await $.git.checkout('feature-branch')
await $.git.checkout('v1.0.0')
```

***

### clone()?

> `optional` **clone**(`url`, `dest`, `options?`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:569](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L569)

Clone a repository.

#### Parameters

##### url

`string`

Repository URL to clone

##### dest

`string`

Destination directory

##### options?

[`GitCloneOptions`](GitCloneOptions.md)

Clone options

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await $.git.clone('https://github.com/user/repo.git', './repo')
await $.git.clone('git@github.com:user/repo.git', './repo', { depth: 1 })
```

***

### commit()

> **commit**(`message`): `Promise`\<`string` \| \{ `hash`: `string`; \}\>

Defined in: [types/capabilities.ts:496](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L496)

Create a new commit with staged changes.

#### Parameters

##### message

`string`

Commit message

#### Returns

`Promise`\<`string` \| \{ `hash`: `string`; \}\>

Commit hash or commit info object

#### Example

```typescript
const hash = await $.git.commit('feat: add new feature')
```

***

### diff()

> **diff**(`ref?`): `Promise`\<`string`\>

Defined in: [types/capabilities.ts:554](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L554)

Get diff between references or working tree.

#### Parameters

##### ref?

`string`

Reference to diff against (branch, tag, commit, or empty for working tree)

#### Returns

`Promise`\<`string`\>

Unified diff output

#### Example

```typescript
const diff = await $.git.diff('HEAD~1')
const workingDiff = await $.git.diff()
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

### fetch()?

> `optional` **fetch**(`remote?`, `branch?`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:624](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L624)

Fetch changes from remote without merging.

#### Parameters

##### remote?

`string`

Remote name (default: 'origin')

##### branch?

`string`

Specific branch to fetch

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await $.git.fetch()
await $.git.fetch('upstream', 'main')
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

### log()

> **log**(`options?`): `Promise`\<[`GitCommit`](GitCommit.md)[]\>

Defined in: [types/capabilities.ts:540](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L540)

Get commit history.

#### Parameters

##### options?

[`GitLogOptions`](GitLogOptions.md)

Options for filtering and limiting results

#### Returns

`Promise`\<[`GitCommit`](GitCommit.md)[]\>

Array of commit objects

#### Example

```typescript
const commits = await $.git.log({ limit: 5 })
for (const commit of commits) {
  console.log(`${commit.hash.slice(0, 7)} ${commit.message}`)
}
```

***

### merge()?

> `optional` **merge**(`branch`, `options?`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:610](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L610)

Merge a branch into the current branch.

#### Parameters

##### branch

`string`

Branch to merge

##### options?

Merge options

###### noFf?

`boolean`

###### squash?

`boolean`

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await $.git.merge('feature-branch')
```

***

### pull()

> **pull**(`remote?`, `branch?`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:524](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L524)

Pull changes from a remote repository.

#### Parameters

##### remote?

`string`

Remote name (default: 'origin')

##### branch?

`string`

Branch to pull (default: current branch)

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await $.git.pull()
await $.git.pull('upstream', 'main')
```

***

### push()

> **push**(`remote?`, `branch?`): `Promise`\<`void`\>

Defined in: [types/capabilities.ts:510](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L510)

Push commits to a remote repository.

#### Parameters

##### remote?

`string`

Remote name (default: 'origin')

##### branch?

`string`

Branch to push (default: current branch)

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await $.git.push()
await $.git.push('origin', 'main')
```

***

### status()

> **status**(): `Promise`\<[`GitStatus`](GitStatus.md)\>

Defined in: [types/capabilities.ts:469](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L469)

Get the current repository status.

#### Returns

`Promise`\<[`GitStatus`](GitStatus.md)\>

Status object with branch and file information

#### Example

```typescript
const status = await $.git.status()
console.log(`On branch ${status.branch}`)
console.log(`${status.staged.length} files staged`)
```

## Properties

### name

> `readonly` **name**: `"git"`

Defined in: [types/capabilities.ts:455](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L455)

Unique identifier for this capability module

#### Overrides

[`CapabilityModule`](CapabilityModule.md).[`name`](CapabilityModule.md#name)
