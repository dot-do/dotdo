/**
 * SEO Helper Module
 *
 * Provides utilities for generating SEO meta tags, Open Graph tags,
 * Twitter Cards, JSON-LD structured data, and canonical URLs.
 *
 * Features:
 * - Type-safe meta tag generation compatible with TanStack Start
 * - Multiple JSON-LD schema types (WebSite, Article, Organization, etc.)
 * - Automatic HTML escaping for XSS prevention
 * - Description truncation following SEO best practices (160 chars)
 * - Canonical URL normalization
 * - Social media card optimization (Open Graph, Twitter Cards)
 *
 * @example
 * ```typescript
 * import { generateMeta, generateJsonLd, SEO_DEFAULTS } from './lib/seo'
 *
 * // In TanStack Start route:
 * head: () => ({
 *   meta: generateMeta({
 *     title: 'My Page',
 *     description: 'Page description',
 *     url: '/my-page',
 *   }),
 * })
 * ```
 *
 * @see https://tanstack.com/start/latest/docs/routing/head
 * @see https://schema.org
 * @see https://developers.google.com/search/docs/appearance/structured-data
 * @module lib/seo
 */

import { emitDeprecationWarning } from './deprecation'

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum description length for SEO (Google typically shows ~155-160 chars)
 */
export const MAX_DESCRIPTION_LENGTH = 160

/**
 * Maximum title length for SEO (Google typically shows ~60 chars)
 */
export const MAX_TITLE_LENGTH = 60

/**
 * SEO defaults for the site
 *
 * These values are used as fallbacks when specific values are not provided.
 * Update these to match your site's branding and URLs.
 */
export const SEO_DEFAULTS = {
  /** Site name used in title suffixes and structured data */
  siteName: 'dotdo',
  /** Base URL for canonical links and absolute URLs */
  siteUrl: 'https://dotdo.dev',
  /** Default meta description */
  description: 'Durable Objects runtime framework for building stateful edge applications',
  /** Twitter handle for twitter:site meta tag */
  twitterHandle: '@dotdo_dev',
  /** Locale for Open Graph (format: language_TERRITORY) */
  locale: 'en_US',
  /** Default OG image path (relative to siteUrl) */
  defaultImage: '/og-image.png',
} as const

/** Type for SEO_DEFAULTS for use in generics */
export type SeoDefaults = typeof SEO_DEFAULTS

// =============================================================================
// Types
// =============================================================================

/**
 * Open Graph content types
 * @see https://ogp.me/#types
 */
export type OpenGraphType =
  | 'website'
  | 'article'
  | 'profile'
  | 'book'
  | 'music.song'
  | 'music.album'
  | 'video.movie'

/**
 * Twitter card types
 * @see https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/abouts-cards
 */
export type TwitterCardType =
  | 'summary'
  | 'summary_large_image'
  | 'app'
  | 'player'

/**
 * Robots meta directives
 */
export type RobotsDirective =
  | 'index'
  | 'noindex'
  | 'follow'
  | 'nofollow'
  | 'noarchive'
  | 'nosnippet'
  | 'noimageindex'

/**
 * Input options for generating SEO meta tags
 */
export interface SeoMeta {
  /** Page title (will be suffixed with site name) */
  title?: string
  /** Meta description (auto-truncated to 160 chars) */
  description?: string
  /** Page URL (relative or absolute, used for canonical) */
  url?: string
  /** Social share image URL (relative or absolute) */
  image?: string
  /** Image alt text for accessibility */
  imageAlt?: string
  /** Open Graph content type */
  type?: OpenGraphType
  /** Twitter card type (defaults to summary_large_image) */
  twitterCard?: TwitterCardType
  /** SEO keywords (optional, less important for modern SEO) */
  keywords?: string[]
  /** Content author name */
  author?: string
  /** Article publish date (ISO 8601) */
  publishedTime?: string
  /** Article modification date (ISO 8601) */
  modifiedTime?: string
  /** Prevent indexing by search engines */
  noIndex?: boolean
  /** Prevent following links on this page */
  noFollow?: boolean
  /** Additional robots directives */
  robots?: RobotsDirective[]
  /** Alternate language versions */
  alternates?: Array<{ hrefLang: string; href: string }>
}

