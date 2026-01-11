import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  discoverSchemaFiles,
  loadAndMergeSchemas,
  type DiscoveryOptions,
} from '../mdx/discover'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

/**
 * Schema File Discovery Tests
 *
 * TDD tests for discovering DB.mdx schema files in a project.
 *
 * Discovery order (higher priority wins):
 * 1. DB.mdx in project root
 * 2. .do/DB.mdx in project root
 * 3. *.do.mdx files anywhere in the project
 */

// ============================================================================
// Test Fixtures
// ============================================================================

let testDir: string

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-discover-test-'))
})

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
})

function createFile(relativePath: string, content: string): string {
  const fullPath = path.join(testDir, relativePath)
  const dir = path.dirname(fullPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fullPath, content)
  return fullPath
}

// ============================================================================
// Basic Discovery
// ============================================================================

describe('discoverSchemaFiles', () => {
  describe('Root DB.mdx Discovery', () => {
    it('discovers DB.mdx in project root', async () => {
      createFile(
        'DB.mdx',
        `
## User

| Field | Type |
|-------|------|
| name | string |
`
      )

      const files = await discoverSchemaFiles(testDir)

      expect(files).toHaveLength(1)
      expect(files[0]).toBe(path.join(testDir, 'DB.mdx'))
    })

    it('discovers .do/DB.mdx', async () => {
      createFile(
        '.do/DB.mdx',
        `
## User

| Field | Type |
|-------|------|
| name | string |
`
      )

      const files = await discoverSchemaFiles(testDir)

      expect(files).toHaveLength(1)
      expect(files[0]).toBe(path.join(testDir, '.do/DB.mdx'))
    })

    it('discovers both root and .do DB.mdx files', async () => {
      createFile(
        'DB.mdx',
        `
## RootUser

| Field | Type |
|-------|------|
| name | string |
`
      )
      createFile(
        '.do/DB.mdx',
        `
## DoUser

| Field | Type |
|-------|------|
| email | string |
`
      )

      const files = await discoverSchemaFiles(testDir)

      expect(files).toHaveLength(2)
      expect(files).toContain(path.join(testDir, 'DB.mdx'))
      expect(files).toContain(path.join(testDir, '.do/DB.mdx'))
    })
  })

  describe('Per-Entity *.do.mdx Discovery', () => {
    it('discovers *.do.mdx files in any directory', async () => {
      createFile(
        'src/entities/User.do.mdx',
        `
## User

| Field | Type |
|-------|------|
| name | string |
`
      )
      createFile(
        'src/entities/Post.do.mdx',
        `
## Post

| Field | Type |
|-------|------|
| title | string |
`
      )

      const files = await discoverSchemaFiles(testDir)

      expect(files).toHaveLength(2)
      expect(files).toContain(path.join(testDir, 'src/entities/User.do.mdx'))
      expect(files).toContain(path.join(testDir, 'src/entities/Post.do.mdx'))
    })

    it('discovers nested *.do.mdx files', async () => {
      createFile(
        'src/domain/users/User.do.mdx',
        `
## User

| Field | Type |
|-------|------|
| name | string |
`
      )
      createFile(
        'src/domain/posts/comments/Comment.do.mdx',
        `
## Comment

| Field | Type |
|-------|------|
| body | string |
`
      )

      const files = await discoverSchemaFiles(testDir)

      expect(files).toHaveLength(2)
    })

    it('combines root, .do, and entity files', async () => {
      createFile(
        'DB.mdx',
        `
## CoreEntity

| Field | Type |
|-------|------|
| id | string |
`
      )
      createFile(
        '.do/DB.mdx',
        `
## Config

| Field | Type |
|-------|------|
| key | string |
`
      )
      createFile(
        'src/User.do.mdx',
        `
## User

| Field | Type |
|-------|------|
| name | string |
`
      )

      const files = await discoverSchemaFiles(testDir)

      expect(files).toHaveLength(3)
    })
  })

  describe('Exclusion Patterns', () => {
    it('excludes node_modules by default', async () => {
      createFile(
        'node_modules/some-package/Schema.do.mdx',
        `
## NodeModuleEntity

| Field | Type |
|-------|------|
| name | string |
`
      )
      createFile(
        'src/User.do.mdx',
        `
## User

| Field | Type |
|-------|------|
| name | string |
`
      )

      const files = await discoverSchemaFiles(testDir)

      expect(files).toHaveLength(1)
      expect(files[0]).toBe(path.join(testDir, 'src/User.do.mdx'))
    })

    it('excludes .git directory', async () => {
      createFile(
        '.git/hooks/DB.mdx',
        `
## GitEntity

| Field | Type |
|-------|------|
| name | string |
`
      )

      const files = await discoverSchemaFiles(testDir)

      expect(files).toHaveLength(0)
    })

    it('supports custom exclude patterns', async () => {
      createFile(
        'vendor/External.do.mdx',
        `
## External

| Field | Type |
|-------|------|
| name | string |
`
      )
      createFile(
        'src/User.do.mdx',
        `
## User

| Field | Type |
|-------|------|
| name | string |
`
      )

      const options: DiscoveryOptions = {
        exclude: ['vendor/**'],
      }
      const files = await discoverSchemaFiles(testDir, options)

      expect(files).toHaveLength(1)
      expect(files[0]).toBe(path.join(testDir, 'src/User.do.mdx'))
    })
  })

  describe('Empty Directory', () => {
    it('returns empty array when no schema files found', async () => {
      const files = await discoverSchemaFiles(testDir)

      expect(files).toEqual([])
    })

    it('ignores non-mdx files', async () => {
      createFile('schema.json', '{}')
      createFile('DB.md', '# Not MDX')
      createFile('User.do.ts', 'export class User {}')

      const files = await discoverSchemaFiles(testDir)

      expect(files).toEqual([])
    })
  })
})

