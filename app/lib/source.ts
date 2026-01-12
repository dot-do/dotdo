import { loader } from 'fumadocs-core/source'
import type { Source } from 'fumadocs-core/source'
import * as fs from 'node:fs'
import * as path from 'node:path'
import yaml from 'yaml'

// Simple frontmatter parser
function parseFrontmatter(content: string): { data: Record<string, unknown>; content: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    return { data: {}, content }
  }
  try {
    const data = yaml.parse(match[1]) || {}
    return { data, content: match[2] }
  } catch {
    return { data: {}, content }
  }
}

// Define the page data type with body component support
interface DocPageData {
  title: string
  description?: string
  body?: React.FC
}

interface DocMetaData {
  title?: string
  pages?: string[]
}

// Build source from docs/ folder
function buildDocsSource(): Source<{
  pageData: DocPageData
  metaData: DocMetaData
}> {
  const docsDir = path.resolve(__dirname, '../../docs')
  const files: Array<{
    type: 'page' | 'meta'
    path: string
    absolutePath: string
    data: DocPageData | DocMetaData
  }> = []

  // Recursively scan docs directory for MDX files
  function scanDir(dir: string, relativePath: string = '') {
    if (!fs.existsSync(dir)) return

    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        scanDir(fullPath, relPath)
      } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          const { data: frontmatter } = parseFrontmatter(content)

          // Create a stub body component
          const body = (() => null) as React.FC

          files.push({
            type: 'page',
            path: relPath,
            absolutePath: fullPath,
            data: {
              title: frontmatter.title || path.basename(entry.name, path.extname(entry.name)),
              description: frontmatter.description,
              body,
            },
          })
        } catch (e) {
          console.warn(`Failed to parse ${fullPath}:`, e)
        }
      } else if (entry.name === 'meta.json' || entry.name === 'meta.yaml') {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          const data = entry.name.endsWith('.json')
            ? JSON.parse(content)
            : content // TODO: parse YAML

          files.push({
            type: 'meta',
            path: relPath,
            absolutePath: fullPath,
            data,
          })
        } catch (e) {
          console.warn(`Failed to parse ${fullPath}:`, e)
        }
      }
    }
  }

  scanDir(docsDir)

  return { files }
}

const docsSource = buildDocsSource()

export const source = loader({
  baseUrl: '/docs',
  source: docsSource,
})