/**
 * Author information for structured data
 */
export interface AuthorInfo {
  /** Author name (required) */
  name: string
  /** Author URL (profile, website, etc.) */
  url?: string
  /** Author type (Person or Organization) */
  type?: 'Person' | 'Organization'
}

/**
 * Breadcrumb item for navigation structured data
 */
export interface BreadcrumbItem {
  /** Display name for this breadcrumb */
  name: string
  /** URL for this breadcrumb item */
  url: string
}

/**
 * FAQ item for FAQ structured data
 */
export interface FaqItem {
  /** The question */
  question: string
  /** The answer (can contain HTML) */
  answer: string
}

/**
 * Software application pricing information
 */
export interface SoftwarePricing {
  /** Price (0 for free) */
  price: number | string
  /** Currency code (ISO 4217) */
  currency?: string
  /** Pricing model description */
  pricingType?: 'Free' | 'Freemium' | 'Paid' | 'Subscription'
}

/**
 * JSON-LD schema types supported by this module
 */
export type JsonLdType =
  | 'WebSite'
  | 'SoftwareApplication'
  | 'Article'
  | 'BreadcrumbList'
  | 'Organization'
  | 'FAQPage'
  | 'HowTo'
  | 'Product'

/**
 * Options for generating JSON-LD structured data
 */
export interface JsonLdOptions {
  /** Schema.org type */
  type: JsonLdType
  /** Content title/headline */
  title?: string
  /** Content description */
  description?: string
  /** Content URL */
  url?: string
  /** Publication date (ISO 8601) */
  datePublished?: string
  /** Last modification date (ISO 8601) */
  dateModified?: string
  /** Content author */
  author?: AuthorInfo
  /** Breadcrumb items (for BreadcrumbList) */
  items?: BreadcrumbItem[]
  /** FAQ items (for FAQPage) */
  faqItems?: FaqItem[]
  /** Software pricing (for SoftwareApplication) */
  pricing?: SoftwarePricing
  /** Software category */
  applicationCategory?: string
  /** Image URL for the content */
  image?: string
  /** Additional custom properties */
  customProperties?: Record<string, unknown>
}

/**
 * Meta tag entry returned by generateMeta
 *
 * Compatible with TanStack Start's head() meta array format.
 * @see https://tanstack.com/start/latest/docs/routing/head
 */
export interface MetaTag {
  /** Page title (only for title meta) */
  title?: string
  /** Meta name attribute (for standard meta tags) */
  name?: string
  /** Meta property attribute (for Open Graph) */
  property?: string
  /** Meta content attribute */
  content?: string
  /** Character set (for charset meta) */
  charSet?: string
  /** Link relation (for link tags like canonical) */
  rel?: string
  /** Link href (for link tags) */
  href?: string
  /** HTTP-equiv attribute */
  httpEquiv?: string
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * HTML entity mapping for escaping
 */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escape HTML entities to prevent XSS in meta content
 *
 * @param str - String to escape
 * @returns Escaped string safe for HTML attributes
 *
 * @example
 * ```typescript
 * escapeHtml('<script>alert("xss")</script>')
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 * ```
 */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] || char)
}

/**
 * Truncate text to a maximum length at word boundary
 *
 * Preserves whole words and adds ellipsis if truncated.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: MAX_DESCRIPTION_LENGTH)
 * @param suffix - Suffix to add when truncated (default: '...')
 * @returns Truncated text
 *
 * @example
 * ```typescript
 * truncateText('This is a long description that needs truncating', 30)
 * // Returns: 'This is a long description...'
 * ```
 */
export function truncateText(
  text: string,
  maxLength: number = MAX_DESCRIPTION_LENGTH,
  suffix: string = '...'
): string {
  if (text.length <= maxLength) {
    return text
  }

  // Reserve space for suffix
  const truncateAt = maxLength - suffix.length
  const truncated = text.substring(0, truncateAt)

  // Find last word boundary
  const lastSpace = truncated.lastIndexOf(' ')
  const finalText = lastSpace > truncateAt * 0.5
    ? truncated.substring(0, lastSpace)
    : truncated

  return finalText + suffix
}

/**
 * @deprecated Use truncateText instead
 */
