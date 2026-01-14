/**
 * Git Protocol Capabilities
 *
 * Parsing and handling of Git protocol capabilities.
 * See: https://git-scm.com/docs/protocol-capabilities
 */

/** Parsed capabilities structure */
export interface Capabilities {
  /** Simple capabilities without values */
  list: string[]
  /** Key-value capabilities */
  values: Record<string, string>
  /** Multi-value capabilities (like symref) */
  multiValues?: Record<string, string[]>
}

/**
 * Parse space-separated capabilities string
 */
export function parseCapabilities(capString: string): Capabilities {
  const list: string[] = []
  const values: Record<string, string> = {}
  const multiValues: Record<string, string[]> = {}

  if (!capString || capString.trim() === '') {
    return { list, values, multiValues }
  }

  const parts = capString.trim().split(/\s+/)

  for (const part of parts) {
    const eqIndex = part.indexOf('=')
    if (eqIndex > 0) {
      // Key-value capability
      const key = part.slice(0, eqIndex)
      const value = part.slice(eqIndex + 1)

      // Store in values (last value wins)
      values[key] = value

      // Also store in multiValues for capabilities that can appear multiple times
      if (!multiValues[key]) {
        multiValues[key] = []
      }
      multiValues[key].push(value)
    } else {
      // Simple capability (no value)
      list.push(part)
    }
  }

  return { list, values, multiValues }
}

/**
 * Check if a capability is present
 */
export function hasCapability(caps: Capabilities, name: string): boolean {
  // Check in simple list
  if (caps.list.includes(name)) {
    return true
  }
  // Check in key-value capabilities
  if (name in caps.values) {
    return true
  }
  return false
}

/**
 * Get the value of a key=value capability
 */
export function getCapabilityValue(
  caps: Capabilities,
  name: string
): string | undefined {
  return caps.values[name]
}
