/**
 * UI Directives Handler
 *
 * Resolves $icon, $group, $label, $description, $hidden, $readonly and other UI directives.
 */

export interface UIDirectives {
  icon?: string
  iconType?: 'name' | 'emoji' | 'url'
  iconLibrary?: string
  iconName?: string
  group?: string
  groupOrder?: number
  groupPath?: string[]
  label?: string
  description?: string
  hidden?: boolean
  readonly?: boolean
  warnings?: string[]
}

/**
 * Known directive keys
 */
const KNOWN_DIRECTIVES = new Set([
  '$id',
  '$context',
  '$instructions',
  '$icon',
  '$group',
  '$label',
  '$description',
  '$hidden',
  '$readonly',
  '$type',
  '$source',
  '$seed',
])

/**
 * Check if a string is an emoji
 */
function isEmoji(str: string): boolean {
  // Check if the string contains emoji characters
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
  return emojiRegex.test(str)
}

/**
 * Check if a string is a URL
 */
function isUrl(str: string): boolean {
  return /^https?:\/\//.test(str)
}

/**
 * Parse an icon value to determine its type and components
 */
function parseIcon(icon: string): Pick<UIDirectives, 'icon' | 'iconType' | 'iconLibrary' | 'iconName'> {
  if (isEmoji(icon)) {
    return {
      icon,
      iconType: 'emoji',
    }
  }

  if (isUrl(icon)) {
    return {
      icon,
      iconType: 'url',
    }
  }

  // Check for library prefix (e.g., "lucide:user")
  if (icon.includes(':')) {
    const [library, name] = icon.split(':')
    return {
      icon,
      iconLibrary: library,
      iconName: name,
    }
  }

  return {
    icon,
    iconType: 'name',
  }
}

/**
 * Parse a group value to extract path components
 */
function parseGroup(
  group: string | { name: string; order?: number }
): Pick<UIDirectives, 'group' | 'groupOrder' | 'groupPath'> {
  if (typeof group === 'object') {
    const result: Pick<UIDirectives, 'group' | 'groupOrder' | 'groupPath'> = {
      group: group.name,
    }

    if (group.order !== undefined) {
      result.groupOrder = group.order
    }

    if (group.name.includes('/')) {
      result.groupPath = group.name.split('/')
    }

    return result
  }

  const result: Pick<UIDirectives, 'group' | 'groupPath'> = {
    group,
  }

  if (group.includes('/')) {
    result.groupPath = group.split('/')
  }

  return result
}

/**
 * Resolve all UI directives from a type definition
 */
export function resolveUIDirectives(type: Record<string, unknown>): UIDirectives {
  const result: UIDirectives = {}
  const warnings: string[] = []

  // Check for unknown directives
  for (const key of Object.keys(type)) {
    if (key.startsWith('$') && !KNOWN_DIRECTIVES.has(key)) {
      warnings.push(`Unknown directive: ${key}`)
    }
  }

  if (warnings.length > 0) {
    result.warnings = warnings
  }

  // $icon
  if (type.$icon !== undefined) {
    Object.assign(result, parseIcon(type.$icon as string))
  }

  // $group
  if (type.$group !== undefined) {
    Object.assign(result, parseGroup(type.$group as string | { name: string; order?: number }))
  }

  // $label
  if (type.$label !== undefined) {
    result.label = type.$label as string
  }

  // $description
  if (type.$description !== undefined) {
    result.description = type.$description as string
  }

  // $hidden
  if (type.$hidden !== undefined) {
    result.hidden = type.$hidden as boolean
  }

  // $readonly
  if (type.$readonly !== undefined) {
    result.readonly = type.$readonly as boolean
  }

  return result
}
