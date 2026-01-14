/**
 * Normalize a URL path segment by converting underscores to spaces.
 * Multiple consecutive underscores are collapsed to a single space.
 *
 * @example
 * normalizePathSegment('John_Doe') // 'John Doe'
 * normalizePathSegment('John__Doe') // 'John Doe'
 * normalizePathSegment('foo___bar') // 'foo bar'
 */
export function normalizePathSegment(segment: string): string {
  // Replace one or more underscores with a single space
  return segment.replace(/_+/g, ' ')
}