function truncateDescription(description: string, maxLength = 160): string {
  emitDeprecationWarning('truncateDescription', 'truncateText')
  return truncateText(description, maxLength)
}

/**
 * Normalize URL for canonical links
 *
 * - Converts relative URLs to absolute
 * - Removes trailing slashes (except for root path)
 * - Preserves query strings and fragments
 *
 * @param url - URL to normalize (relative or absolute)
 * @param baseUrl - Base URL for resolving relative paths
 * @returns Normalized absolute URL
 *
 * @example
 * ```typescript
 * normalizeUrl('/docs/', 'https://example.com')
 * // Returns: 'https://example.com/docs'
 *
 * normalizeUrl('/', 'https://example.com')
 * // Returns: 'https://example.com/'
 * ```
 */
export function normalizeUrl(url: string, baseUrl: string = SEO_DEFAULTS.siteUrl): string {
  // Handle absolute URLs
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`

  // Parse URL to handle query strings and fragments properly
  try {
    const parsed = new URL(fullUrl)
    const pathname = parsed.pathname

    // Root path should keep trailing slash
    if (pathname === '/') {
      return fullUrl
    }

    // Remove trailing slash from other paths
    if (pathname.endsWith('/')) {
      parsed.pathname = pathname.slice(0, -1)
      return parsed.toString()
    }

    return fullUrl
  } catch {
    // Fallback for invalid URLs
    if (fullUrl.endsWith('/') && fullUrl !== `${baseUrl}/`) {
      return fullUrl.slice(0, -1)
    }
    return fullUrl
  }
}

/**
 * Build absolute URL from relative path
 *
 * @param path - Relative path
 * @param baseUrl - Base URL (default: SEO_DEFAULTS.siteUrl)
 * @returns Absolute URL
 */
export function absoluteUrl(path: string, baseUrl: string = SEO_DEFAULTS.siteUrl): string {
  if (path.startsWith('http')) {
    return path
  }
  const separator = path.startsWith('/') ? '' : '/'
  return `${baseUrl}${separator}${path}`
}

/**
 * Generate page title with site name suffix
 *
 * @param title - Page title
 * @param siteName - Site name to append (default: SEO_DEFAULTS.siteName)
 * @param separator - Separator between title and site name
 * @returns Formatted title
 *
 * @example
 * ```typescript
 * formatTitle('Getting Started')
 * // Returns: 'Getting Started - dotdo'
 *
 * formatTitle('dotdo')
 * // Returns: 'dotdo' (no duplication)
 * ```
 */
export function formatTitle(
  title: string,
  siteName: string = SEO_DEFAULTS.siteName,
  separator: string = ' - '
): string {
  // Avoid duplicate site name
  if (title === siteName || title.endsWith(`${separator}${siteName}`)) {
    return title
  }
  return `${title}${separator}${siteName}`
}

// =============================================================================
// Meta Tag Generation
// =============================================================================

/**
 * Generate meta tags for SEO including Open Graph and Twitter Cards
 *
 * Creates a comprehensive set of meta tags for:
 * - Basic SEO (description, keywords)
 * - Open Graph (Facebook, LinkedIn, etc.)
 * - Twitter Cards
 * - Canonical URLs
 * - Robots directives
 *
 * @param options - SEO options for the page
 * @returns Array of meta tag objects compatible with TanStack Start head()
 *
 * @example Basic usage
 * ```typescript
 * head: () => ({
 *   meta: generateMeta({
 *     title: 'Getting Started',
 *     description: 'Learn how to use dotdo',
 *     url: '/docs/getting-started',
 *   }),
 * })
 * ```
 *
 * @example Article with author
 * ```typescript
 * generateMeta({
 *   title: 'Building Stateful Apps',
 *   description: 'A guide to Durable Objects',
 *   type: 'article',
 *   author: 'dotdo team',
 *   publishedTime: '2024-01-15',
 * })
 * ```
 *
 * @example Prevent indexing
 * ```typescript
 * generateMeta({
 *   title: 'Admin Dashboard',
 *   noIndex: true,
 *   noFollow: true,
 * })
 * ```
 */
export function generateMeta(options: SeoMeta = {}): MetaTag[] {
  const {
    title = SEO_DEFAULTS.siteName,
    description = SEO_DEFAULTS.description,
    url,
    image,
    imageAlt,
    type = 'website',
    twitterCard = 'summary_large_image',
    keywords,
    author,
    publishedTime,
    modifiedTime,
    noIndex,
    noFollow,
    robots,
    alternates,
  } = options

  // Process description: escape HTML and truncate
  const safeDescription = truncateText(escapeHtml(description))

  // Format title with site name suffix
  const fullTitle = formatTitle(title)

  // Build canonical URL
  const canonicalUrl = url ? normalizeUrl(url) : SEO_DEFAULTS.siteUrl

  // Build image URL (default to OG image)
  const imageUrl = absoluteUrl(image || SEO_DEFAULTS.defaultImage)

  const meta: MetaTag[] = [
    // Basic SEO meta tags
    { name: 'description', content: safeDescription },

    // Open Graph protocol tags
    { property: 'og:title', content: fullTitle },
    { property: 'og:description', content: safeDescription },
    { property: 'og:type', content: type },
    { property: 'og:url', content: canonicalUrl },
    { property: 'og:site_name', content: SEO_DEFAULTS.siteName },
    { property: 'og:locale', content: SEO_DEFAULTS.locale },
    { property: 'og:image', content: imageUrl },

    // Twitter Card tags
    { name: 'twitter:card', content: twitterCard },
    { name: 'twitter:title', content: fullTitle },
    { name: 'twitter:description', content: safeDescription },
    { name: 'twitter:image', content: imageUrl },
    { name: 'twitter:site', content: SEO_DEFAULTS.twitterHandle },

    // Canonical URL (link tag in meta array)
    { rel: 'canonical', href: canonicalUrl },
  ]

  // Add image alt text if provided
  if (imageAlt) {
    meta.push({ property: 'og:image:alt', content: imageAlt })
    meta.push({ name: 'twitter:image:alt', content: imageAlt })
  }

  // Add author information
  if (author) {
    meta.push({ name: 'author', content: author })
    meta.push({ name: 'twitter:creator', content: author })
  }

  // Add article-specific Open Graph tags
  if (type === 'article') {
    if (publishedTime) {
      meta.push({ property: 'article:published_time', content: publishedTime })
    }
    if (modifiedTime) {
      meta.push({ property: 'article:modified_time', content: modifiedTime })
    }
    if (author) {
      meta.push({ property: 'article:author', content: author })
    }
  }

  // Add keywords (less important for modern SEO but still used)
  if (keywords && keywords.length > 0) {
    meta.push({ name: 'keywords', content: keywords.join(', ') })
  }

  // Build robots directive
  const robotsDirectives: string[] = []
  if (noIndex) robotsDirectives.push('noindex')
  if (noFollow) robotsDirectives.push('nofollow')
  if (robots) robotsDirectives.push(...robots)

  if (robotsDirectives.length > 0) {
    meta.push({ name: 'robots', content: robotsDirectives.join(', ') })
  }

  // Add alternate language versions
  if (alternates && alternates.length > 0) {
    for (const alt of alternates) {
      meta.push({
        rel: 'alternate',
        href: absoluteUrl(alt.href),
        // Note: hrefLang would need special handling in TanStack
      })
    }
  }

  return meta
}

// =============================================================================
// JSON-LD Structured Data Generation
// =============================================================================

/**
 * Base schema with @context
 */
interface BaseSchema {
  '@context': 'https://schema.org'
  '@type': string
  [key: string]: unknown
}

/**
 * Build author schema object
 */
function buildAuthorSchema(author?: AuthorInfo): Record<string, unknown> {
  if (!author) {
    return {
      '@type': 'Organization',
      name: SEO_DEFAULTS.siteName,
      url: SEO_DEFAULTS.siteUrl,
    }
  }

  return {
    '@type': author.type || 'Organization',
    name: author.name,
    ...(author.url && { url: author.url }),
  }
}

/**
 * Build organization schema for publisher
 */
function buildPublisherSchema(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: SEO_DEFAULTS.siteName,
    url: SEO_DEFAULTS.siteUrl,
    logo: {
      '@type': 'ImageObject',
      url: `${SEO_DEFAULTS.siteUrl}/logo.png`,
    },
  }
}

/**
 * Generate JSON-LD structured data for search engines
 *
 * Creates Schema.org compliant JSON-LD for rich search results.
 * Supports multiple schema types for different content:
 *
 * - **WebSite**: Site-wide schema with search action
 * - **Article**: Documentation, blog posts, guides
 * - **SoftwareApplication**: The dotdo framework itself
 * - **Organization**: Company/project information
 * - **BreadcrumbList**: Navigation breadcrumbs
 * - **FAQPage**: Frequently asked questions
 * - **HowTo**: Step-by-step tutorials
 *
 * @param options - JSON-LD configuration options
 * @returns JSON string for script tag insertion
 *
 * @example WebSite schema
 * ```typescript
 * const jsonLd = generateJsonLd({ type: 'WebSite' })
 * ```
 *
 * @example Article with author
 * ```typescript
 * const jsonLd = generateJsonLd({
 *   type: 'Article',
 *   title: 'Getting Started with Durable Objects',
 *   description: 'Learn how to build stateful edge applications',
 *   url: '/docs/getting-started',
 *   datePublished: '2024-01-15',
 *   author: { name: 'dotdo team', type: 'Organization' },
 * })
 * ```
 *
 * @example Breadcrumbs
 * ```typescript
 * const jsonLd = generateJsonLd({
 *   type: 'BreadcrumbList',
 *   items: [
 *     { name: 'Home', url: '/' },
 *     { name: 'Docs', url: '/docs' },
 *     { name: 'Getting Started', url: '/docs/getting-started' },
 *   ],
 * })
 * ```
 *
 * @example Usage in React component
 * ```tsx
 * function MyPage() {
 *   const jsonLd = generateJsonLd({ type: 'Article', ... })
 *   return (
 *     <>
 *       <script
 *         type="application/ld+json"
 *         dangerouslySetInnerHTML={{ __html: jsonLd }}
 *       />
 *       <main>...</main>
 *     </>
 *   )
 * }
 * ```
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data
 * @see https://schema.org
 */
export function generateJsonLd(options: JsonLdOptions): string {
  const {
    type,
    title,
    description,
    url,
    datePublished,
    dateModified,
    author,
    items,
    faqItems,
    pricing,
    applicationCategory,
    image,
    customProperties,
  } = options

  let schema: BaseSchema

  switch (type) {
    case 'WebSite':
      schema = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SEO_DEFAULTS.siteName,
        url: SEO_DEFAULTS.siteUrl,
        description: description || SEO_DEFAULTS.description,
        inLanguage: SEO_DEFAULTS.locale.replace('_', '-'),
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SEO_DEFAULTS.siteUrl}/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      }
      break

    case 'SoftwareApplication':
      schema = {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: title || SEO_DEFAULTS.siteName,
        applicationCategory: applicationCategory || 'DeveloperApplication',
        applicationSubCategory: 'Web Framework',
        operatingSystem: 'Any',
        description: description || SEO_DEFAULTS.description,
        url: absoluteUrl(url || '/'),
        downloadUrl: 'https://www.npmjs.com/package/dotdo',
        installUrl: 'https://www.npmjs.com/package/dotdo',
        softwareVersion: '1.0.0', // Consider making this dynamic
        releaseNotes: `${SEO_DEFAULTS.siteUrl}/changelog`,
        featureList: [
          'Durable Objects runtime',
          'SQLite storage',
          'Edge computing',
          'TypeScript support',
        ],
        offers: {
          '@type': 'Offer',
          price: pricing?.price ?? '0',
          priceCurrency: pricing?.currency || 'USD',
          availability: 'https://schema.org/InStock',
        },
        author: buildAuthorSchema(author),
        publisher: buildPublisherSchema(),
        ...(image && { image: absoluteUrl(image) }),
      }
      break

    case 'Article':
      schema = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: title || 'Documentation',
        description: description || SEO_DEFAULTS.description,
        url: absoluteUrl(url || '/'),
        datePublished: datePublished || new Date().toISOString(),
        dateModified: dateModified || datePublished || new Date().toISOString(),
        inLanguage: SEO_DEFAULTS.locale.replace('_', '-'),
        author: buildAuthorSchema(author),
        publisher: buildPublisherSchema(),
        mainEntityOfPage: {
          '@type': 'WebPage',
          '@id': absoluteUrl(url || '/'),
        },
        isPartOf: {
          '@type': 'WebSite',
          name: SEO_DEFAULTS.siteName,
          url: SEO_DEFAULTS.siteUrl,
        },
        ...(image && {
          image: {
            '@type': 'ImageObject',
            url: absoluteUrl(image),
          },
        }),
      }
      break

    case 'BreadcrumbList':
      schema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: (items || []).map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: absoluteUrl(item.url),
        })),
      }
      break

    case 'Organization':
      schema = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SEO_DEFAULTS.siteName,
        url: SEO_DEFAULTS.siteUrl,
        description: description || SEO_DEFAULTS.description,
        logo: {
          '@type': 'ImageObject',
          url: `${SEO_DEFAULTS.siteUrl}/logo.png`,
        },
        sameAs: [
          `https://twitter.com/${SEO_DEFAULTS.twitterHandle.replace('@', '')}`,
          'https://github.com/dot-do/dotdo',
        ],
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'technical support',
          url: `${SEO_DEFAULTS.siteUrl}/support`,
        },
      }
      break

    case 'FAQPage':
      schema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: (faqItems || []).map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.answer,
          },
        })),
      }
      break

    case 'HowTo':
      schema = {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: title || 'Tutorial',
        description: description || SEO_DEFAULTS.description,
        url: absoluteUrl(url || '/'),
        step: (items || []).map((item, index) => ({
          '@type': 'HowToStep',
          position: index + 1,
          name: item.name,
          url: absoluteUrl(item.url),
        })),
        ...(image && { image: absoluteUrl(image) }),
      }
      break

    case 'Product':
      schema = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: title || SEO_DEFAULTS.siteName,
        description: description || SEO_DEFAULTS.description,
        url: absoluteUrl(url || '/'),
        brand: {
          '@type': 'Brand',
          name: SEO_DEFAULTS.siteName,
        },
        offers: {
          '@type': 'Offer',
          price: pricing?.price ?? '0',
          priceCurrency: pricing?.currency || 'USD',
          availability: 'https://schema.org/InStock',
        },
        ...(image && { image: absoluteUrl(image) }),
      }
      break

    default: {
      // Type-safe exhaustive check
      const _exhaustiveCheck: never = type
      schema = {
        '@context': 'https://schema.org',
        '@type': type as string,
      }
      // Suppress unused variable warning
      void _exhaustiveCheck
    }
  }

  // Merge custom properties if provided
  if (customProperties) {
    Object.assign(schema, customProperties)
  }

  return JSON.stringify(schema)
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Generate multiple JSON-LD schemas and combine them
 *
 * Useful when you need multiple schemas on a single page
 * (e.g., Article + BreadcrumbList + Organization)
 *
 * @param schemas - Array of JSON-LD options
 * @returns Combined JSON string with @graph
 *
 * @example
 * ```typescript
 * const jsonLd = generateMultipleJsonLd([
 *   { type: 'WebSite' },
 *   { type: 'Organization' },
 *   {
 *     type: 'BreadcrumbList',
 *     items: [{ name: 'Home', url: '/' }],
 *   },
 * ])
 * ```
 */
export function generateMultipleJsonLd(schemas: JsonLdOptions[]): string {
  const parsedSchemas = schemas.map((opts) => {
    const json = generateJsonLd(opts)
    const parsed = JSON.parse(json)
    // Remove @context from individual schemas (will be at top level)
    delete parsed['@context']
    return parsed
  })

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': parsedSchemas,
  })
}

/**
 * Create a JSON-LD script tag string for direct HTML insertion
 *
 * @param options - JSON-LD options or array of options
 * @returns Complete script tag HTML string
 *
 * @example
 * ```typescript
 * const scriptTag = jsonLdScriptTag({ type: 'WebSite' })
 * // Returns: <script type="application/ld+json">{"@context":...}</script>
 * ```
 */
export function jsonLdScriptTag(options: JsonLdOptions | JsonLdOptions[]): string {
  const json = Array.isArray(options)
    ? generateMultipleJsonLd(options)
    : generateJsonLd(options)

  return `<script type="application/ld+json">${json}</script>`
}
