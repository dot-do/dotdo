/**
 * Site.mdx Source Loader
 *
 * Reads and parses Site.mdx from root or .do/ folder for landing page rendering.
 * Extracts MDX content and frontmatter for SEO metadata.
 */

import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface SiteFrontmatter {
  title?: string
  description?: string
  ogImage?: string
}

export interface SiteSource {
  content: string
  frontmatter: SiteFrontmatter
}

/**
 * Get the root directory of the project
 */
function getRootDir(): string {
  // app/lib/site-source.ts -> go up two directories to get to root
  return join(__dirname, '../..')
}

/**
 * Load Site.mdx from .do/ folder or root directory
 * Priority: .do/Site.mdx > Site.mdx
 */
export async function loadSiteMdx(): Promise<SiteSource> {
  const rootDir = getRootDir()
  const dotDoPath = join(rootDir, '.do/Site.mdx')
  const rootPath = join(rootDir, 'Site.mdx')

  let content: string

  if (existsSync(dotDoPath)) {
    content = await readFile(dotDoPath, 'utf-8')
  } else if (existsSync(rootPath)) {
    content = await readFile(rootPath, 'utf-8')
  } else {
    throw new Error('Site.mdx not found in .do/ or root directory')
  }

  const { frontmatter, body } = parseFrontmatter(content)

  return {
    content: body,
    frontmatter,
  }
}

/**
 * Parse YAML frontmatter from MDX content
 */
function parseFrontmatter(content: string): { frontmatter: SiteFrontmatter; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const frontmatterStr = match[1]
  const body = content.slice(match[0].length)

  // Simple YAML parsing for key: value pairs
  const frontmatter: SiteFrontmatter = {}
  const lines = frontmatterStr.split('\n')
  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex !== -1) {
      const key = line.slice(0, colonIndex).trim()
      let value = line.slice(colonIndex + 1).trim()
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key === 'title' || key === 'description' || key === 'ogImage') {
        frontmatter[key] = value
      }
    }
  }

  return { frontmatter, body }
}

/**
 * Convert MDX content to HTML for SSR rendering
 * This is a simplified converter for the test suite.
 */
export function mdxToHtml(mdxContent: string): string {
  let html = mdxContent

  // Convert markdown headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Convert horizontal rules (---) but not frontmatter
  html = html.replace(/^---$/gm, '<hr />')

  // Convert bold text
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // Convert italic text
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Convert links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Convert code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang || ''}">${escapeHtml(code.trim())}</code></pre>`
  })

  // Convert inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Convert tables
  html = convertTables(html)

  // Convert JSX components to HTML (simplified)
  html = convertJsxComponents(html)

  // Convert paragraphs (lines that aren't already HTML)
  html = convertParagraphs(html)

  return html
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function convertTables(html: string): string {
  const tableRegex = /(\|.+\|\n)+/g
  return html.replace(tableRegex, (table) => {
    const rows = table.trim().split('\n')
    let tableHtml = '<table>'
    let isHeader = true

    for (const row of rows) {
      // Skip separator row (|---|---|)
      if (row.match(/^\|[\s-:|]+\|$/)) {
        isHeader = false
        continue
      }

      const cells = row
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
      const tag = isHeader ? 'th' : 'td'
      const rowTag = isHeader ? 'thead' : 'tbody'

      if (isHeader) {
        tableHtml += `<${rowTag}><tr>`
      } else if (rows.indexOf(row) === 2) {
        tableHtml += `<${rowTag}><tr>`
      } else {
        tableHtml += '<tr>'
      }

      for (const cell of cells) {
        tableHtml += `<${tag}>${cell}</${tag}>`
      }

      if (isHeader) {
        tableHtml += `</tr></${rowTag}>`
        isHeader = false
      } else {
        tableHtml += '</tr>'
      }
    }

    tableHtml += '</tbody></table>'
    return tableHtml
  })
}

function convertJsxComponents(html: string): string {
  // Convert AgentGrid with Agent children
  html = html.replace(/<AgentGrid>([\s\S]*?)<\/AgentGrid>/g, (_, content) => {
    const agentHtml = convertAgents(content)
    return `<div class="agent-grid">${agentHtml}</div>`
  })

  // Convert FeatureGrid with Feature children
  html = html.replace(/<FeatureGrid>([\s\S]*?)<\/FeatureGrid>/g, (_, content) => {
    const featureHtml = convertFeatures(content)
    return `<div class="feature-grid">${featureHtml}</div>`
  })

  // Convert CTA component
  html = html.replace(/<CTA\s+primary="([^"]+)"\s+secondary="([^"]+)">([\s\S]*?)<\/CTA>/g, (_, primary, secondary, content) => {
    return `<div class="cta"><a href="${primary}" class="primary">${content.trim()}</a><a href="${secondary}" class="secondary">GitHub</a></div>`
  })

  return html
}

function convertAgents(content: string): string {
  const agentRegex = /<Agent\s+name="([^"]+)"\s+role="([^"]+)"\s+avatar="([^"]+)">([\s\S]*?)<\/Agent>/g
  let html = ''
  let match

  while ((match = agentRegex.exec(content)) !== null) {
    const [, name, role, avatar, description] = match
    html += `
      <div class="agent" data-agent-name="${name}">
        <div class="avatar">${avatar}</div>
        <h3>${name}</h3>
        <div class="role">${role}</div>
        <p>${description.trim()}</p>
      </div>`
  }

  return html
}

function convertFeatures(content: string): string {
  const featureRegex = /<Feature\s+icon="([^"]+)"\s+title="([^"]+)">([\s\S]*?)<\/Feature>/g
  let html = ''
  let match

  while ((match = featureRegex.exec(content)) !== null) {
    const [, icon, title, description] = match
    html += `
      <div class="feature">
        <div class="icon">${icon}</div>
        <h3>${title}</h3>
        <p>${description.trim()}</p>
      </div>`
  }

  return html
}

function convertParagraphs(html: string): string {
  const lines = html.split('\n')
  const result: string[] = []
  let inParagraph = false
  let paragraphContent = ''

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) {
      if (inParagraph) {
        result.push(`<p>${paragraphContent.trim()}</p>`)
        paragraphContent = ''
        inParagraph = false
      }
      continue
    }

    // Skip lines that are already HTML or special markers
    if (
      trimmed.startsWith('<') ||
      trimmed.startsWith('```') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('|') ||
      trimmed === '---'
    ) {
      if (inParagraph) {
        result.push(`<p>${paragraphContent.trim()}</p>`)
        paragraphContent = ''
        inParagraph = false
      }
      result.push(line)
      continue
    }

    // Regular text - add to paragraph
    if (inParagraph) {
      paragraphContent += ' ' + trimmed
    } else {
      inParagraph = true
      paragraphContent = trimmed
    }
  }

  // Close any open paragraph
  if (inParagraph) {
    result.push(`<p>${paragraphContent.trim()}</p>`)
  }

  return result.join('\n')
}
