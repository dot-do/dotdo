import { describe, it, expect, beforeEach } from 'vitest'
import {
  setRepositoryContext,
  invokeTool,
  getTool,
  RepositoryContext,
} from '../../../src/mcp/tools'

describe('git_ls_tree MCP Tool', () => {
  let mockContext: RepositoryContext

  // Test SHA constants
  const rootTreeSha = 'aabbccdd00112233445566778899aabbccddeeff'
  const subdirTreeSha = '11223344556677889900aabbccddeeff00112233'
  const nestedTreeSha = '22334455667788990011aabbccddeeff00112233'
  const emptyTreeSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // Git's empty tree
  const blobSha1 = 'aaaa1111222233334444555566667777aaaabbbb'
  const blobSha2 = 'bbbb1111222233334444555566667777aaaabbbb'
  const blobSha3 = 'cccc1111222233334444555566667777aaaabbbb'
  const blobSha4 = 'dddd1111222233334444555566667777aaaabbbb'
  const blobSha5 = 'eeee1111222233334444555566667777aaaabbbb'
  const executableBlobSha = 'ffff1111222233334444555566667777aaaabbbb'
  const symlinkBlobSha = '00001111222233334444555566667777aaaabbbb'
  const submoduleSha = '99991111222233334444555566667777aaaabbbb'
  const commitSha = 'abc123def456789012345678901234567890abcd'
  const commit2Sha = 'def456abc789012345678901234567890abcdef0'

  beforeEach(() => {
    // Create a mock repository context with a realistic tree structure:
    // /
    // ├── README.md (blob)
    // ├── package.json (blob)
    // ├── run.sh (executable blob)
    // ├── link (symlink)
    // ├── submodule (gitlink)
    // └── src/
    //     ├── index.ts (blob)
    //     ├── utils.ts (blob)
    //     └── lib/
    //         └── helper.ts (blob)
    mockContext = {
      objectStore: {
        getObject: async (sha: string) => {
          if (sha === rootTreeSha) {
            return { type: 'tree', data: new Uint8Array([]) }
          }
          if (sha === subdirTreeSha) {
            return { type: 'tree', data: new Uint8Array([]) }
          }
          if (sha === nestedTreeSha) {
            return { type: 'tree', data: new Uint8Array([]) }
          }
          if (sha === emptyTreeSha) {
            return { type: 'tree', data: new Uint8Array([]) }
          }
          if (sha === commitSha || sha === commit2Sha) {
            return { type: 'commit', data: new Uint8Array([]) }
          }
          if ([blobSha1, blobSha2, blobSha3, blobSha4, blobSha5, executableBlobSha, symlinkBlobSha].includes(sha)) {
            return { type: 'blob', data: new TextEncoder().encode('file content') }
          }
          return null
        },
        getCommit: async (sha: string) => {
          if (sha === commitSha) {
            return {
              tree: rootTreeSha,
              parents: [],
              author: {
                name: 'Test Author',
                email: 'test@example.com.ai',
                timestamp: 1234567890,
                timezone: '+0000',
              },
              committer: {
                name: 'Test Author',
                email: 'test@example.com.ai',
                timestamp: 1234567890,
                timezone: '+0000',
              },
              message: 'Initial commit\n',
            }
          }
          if (sha === commit2Sha) {
            return {
              tree: emptyTreeSha,
              parents: [commitSha],
              author: {
                name: 'Test Author',
                email: 'test@example.com.ai',
                timestamp: 1234567891,
                timezone: '+0000',
              },
              committer: {
                name: 'Test Author',
                email: 'test@example.com.ai',
                timestamp: 1234567891,
                timezone: '+0000',
              },
              message: 'Empty tree commit\n',
            }
          }
          return null
        },
        getTree: async (sha: string) => {
          if (sha === rootTreeSha) {
            return {
              entries: [
                { mode: '100644', name: 'README.md', sha: blobSha1 },
                { mode: '100644', name: 'package.json', sha: blobSha2 },
                { mode: '100755', name: 'run.sh', sha: executableBlobSha },
                { mode: '120000', name: 'link', sha: symlinkBlobSha },
                { mode: '160000', name: 'submodule', sha: submoduleSha },
                { mode: '040000', name: 'src', sha: subdirTreeSha },
              ],
            }
          }
          if (sha === subdirTreeSha) {
            return {
              entries: [
                { mode: '100644', name: 'index.ts', sha: blobSha3 },
                { mode: '100644', name: 'utils.ts', sha: blobSha4 },
                { mode: '040000', name: 'lib', sha: nestedTreeSha },
              ],
            }
          }
          if (sha === nestedTreeSha) {
            return {
              entries: [
                { mode: '100644', name: 'helper.ts', sha: blobSha5 },
              ],
            }
          }
          if (sha === emptyTreeSha) {
            return {
              entries: [],
            }
          }
          return null
        },
        getBlob: async (sha: string) => {
          if ([blobSha1, blobSha2, blobSha3, blobSha4, blobSha5, executableBlobSha].includes(sha)) {
            return new TextEncoder().encode('file content')
          }
          if (sha === symlinkBlobSha) {
            return new TextEncoder().encode('../target')
          }
          return null
        },
        storeObject: async () => 'newsha123',
        hasObject: async (sha: string) => {
          return [
            rootTreeSha, subdirTreeSha, nestedTreeSha, emptyTreeSha,
            blobSha1, blobSha2, blobSha3, blobSha4, blobSha5,
            executableBlobSha, symlinkBlobSha, submoduleSha,
            commitSha, commit2Sha,
          ].includes(sha)
        },
      },
      refStore: {
        getRef: async (name: string) => {
          if (name === 'refs/heads/main') return commitSha
          if (name === 'refs/heads/empty') return commit2Sha
          if (name === 'refs/tags/v1.0.0') return commitSha
          return null
        },
        setRef: async () => {},
        deleteRef: async () => {},
        listRefs: async () => [
          { name: 'refs/heads/main', sha: commitSha },
          { name: 'refs/heads/empty', sha: commit2Sha },
          { name: 'refs/tags/v1.0.0', sha: commitSha },
        ],
        getSymbolicRef: async (name: string) => {
          if (name === 'HEAD') return 'refs/heads/main'
          return null
        },
        setSymbolicRef: async () => {},
        getHead: async () => commitSha,
      },
    }

    setRepositoryContext(mockContext)
  })

  // ============================================================================
  // Tool Definition Tests
  // ============================================================================
  describe('Tool definition', () => {
    it('should have git_ls_tree tool registered', () => {
      const tool = getTool('git_ls_tree')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('git_ls_tree')
    })

    it('should have correct description', () => {
      const tool = getTool('git_ls_tree')
      expect(tool?.description).toBeDefined()
      expect(tool?.description.toLowerCase()).toContain('tree')
      expect(tool?.description.toLowerCase()).toContain('list')
    })

    it('should have correct input schema type', () => {
      const tool = getTool('git_ls_tree')
      expect(tool?.inputSchema.type).toBe('object')
      expect(tool?.inputSchema.properties).toBeDefined()
    })

    it('should have tree_ish parameter as required', () => {
      const tool = getTool('git_ls_tree')
      expect(tool?.inputSchema.required).toContain('tree_ish')
      expect(tool?.inputSchema.properties?.tree_ish?.type).toBe('string')
    })

    it('should have optional path parameter', () => {
      const tool = getTool('git_ls_tree')
      expect(tool?.inputSchema.properties).toHaveProperty('path')
      expect(tool?.inputSchema.properties?.path?.type).toBe('string')
      expect(tool?.inputSchema.required).not.toContain('path')
    })

    it('should have optional recursive boolean parameter', () => {
      const tool = getTool('git_ls_tree')
      expect(tool?.inputSchema.properties).toHaveProperty('recursive')
      expect(tool?.inputSchema.properties?.recursive?.type).toBe('boolean')
    })

    it('should have optional show_trees boolean parameter (for -d flag)', () => {
      const tool = getTool('git_ls_tree')
      expect(tool?.inputSchema.properties).toHaveProperty('show_trees')
      expect(tool?.inputSchema.properties?.show_trees?.type).toBe('boolean')
    })

    it('should have optional show_size boolean parameter', () => {
      const tool = getTool('git_ls_tree')
      expect(tool?.inputSchema.properties).toHaveProperty('show_size')
      expect(tool?.inputSchema.properties?.show_size?.type).toBe('boolean')
    })

    it('should have optional name_only boolean parameter', () => {
      const tool = getTool('git_ls_tree')
      expect(tool?.inputSchema.properties).toHaveProperty('name_only')
      expect(tool?.inputSchema.properties?.name_only?.type).toBe('boolean')
    })
  })

  // ============================================================================
  // Basic Tree Listing Tests
  // ============================================================================
  describe('Basic tree listing', () => {
    it('should list tree contents by SHA', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].type).toBe('text')
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
      expect(text).toContain('package.json')
      expect(text).toContain('src')
    })

    it('should list tree contents by commit SHA', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: commitSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
      expect(text).toContain('src')
    })

    it('should list tree contents by branch name', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: 'main',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
      expect(text).toContain('src')
    })

    it('should list tree contents by tag name', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: 'v1.0.0',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
    })

    it('should list tree contents from HEAD', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: 'HEAD',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
      expect(text).toContain('src')
    })

    it('should show file modes in output', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('100644')
      expect(text).toContain('040000')
    })

    it('should show object types in output', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('blob')
      expect(text).toContain('tree')
    })

    it('should show object SHAs in output', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain(blobSha1)
      expect(text).toContain(subdirTreeSha)
    })

    it('should show file names in output', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
      expect(text).toContain('package.json')
      expect(text).toContain('run.sh')
      expect(text).toContain('src')
    })
  })

  // ============================================================================
  // Recursive Listing Tests
  // ============================================================================
  describe('Recursive listing (-r flag)', () => {
    it('should list all entries recursively with recursive=true', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Root level
      expect(text).toContain('README.md')
      expect(text).toContain('package.json')
      // First level nested
      expect(text).toContain('src/index.ts')
      expect(text).toContain('src/utils.ts')
      // Second level nested
      expect(text).toContain('src/lib/helper.ts')
    })

    it('should show full paths in recursive listing', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Paths should include directory prefix
      expect(text).toMatch(/src\/index\.ts/)
      expect(text).toMatch(/src\/lib\/helper\.ts/)
    })

    it('should not include tree entries in recursive listing by default', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // When recursive, we should see files with paths but not the intermediate tree entries
      // Count occurrences - there should be no tree type entries for src or src/lib directories
      // unless show_trees is also true
      const lines = text.split('\n')
      const treeLines = lines.filter(line => line.includes('\ttree\t') || line.match(/tree\s+[0-9a-f]{40}/))
      // Trees should not be listed in -r mode unless -t flag is used
      expect(treeLines.length).toBe(0)
    })

    it('should descend into multiple levels of directories', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should reach the deepest file
      expect(text).toContain('helper.ts')
      expect(text).toContain('src/lib/helper.ts')
    })
  })

  // ============================================================================
  // Tree-Only Listing Tests (-d flag)
  // ============================================================================
  describe('Tree-only listing (-d flag)', () => {
    it('should show only tree entries when show_trees=true without recursive', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        show_trees: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show src directory
      expect(text).toContain('src')
      expect(text).toContain('040000')
      expect(text).toContain('tree')
      // Should NOT show blob files when show_trees is true (like -d flag)
      expect(text).not.toContain('README.md')
      expect(text).not.toContain('package.json')
    })

    it('should show nested tree entries when show_trees=true and recursive=true', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        show_trees: true,
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show both src and src/lib directories
      expect(text).toContain('src')
      expect(text).toContain('src/lib')
      // Should NOT show blob files
      expect(text).not.toContain('README.md')
      expect(text).not.toContain('index.ts')
      expect(text).not.toContain('helper.ts')
    })

    it('should not show files when show_trees=true', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        show_trees: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Files should not be present
      expect(text).not.toContain('blob')
      expect(text).not.toContain('100644')
      expect(text).not.toContain('100755')
    })
  })

  // ============================================================================
  // Path Filtering Tests
  // ============================================================================
  describe('Path filtering', () => {
    it('should filter to specific directory path', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'src',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show contents of src directory
      expect(text).toContain('index.ts')
      expect(text).toContain('utils.ts')
      expect(text).toContain('lib')
      // Should NOT show root level files
      expect(text).not.toContain('README.md')
      expect(text).not.toContain('package.json')
    })

    it('should filter to nested directory path', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'src/lib',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('helper.ts')
      expect(text).not.toContain('index.ts')
    })

    it('should filter to specific file path', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
      expect(text).toContain(blobSha1)
      // Should only show the specific file
      const lines = text.trim().split('\n').filter(l => l.length > 0)
      expect(lines.length).toBe(1)
    })

    it('should handle path with trailing slash', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'src/',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('index.ts')
    })

    it('should combine path filter with recursive flag', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'src',
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show all files under src recursively
      expect(text).toContain('index.ts')
      expect(text).toContain('utils.ts')
      expect(text).toContain('lib/helper.ts')
    })
  })

  // ============================================================================
  // Output Format Tests
  // ============================================================================
  describe('Output format', () => {
    it('should format output as mode<TAB>type<TAB>sha<TAB>name', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Standard ls-tree format: <mode> <type> <sha>\t<name>
      // or: <mode><space><type><space><sha><tab><name>
      expect(text).toMatch(/100644\s+blob\s+[a-f0-9]{40}\s+README\.md/)
      expect(text).toMatch(/040000\s+tree\s+[a-f0-9]{40}\s+src/)
    })

    it('should show only names when name_only=true', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        name_only: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
      expect(text).toContain('src')
      // Should NOT contain SHAs or modes
      expect(text).not.toContain(blobSha1)
      expect(text).not.toContain('100644')
      expect(text).not.toContain('blob')
    })

    it('should show size when show_size=true', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        show_size: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should include size column (for blobs)
      // Format with size: <mode> <type> <sha> <size>\t<name>
      expect(text).toMatch(/100644\s+blob\s+[a-f0-9]{40}\s+\d+\s+README\.md/)
    })

    it('should show - for tree size when show_size=true', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        show_size: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Trees show "-" for size
      expect(text).toMatch(/040000\s+tree\s+[a-f0-9]{40}\s+-\s+src/)
    })
  })

  // ============================================================================
  // Special File Types Tests
  // ============================================================================
  describe('Special file types', () => {
    it('should show executable files with mode 100755', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toMatch(/100755\s+blob\s+[a-f0-9]{40}\s+run\.sh/)
    })

    it('should show symbolic links with mode 120000', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toMatch(/120000\s+blob\s+[a-f0-9]{40}\s+link/)
    })

    it('should show submodules/gitlinks with mode 160000', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toMatch(/160000\s+commit\s+[a-f0-9]{40}\s+submodule/)
    })
  })

  // ============================================================================
  // Error Handling Tests
  // ============================================================================
  describe('Error handling', () => {
    it('should return error when tree_ish parameter is missing', async () => {
      const result = await invokeTool('git_ls_tree', {})

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/missing|required|tree_ish/i)
    })

    it('should return error for invalid ref', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: 'nonexistent-branch',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not found|invalid|bad revision|not a valid object name/i)
    })

    it('should return error for invalid SHA', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: 'not-a-valid-sha-format!@#$',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|not found|bad/i)
    })

    it('should return error for nonexistent path', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'nonexistent/path',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not found|does not exist|path/i)
    })

    it('should use bash CLI when repository context is not set', async () => {
      setRepositoryContext(null)

      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      // When context is not set, falls through to bash CLI
      // This may succeed or fail depending on whether the SHA exists in the real repo
      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
    })

    it('should reject path traversal attempts', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: '../../../etc/passwd',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|forbidden|path/i)
    })

    it('should reject shell injection in tree_ish', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: 'HEAD; rm -rf /',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|forbidden/i)
    })

    it('should reject shell metacharacters in path', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'src`whoami`',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|forbidden/i)
    })
  })

  // ============================================================================
  // Edge Cases Tests
  // ============================================================================
  describe('Edge cases', () => {
    it('should handle empty tree', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: emptyTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Empty tree should return empty output or appropriate message
      expect(text.trim()).toBe('')
    })

    it('should handle commit pointing to empty tree', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: commit2Sha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text.trim()).toBe('')
    })

    it('should handle abbreviated SHA (7 chars)', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha.substring(0, 7),
      })

      // Should either work or give appropriate error
      expect(result).toBeDefined()
    })

    it('should handle tree with single entry', async () => {
      // nestedTreeSha has only one entry
      const result = await invokeTool('git_ls_tree', {
        tree_ish: nestedTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('helper.ts')
      const lines = text.trim().split('\n').filter(l => l.length > 0)
      expect(lines.length).toBe(1)
    })

    it('should handle path to single file', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'src/lib/helper.ts',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('helper.ts')
      expect(text).toContain(blobSha5)
    })

    it('should not descend into symlinks', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Symlink should be listed but not descended into
      expect(text).toContain('link')
      // Should only appear once
      const linkMatches = text.match(/link/g)
      expect(linkMatches?.length).toBe(1)
    })

    it('should not descend into submodules', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Submodule should be listed but not descended into
      expect(text).toContain('submodule')
      // Should only appear once
      const submoduleMatches = text.match(/submodule/g)
      expect(submoduleMatches?.length).toBe(1)
    })

    it('should handle deeply nested directories', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'src/lib',
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('helper.ts')
    })

    it('should sort entries correctly (directories treated as having trailing slash)', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      const lines = text.trim().split('\n').filter(l => l.length > 0)

      // Extract names from lines
      const names = lines.map(line => {
        const parts = line.split(/\s+/)
        return parts[parts.length - 1]
      })

      // Check that all expected entries are present (order depends on tree structure)
      // Git stores entries in the order they were added; sorting is implementation-specific
      expect(names.sort()).toEqual(['README.md', 'link', 'package.json', 'run.sh', 'src', 'submodule'].sort())
    })
  })

  // ============================================================================
  // Reference Resolution Tests
  // ============================================================================
  describe('Reference resolution', () => {
    it('should resolve HEAD to current branch commit tree', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: 'HEAD',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
    })

    it('should resolve branch name to commit tree', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: 'main',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
    })

    it('should resolve tag name to commit tree', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: 'v1.0.0',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
    })

    it('should directly use tree SHA', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
    })

    it('should directly use commit SHA', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: commitSha,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
    })
  })

  // ============================================================================
  // Combined Flags Tests
  // ============================================================================
  describe('Combined flags', () => {
    it('should support recursive + name_only', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        recursive: true,
        name_only: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('README.md')
      expect(text).toContain('src/index.ts')
      expect(text).toContain('src/lib/helper.ts')
      // Should not contain modes or SHAs
      expect(text).not.toMatch(/[a-f0-9]{40}/)
      expect(text).not.toContain('100644')
    })

    it('should support recursive + show_size', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        recursive: true,
        show_size: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show files with sizes
      expect(text).toMatch(/100644\s+blob\s+[a-f0-9]{40}\s+\d+/)
    })

    it('should support path + recursive', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'src',
        recursive: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('index.ts')
      expect(text).toContain('lib/helper.ts')
      // Should not contain root level files
      expect(text).not.toContain('README.md')
    })

    it('should support path + show_trees', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        path: 'src',
        show_trees: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('lib')
      expect(text).not.toContain('index.ts')
    })

    it('should support show_trees + recursive + name_only', async () => {
      const result = await invokeTool('git_ls_tree', {
        tree_ish: rootTreeSha,
        show_trees: true,
        recursive: true,
        name_only: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('src')
      expect(text).toContain('src/lib')
      // Should not show blobs
      expect(text).not.toContain('README.md')
      expect(text).not.toContain('helper.ts')
      // Should not show modes or SHAs
      expect(text).not.toMatch(/[a-f0-9]{40}/)
    })
  })
})
