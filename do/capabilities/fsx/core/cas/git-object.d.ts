/**
 * Git Object Format Implementation
 *
 * Git objects are stored with a header format: `<type> <size>\0<content>`
 * Valid types: blob, tree, commit, tag
 */
declare const VALID_TYPES: readonly ["blob", "tree", "commit", "tag"];
export type GitObjectType = (typeof VALID_TYPES)[number];
/**
 * Create a git object header: `<type> <size>\0`
 */
export declare function createHeader(type: string, size: number): Uint8Array;
/**
 * Parse a git object header from data
 * Returns the type, size, and offset where content begins
 */
export declare function parseHeader(data: Uint8Array): {
    type: string;
    size: number;
    contentOffset: number;
};
/**
 * Create a full git object (header + content)
 */
export declare function createGitObject(type: string, content: Uint8Array): Uint8Array;
/**
 * Parse a full git object and return type and content
 */
export declare function parseGitObject(data: Uint8Array): {
    type: string;
    content: Uint8Array;
};
export {};
//# sourceMappingURL=git-object.d.ts.map