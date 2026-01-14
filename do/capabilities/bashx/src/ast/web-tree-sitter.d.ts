/**
 * Type declarations for web-tree-sitter 0.25.x
 * These are needed because the package.json exports don't resolve types correctly
 */

declare module 'web-tree-sitter' {
  export interface Point {
    row: number
    column: number
  }

  export interface Range {
    startPosition: Point
    endPosition: Point
    startIndex: number
    endIndex: number
  }

  export interface Edit {
    startIndex: number
    oldEndIndex: number
    newEndIndex: number
    startPosition: Point
    oldEndPosition: Point
    newEndPosition: Point
  }

  export interface Node {
    id: number
    tree: Tree
    type: string
    text: string
    startPosition: Point
    endPosition: Point
    startIndex: number
    endIndex: number
    parent: Node | null
    children: Node[]
    namedChildren: Node[]
    childCount: number
    namedChildCount: number
    firstChild: Node | null
    firstNamedChild: Node | null
    lastChild: Node | null
    lastNamedChild: Node | null
    nextSibling: Node | null
    nextNamedSibling: Node | null
    previousSibling: Node | null
    previousNamedSibling: Node | null
    isNamed: boolean
    hasError: boolean

    hasChanges(): boolean
    equals(other: Node): boolean
    isMissing(): boolean
    toString(): string
    child(index: number): Node | null
    namedChild(index: number): Node | null
    childForFieldId(fieldId: number): Node | null
    childForFieldName(fieldName: string): Node | null
    childrenForFieldName(fieldName: string): Node[]
    descendantForIndex(index: number): Node
    descendantForIndex(startIndex: number, endIndex: number): Node
    descendantsOfType(type: string | string[], startPosition?: Point, endPosition?: Point): Node[]
    namedDescendantForIndex(index: number): Node
    namedDescendantForIndex(startIndex: number, endIndex: number): Node
    descendantForPosition(position: Point): Node
    descendantForPosition(startPosition: Point, endPosition: Point): Node
    namedDescendantForPosition(position: Point): Node
    namedDescendantForPosition(startPosition: Point, endPosition: Point): Node
    walk(): TreeCursor
  }

  export interface TreeCursor {
    nodeType: string
    nodeTypeId: number
    nodeText: string
    nodeId: number
    nodeIsNamed: boolean
    nodeIsMissing: boolean
    startPosition: Point
    endPosition: Point
    startIndex: number
    endIndex: number
    currentNode: Node
    currentFieldName: string | null

    reset(node: Node): void
    gotoParent(): boolean
    gotoFirstChild(): boolean
    gotoFirstChildForIndex(index: number): boolean
    gotoNextSibling(): boolean
  }

  export interface Tree {
    readonly rootNode: Node

    copy(): Tree
    edit(delta: Edit): Tree
    walk(): TreeCursor
    getChangedRanges(other: Tree): Range[]
    getEditedRange(other: Tree): Range
    getLanguage(): Language
  }

  export interface QueryCapture {
    name: string
    node: Node
  }

  export interface QueryMatch {
    patternIndex: number
    captures: QueryCapture[]
  }

  export class Query {
    captureNames: string[]

    constructor(language: Language, source: string)
    matches(node: Node, startPosition?: Point, endPosition?: Point): QueryMatch[]
    captures(node: Node, startPosition?: Point, endPosition?: Point): QueryCapture[]
  }

  export class Language {
    static load(input: string | Uint8Array | Buffer): Promise<Language>

    readonly version: number
    readonly fieldCount: number
    readonly nodeTypeCount: number

    fieldNameForId(fieldId: number): string | null
    fieldIdForName(fieldName: string): number | null
    idForNodeType(type: string, named: boolean): number
    nodeTypeForId(typeId: number): string | null
    nodeTypeIsNamed(typeId: number): boolean
    nodeTypeIsVisible(typeId: number): boolean
    query(source: string): Query
  }

  export class Parser {
    static init(moduleOptions?: object): Promise<void>

    parse(input: string | ((startIndex: number, startPoint?: Point, endIndex?: number) => string | null), previousTree?: Tree): Tree | null
    reset(): void
    getLanguage(): Language | null
    setLanguage(language?: Language | null): void
    getLogger(): ((message: string, params: Record<string, string>, type: 'parse' | 'lex') => void) | null
    setLogger(logFunc?: ((message: string, params: Record<string, string>, type: 'parse' | 'lex') => void) | null): void
    setTimeoutMicros(value: number): void
    getTimeoutMicros(): number
  }

  export const LANGUAGE_VERSION: number
  export const MIN_COMPATIBLE_VERSION: number
}
