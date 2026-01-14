import type { Node } from 'web-tree-sitter'

/**
 * Type for nodes that may or may not have childrenForFieldName at runtime.
 * While the type declaration includes this method, older web-tree-sitter
 * versions may not have it implemented at runtime.
 */
type MaybeHasChildrenForFieldName = {
  childrenForFieldName?: (name: string) => Node[]
  walk: Node['walk']
}

/**
 * Type guard to check if node has childrenForFieldName method at runtime.
 * This is needed because older web-tree-sitter versions may not have
 * this method even though the type declaration includes it.
 */
export function hasChildrenForFieldName(
  node: Node
): boolean {
  return typeof (node as MaybeHasChildrenForFieldName).childrenForFieldName === 'function'
}

/**
 * Safely get children for field name with fallback.
 * Uses the native method if available, otherwise walks children
 * using a cursor to find those with matching field name.
 */
export function getChildrenForFieldName(
  node: Node,
  name: string
): Node[] {
  // Type declaration says this method exists, but runtime may differ in older versions
  if (hasChildrenForFieldName(node)) {
    return node.childrenForFieldName(name)
  }
  // Fallback: use cursor to find children with matching field name
  const children: Node[] = []
  const cursor = node.walk()
  if (cursor.gotoFirstChild()) {
    do {
      if (cursor.currentFieldName === name) {
        children.push(cursor.currentNode)
      }
    } while (cursor.gotoNextSibling())
  }
  return children
}
