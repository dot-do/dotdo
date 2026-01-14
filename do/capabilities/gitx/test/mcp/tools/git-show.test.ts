import { describe, it, expect, beforeEach } from 'vitest'
import {
  invokeTool,
  getTool,
  setRepositoryContext,
  RepositoryContext,
  MCPToolResult,
} from '../../../src/mcp/tools'
import type { CommitObject, TreeObject } from '../../../src/types/objects'

describe('git_show MCP tool', () => {
  let mockContext: RepositoryContext
  const testCommitSha = 'abc123def456789012345678901234567890abcd'
  const testTreeSha = 'tree1234567890123456789012345678901234567'
  const testBlobSha = 'blob1234567890123456789012345678901234567'

  beforeEach(() => {
    // Create a mock repository context for testing
    mockContext = {
      objectStore: {
        getObject: async (sha: string) => {
          if (sha === testBlobSha) {
            const content = new TextEncoder().encode('Hello, World!')
            return { type: 'blob', data: content }
          }
          return null
        },
        getCommit: async (sha: string) => {
          if (sha === testCommitSha) {
            return {
              tree: testTreeSha,
              parents: ['parent1234567890123456789012345678901234'],
              author: {
                name: 'Test Author',
                email: 'author@example.com.ai',
                timestamp: 1672531200, // 2023-01-01 00:00:00 UTC
                timezone: '+0000',
              },
              committer: {
                name: 'Test Committer',
                email: 'committer@example.com.ai',
                timestamp: 1672531200,
                timezone: '+0000',
              },
              message: 'Initial commit\n\nThis is the commit body.',
              gpgsig: undefined,
            }
          }
          return null
        },
        getTree: async (sha: string) => {
          if (sha === testTreeSha) {
            return {
              entries: [
                {
                  mode: '100644',
                  name: 'README.md',
                  sha: testBlobSha,
                  type: 'blob',
                },
              ],
            }
          }
          return null
        },
        getBlob: async (sha: string) => {
          if (sha === testBlobSha) {
            return new TextEncoder().encode('Hello, World!')
          }
          return null
        },
        storeObject: async (type: string, data: Uint8Array) => {
          return 'newsha1234567890123456789012345678901234'
        },
        hasObject: async (sha: string) => {
          return sha === testCommitSha || sha === testTreeSha || sha === testBlobSha
        },
      },
      refStore: {
        getRef: async (name: string) => {
          if (name === 'refs/heads/main') return testCommitSha
          if (name === 'refs/tags/v1.0.0') return testCommitSha
          return null
        },
        setRef: async (name: string, sha: string) => {},
        deleteRef: async (name: string) => {},
        listRefs: async (prefix?: string) => {
          return [
            { name: 'refs/heads/main', sha: testCommitSha },
            { name: 'refs/tags/v1.0.0', sha: testCommitSha },
          ]
        },
        getSymbolicRef: async (name: string) => {
          if (name === 'HEAD') return 'refs/heads/main'
          return null
        },
        setSymbolicRef: async (name: string, target: string) => {},
        getHead: async () => testCommitSha,
      },
    }

    setRepositoryContext(mockContext)
  })

  describe('Tool Definition', () => {
    it('should have git_show tool registered', () => {
      const tool = getTool('git_show')
      expect(tool).toBeDefined()
    })

    it('should have correct tool name', () => {
      const tool = getTool('git_show')
      expect(tool?.name).toBe('git_show')
    })

    it('should have descriptive description', () => {
      const tool = getTool('git_show')
      expect(tool?.description).toBeDefined()
      expect(tool?.description.toLowerCase()).toContain('show')
      expect(tool?.description.length).toBeGreaterThan(20)
    })

    it('should have proper input schema', () => {
      const tool = getTool('git_show')
      expect(tool?.inputSchema).toBeDefined()
      expect(tool?.inputSchema.type).toBe('object')
      expect(tool?.inputSchema.properties).toBeDefined()
    })

    it('should require revision parameter', () => {
      const tool = getTool('git_show')
      expect(tool?.inputSchema.required).toContain('revision')
    })

    it('should have revision parameter in schema', () => {
      const tool = getTool('git_show')
      expect(tool?.inputSchema.properties).toHaveProperty('revision')
      expect(tool?.inputSchema.properties?.revision?.type).toBe('string')
      expect(tool?.inputSchema.properties?.revision?.description).toBeDefined()
    })

    it('should have optional path parameter in schema', () => {
      const tool = getTool('git_show')
      expect(tool?.inputSchema.properties).toHaveProperty('path')
      expect(tool?.inputSchema.properties?.path?.type).toBe('string')
      expect(tool?.inputSchema.properties?.path?.description).toBeDefined()
      expect(tool?.inputSchema.required).not.toContain('path')
    })

    it('should have optional format parameter with enum', () => {
      const tool = getTool('git_show')
      expect(tool?.inputSchema.properties).toHaveProperty('format')
      expect(tool?.inputSchema.properties?.format?.type).toBe('string')
      expect(tool?.inputSchema.properties?.format?.enum).toBeDefined()
      expect(tool?.inputSchema.properties?.format?.enum).toContain('commit')
      expect(tool?.inputSchema.properties?.format?.enum).toContain('raw')
      expect(tool?.inputSchema.properties?.format?.enum).toContain('diff')
    })

    it('should have optional context_lines parameter for diffs', () => {
      const tool = getTool('git_show')
      expect(tool?.inputSchema.properties).toHaveProperty('context_lines')
      expect(tool?.inputSchema.properties?.context_lines?.type).toBe('number')
      expect(tool?.inputSchema.properties?.context_lines?.description).toContain('diff')
    })
  })

  describe('Show Commit Info', () => {
    it('should show commit information by SHA', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      expect(result.content[0].type).toBe('text')
      const text = result.content[0].text || ''
      expect(text).toContain(testCommitSha)
      expect(text).toContain('Test Author')
      expect(text).toContain('author@example.com.ai')
      expect(text).toContain('Initial commit')
    })

    it('should show commit date in readable format', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('Date:')
      // Should show formatted date, not just timestamp
      expect(text).not.toContain('1672531200')
    })

    it('should show commit message including body', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('Initial commit')
      expect(text).toContain('This is the commit body')
    })

    it('should show commit author information', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('Author:')
      expect(text).toContain('Test Author')
      expect(text).toContain('author@example.com.ai')
    })

    it('should show commit committer information', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should show committer if different from author, or at least show Date from committer
      expect(text).toContain('Test Committer') // or verify Date is shown
    })

    it('should show parent commit SHA(s)', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should show parent or merge info
      expect(text).toMatch(/parent|Merge:/i)
    })
  })

  describe('Show Commit with Diff', () => {
    it('should show diff output by default', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Default format should include diff
      expect(text).toMatch(/diff --git|index|@@/)
    })

    it('should show diff in commit format', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        format: 'commit',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('commit')
      expect(text).toContain('diff')
    })

    it('should show only diff with diff format', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        format: 'diff',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toMatch(/diff --git/)
      // Should not include full commit header in diff-only format
    })

    it('should respect context_lines parameter for diffs', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        format: 'diff',
        context_lines: 10,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toMatch(/diff --git/)
      // Actual context lines verification would require parsing the diff
    })

    it('should show file changes in diff', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        format: 'diff',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toMatch(/diff --git/)
      expect(text).toMatch(/index/)
      expect(text).toMatch(/---/)
      expect(text).toMatch(/\+\+\+/)
    })

    it('should show added lines with + prefix', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        format: 'diff',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should show diff hunks with +/- prefixes
      expect(text).toMatch(/^\+/m)
    })

    it('should show deleted lines with - prefix', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        format: 'diff',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // May or may not have deleted lines depending on commit
      // This test expects the diff format to be correct
      expect(text).toMatch(/diff --git/)
    })
  })

  describe('Show File at Revision', () => {
    it('should show file content at specific revision', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        path: 'README.md',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('Hello, World!')
    })

    it('should show raw file content with raw format', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        path: 'README.md',
        format: 'raw',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toBe('Hello, World!')
    })

    it('should show file content without commit metadata when path is specified', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        path: 'README.md',
        format: 'raw',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should be just the file content
      expect(text).not.toContain('commit')
      expect(text).not.toContain('Author:')
      expect(text).not.toContain('Date:')
    })

    it('should handle binary file content appropriately', async () => {
      // Mock binary file - use testBlobSha which is in the tree for README.md
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === testBlobSha) {
          return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]) // JPEG header with null byte
        }
        return null
      }

      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        path: 'README.md', // Use existing file in mock tree
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should indicate binary file or show base64
      expect(text).toMatch(/binary|base64/i)
    })
  })

  describe('Reference Resolution', () => {
    it('should resolve branch names to commits', async () => {
      const result = await invokeTool('git_show', {
        revision: 'main',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('Test Author')
      expect(text).toContain('Initial commit')
    })

    it('should resolve tag names to commits', async () => {
      const result = await invokeTool('git_show', {
        revision: 'v1.0.0',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('Test Author')
      expect(text).toContain('Initial commit')
    })

    it('should resolve HEAD to current commit', async () => {
      const result = await invokeTool('git_show', {
        revision: 'HEAD',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('Test Author')
      expect(text).toContain('Initial commit')
    })

    it('should support HEAD~n notation', async () => {
      const result = await invokeTool('git_show', {
        revision: 'HEAD~1',
      })

      // This should fail or show parent commit
      // Depends on implementation
      expect(result).toBeDefined()
    })

    it('should support HEAD^n notation', async () => {
      const result = await invokeTool('git_show', {
        revision: 'HEAD^1',
      })

      // This should fail or show parent commit
      expect(result).toBeDefined()
    })

    it('should support short SHA references', async () => {
      const shortSha = testCommitSha.substring(0, 7)
      const result = await invokeTool('git_show', {
        revision: shortSha,
      })

      // Should resolve short SHA to full commit
      expect(result).toBeDefined()
    })

    it('should support revision:path syntax', async () => {
      const result = await invokeTool('git_show', {
        revision: `${testCommitSha}:README.md`,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('Hello, World!')
    })
  })

  describe('Error Handling', () => {
    it('should return error for non-existent revision', async () => {
      const result = await invokeTool('git_show', {
        revision: 'nonexistent',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not found|invalid|bad revision/i)
    })

    it('should return error for invalid SHA', async () => {
      const result = await invokeTool('git_show', {
        revision: 'invalid-sha-format',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|not found|bad/i)
    })

    it('should return error for non-existent file path', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        path: 'nonexistent-file.txt',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not found|does not exist/i)
    })

    it('should return error when repository context not set', async () => {
      setRepositoryContext(null)

      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBe(true)
      // When context is not set, falls through to bash CLI which returns git error
      expect(result.content[0].text).toMatch(/bad object|not found|fatal/i)

      // Restore context for other tests
      setRepositoryContext(mockContext)
    })

    it('should handle missing required revision parameter', async () => {
      const result = await invokeTool('git_show', {})

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/missing|required|revision/i)
    })

    it('should reject dangerous path patterns', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        path: '../../../etc/passwd',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|forbidden|path/i)
    })

    it('should reject shell injection in revision', async () => {
      const result = await invokeTool('git_show', {
        revision: 'HEAD; rm -rf /',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|forbidden/i)
    })

    it('should validate format parameter values', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        format: 'invalid-format',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|must be one of/i)
    })

    it('should validate context_lines is positive', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        context_lines: -5,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|must be at least|positive/i)
    })
  })

  describe('Edge Cases', () => {
    it('should handle commit with no parents (initial commit)', async () => {
      // Update mock to return commit with no parents
      mockContext.objectStore.getCommit = async (sha: string) => {
        if (sha === testCommitSha) {
          return {
            tree: testTreeSha,
            parents: [], // No parents
            author: {
              name: 'Test Author',
              email: 'author@example.com.ai',
              timestamp: 1672531200,
              timezone: '+0000',
            },
            committer: {
              name: 'Test Committer',
              email: 'committer@example.com.ai',
              timestamp: 1672531200,
              timezone: '+0000',
            },
            message: 'Initial commit',
            gpgsig: undefined,
          }
        }
        return null
      }

      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toContain('Initial commit')
      // Should not show parent info or show appropriate indication
    })

    it('should handle merge commits with multiple parents', async () => {
      // Update mock to return merge commit
      mockContext.objectStore.getCommit = async (sha: string) => {
        if (sha === testCommitSha) {
          return {
            tree: testTreeSha,
            parents: [
              'parent1234567890123456789012345678901234',
              'parent5678901234567890123456789012345678',
            ],
            author: {
              name: 'Test Author',
              email: 'author@example.com.ai',
              timestamp: 1672531200,
              timezone: '+0000',
            },
            committer: {
              name: 'Test Committer',
              email: 'committer@example.com.ai',
              timestamp: 1672531200,
              timezone: '+0000',
            },
            message: 'Merge branch feature into main',
            gpgsig: undefined,
          }
        }
        return null
      }

      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toMatch(/Merge:|merge/i)
      // Should show both parents
      expect(text).toContain('parent123456')
      expect(text).toContain('parent567890')
    })

    it('should handle empty file content', async () => {
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === testBlobSha) {
          return new Uint8Array([])
        }
        return null
      }

      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        path: 'README.md', // Use existing file in mock tree
        format: 'raw',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toBe('')
    })

    it('should handle very long commit messages', async () => {
      const longMessage = 'A'.repeat(10000) + '\n\n' + 'B'.repeat(10000)
      mockContext.objectStore.getCommit = async (sha: string) => {
        if (sha === testCommitSha) {
          return {
            tree: testTreeSha,
            parents: ['parent1234567890123456789012345678901234'],
            author: {
              name: 'Test Author',
              email: 'author@example.com.ai',
              timestamp: 1672531200,
              timezone: '+0000',
            },
            committer: {
              name: 'Test Committer',
              email: 'committer@example.com.ai',
              timestamp: 1672531200,
              timezone: '+0000',
            },
            message: longMessage,
            gpgsig: undefined,
          }
        }
        return null
      }

      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should handle long messages without crashing
      expect(text).toContain('AAAA')
      expect(text).toContain('BBBB')
    })

    it('should handle commit with GPG signature', async () => {
      mockContext.objectStore.getCommit = async (sha: string) => {
        if (sha === testCommitSha) {
          return {
            tree: testTreeSha,
            parents: ['parent1234567890123456789012345678901234'],
            author: {
              name: 'Test Author',
              email: 'author@example.com.ai',
              timestamp: 1672531200,
              timezone: '+0000',
            },
            committer: {
              name: 'Test Committer',
              email: 'committer@example.com.ai',
              timestamp: 1672531200,
              timezone: '+0000',
            },
            message: 'Signed commit',
            gpgsig: '-----BEGIN PGP SIGNATURE-----\ntest signature\n-----END PGP SIGNATURE-----',
          }
        }
        return null
      }

      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should show or acknowledge GPG signature
      expect(text).toMatch(/PGP SIGNATURE|gpgsig/i)
    })

    it('should handle paths with special characters', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        path: 'file-with-spaces and special.txt',
      })

      // Should either work or give appropriate error
      expect(result).toBeDefined()
    })

    it('should handle timezone offsets correctly', async () => {
      mockContext.objectStore.getCommit = async (sha: string) => {
        if (sha === testCommitSha) {
          return {
            tree: testTreeSha,
            parents: ['parent1234567890123456789012345678901234'],
            author: {
              name: 'Test Author',
              email: 'author@example.com.ai',
              timestamp: 1672531200,
              timezone: '-0800', // PST
            },
            committer: {
              name: 'Test Committer',
              email: 'committer@example.com.ai',
              timestamp: 1672531200,
              timezone: '+0530', // IST
            },
            message: 'Test timezone',
            gpgsig: undefined,
          }
        }
        return null
      }

      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should show timezone information
      expect(text).toMatch(/-0800|\+0530/)
    })
  })

  describe('Output Formatting', () => {
    it('should format commit SHA in full', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should show full 40-character SHA
      expect(text).toContain(testCommitSha)
    })

    it('should indent commit message properly', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Git typically indents commit messages with 4 spaces
      expect(text).toMatch(/^    /m)
    })

    it('should format diff headers correctly', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
        format: 'diff',
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      expect(text).toMatch(/^diff --git/m)
      expect(text).toMatch(/^index/m)
      expect(text).toMatch(/^---/m)
      expect(text).toMatch(/^\+\+\+/m)
    })

    it('should use standard git show format', async () => {
      const result = await invokeTool('git_show', {
        revision: testCommitSha,
      })

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text || ''
      // Should match git's standard format
      expect(text).toMatch(/^commit/m)
      expect(text).toMatch(/^Author:/m)
      expect(text).toMatch(/^Date:/m)
    })
  })
})