// ============================================================================
// Schema Merging
// ============================================================================

describe('loadAndMergeSchemas', () => {
  describe('Single File', () => {
    it('loads single DB.mdx file', async () => {
      createFile(
        'DB.mdx',
        `---
title: My Schema
---

## User

| Field | Type |
|-------|------|
| name | string |
`
      )

      const schema = await loadAndMergeSchemas(testDir)

      expect(schema.entities.User).toBeDefined()
      expect(schema.entities.User.fields.name.type).toBe('string')
    })
  })

  describe('Multiple Files Merging', () => {
    it('merges entities from multiple files', async () => {
      createFile(
        'DB.mdx',
        `
## User

| Field | Type |
|-------|------|
| name | string |
`
      )
      createFile(
        'src/Post.do.mdx',
        `
## Post

| Field | Type |
|-------|------|
| title | string |
`
      )

      const schema = await loadAndMergeSchemas(testDir)

      expect(schema.entities.User).toBeDefined()
      expect(schema.entities.Post).toBeDefined()
    })

    it('later files override earlier files for same entity', async () => {
      createFile(
        'DB.mdx',
        `
## User

| Field | Type | Description |
|-------|------|-------------|
| name | string | Original name |
`
      )
      createFile(
        '.do/DB.mdx',
        `
## User

| Field | Type | Description |
|-------|------|-------------|
| name | string | Override name |
| email | string | New field |
`
      )

      const schema = await loadAndMergeSchemas(testDir)

      // Later file (.do/DB.mdx) should override
      expect(schema.entities.User.fields.name.description).toBe('Override name')
      expect(schema.entities.User.fields.email).toBeDefined()
    })

    it('tracks source files in merged schema', async () => {
      createFile(
        'DB.mdx',
        `
## User

| Field | Type |
|-------|------|
| name | string |
`
      )
      createFile(
        'src/Post.do.mdx',
        `
## Post

| Field | Type |
|-------|------|
| title | string |
`
      )

      const schema = await loadAndMergeSchemas(testDir)

      expect(schema.sources).toHaveLength(2)
      expect(schema.sources).toContain(path.join(testDir, 'DB.mdx'))
      expect(schema.sources).toContain(path.join(testDir, 'src/Post.do.mdx'))
    })
  })

  describe('Priority Order', () => {
    it('applies files in correct priority order', async () => {
      // Priority: root DB.mdx < .do/DB.mdx < *.do.mdx files
      createFile(
        'DB.mdx',
        `
## Config

| Field | Type | Description |
|-------|------|-------------|
| setting | string | From root |
`
      )
      createFile(
        '.do/DB.mdx',
        `
## Config

| Field | Type | Description |
|-------|------|-------------|
| setting | string | From .do |
`
      )
      createFile(
        'src/Config.do.mdx',
        `
## Config

| Field | Type | Description |
|-------|------|-------------|
| setting | string | From entity file |
`
      )

      const schema = await loadAndMergeSchemas(testDir)

      // Entity file should have highest priority
      expect(schema.entities.Config.fields.setting.description).toBe(
        'From entity file'
      )
    })
  })

  describe('Empty/No Files', () => {
    it('returns empty schema when no files found', async () => {
      const schema = await loadAndMergeSchemas(testDir)

      expect(schema.entities).toEqual({})
      expect(schema.sources).toEqual([])
    })
  })
})
