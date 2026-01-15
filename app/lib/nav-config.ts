/**
 * Navigation Configuration
 *
 * Defines navigation links for the documentation site.
 * Used by DocsLayout for header and footer navigation.
 *
 * @module lib/nav-config
 */

/**
 * Navigation link structure
 */
export interface NavLink {
  /** Link text */
  text: string
  /** Link URL (internal or external) */
  url: string
  /** Link target (for external links) */
  external?: boolean
  /** Icon identifier */
  icon?: string
}

/**
 * Navigation links for the documentation header.
 *
 * Includes:
 * - Internal docs navigation
 * - GitHub repository link
 * - API reference link
 *
 * @example
 * ```tsx
 * import { navLinks } from '@/lib/nav-config'
 *
 * <nav>
 *   {navLinks.map(link => (
 *     <a key={link.url} href={link.url}>{link.text}</a>
 *   ))}
 * </nav>
 * ```
 */
export const navLinks: NavLink[] = [
  {
    text: 'Docs',
    url: '/docs',
  },
  {
    text: 'API',
    url: '/docs/api',
  },
  {
    text: 'Examples',
    url: '/docs/examples',
  },
  {
    text: 'GitHub',
    url: 'https://github.com/dot-do/dotdo',
    external: true,
    icon: 'github',
  },
]

/**
 * Navigation configuration object (alternative export format)
 */
export const navigation = {
  links: navLinks,
}

/**
 * Links alias for compatibility
 */
export const links = navLinks

export default navLinks
