/**
 * Surface File Discovery
 *
 * Discovers surface files and content folders with priority-based resolution.
 *
 * Discovery order per surface:
 * - `./Surface.tsx` -> `./Surface.mdx` -> `.do/Surface.tsx` -> `.do/Surface.mdx`
 *
 * Surfaces: App, Admin, Site, Docs, Blog
 *
 * Content folders:
 * - `./docs/` -> `.do/docs/`
 * - `./blog/` -> `.do/blog/`
 * - `./site/` -> `.do/site/`
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Surface types that can be discovered
 */
export type Surface = 'App' | 'Admin' | 'Site' | 'Docs' | 'Blog'

/**
 * Content folder types that can be discovered
 */
export type ContentFolder = 'docs' | 'blog' | 'site'

/**
 * Complete discovery result containing all surfaces and content folders
 */
export interface DiscoveryResult {
  surfaces: Record<Surface, string | null>
  content: Record<ContentFolder, string | null>
}

/**
 * All known surfaces
 */
const SURFACES: Surface[] = ['App', 'Admin', 'Site', 'Docs', 'Blog']

/**
 * All known content folders
 */
const CONTENT_FOLDERS: ContentFolder[] = ['docs', 'blog', 'site']

/**
 * Check if a path exists and is a file
 */
async function isFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    return stats.isFile()
  } catch {
    return false
  }
}

/**
 * Check if a path exists and is a directory
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}

/**
 * Discover a surface file with priority-based resolution.
 *
 * Discovery order:
 * 1. `./Surface.tsx`
 * 2. `./Surface.mdx`
 * 3. `.do/Surface.tsx`
 * 4. `.do/Surface.mdx`
 *
 * @param surface - The surface name to discover
 * @param rootDir - The root directory to search from
 * @returns The absolute path to the discovered file, or null if not found
 */
export async function discoverSurface(surface: Surface, rootDir: string): Promise<string | null> {
  const candidates = [
    join(rootDir, `${surface}.tsx`),
    join(rootDir, `${surface}.mdx`),
    join(rootDir, '.do', `${surface}.tsx`),
    join(rootDir, '.do', `${surface}.mdx`),
  ]

  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Discover a content folder with priority-based resolution.
 *
 * Discovery order:
 * 1. `./folder/`
 * 2. `.do/folder/`
 *
 * @param folder - The folder name to discover
 * @param rootDir - The root directory to search from
 * @returns The absolute path to the discovered folder, or null if not found
 */
export async function discoverContentFolder(folder: ContentFolder, rootDir: string): Promise<string | null> {
  const candidates = [join(rootDir, folder), join(rootDir, '.do', folder)]

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Discover all surfaces and content folders in a directory.
 *
 * @param rootDir - The root directory to search from
 * @returns Complete discovery result with all surfaces and content folders
 */
export async function discoverAll(rootDir: string): Promise<DiscoveryResult> {
  const [surfaceResults, contentResults] = await Promise.all([
    Promise.all(SURFACES.map(async (surface) => [surface, await discoverSurface(surface, rootDir)] as const)),
    Promise.all(CONTENT_FOLDERS.map(async (folder) => [folder, await discoverContentFolder(folder, rootDir)] as const)),
  ])

  const surfaces = Object.fromEntries(surfaceResults) as Record<Surface, string | null>
  const content = Object.fromEntries(contentResults) as Record<ContentFolder, string | null>

  return { surfaces, content }
}
