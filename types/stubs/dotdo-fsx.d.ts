/**
 * Type stub for @dotdo/fsx module
 * Used during build when @dotdo/fsx package is not available
 *
 * @dotdo/fsx is the core filesystem implementation with zero dependencies.
 * It provides POSIX-like filesystem APIs that can run anywhere JavaScript runs.
 */
declare module '@dotdo/fsx' {
  export type BufferEncoding = 'utf-8' | 'utf8' | 'ascii' | 'base64' | 'hex' | 'binary' | 'latin1'

  export interface ReadOptions {
    encoding?: BufferEncoding | null
    flag?: string
    start?: number
    end?: number
    signal?: AbortSignal
    highWaterMark?: number
  }

  export interface WriteOptions {
    encoding?: BufferEncoding
    mode?: number
    flag?: string
    signal?: AbortSignal
    tier?: StorageTier
    flush?: boolean
    createDir?: boolean
  }

  export interface MkdirOptions {
    recursive?: boolean
    mode?: number
  }

  export interface RmdirOptions {
    recursive?: boolean
    maxRetries?: number
    retryDelay?: number
  }

  export interface ReaddirOptions {
    withFileTypes?: boolean
    recursive?: boolean
    encoding?: BufferEncoding
  }

  export interface ListOptions {
    withFileTypes?: boolean
    recursive?: boolean
    withStats?: boolean
    encoding?: BufferEncoding
    signal?: AbortSignal
    maxDepth?: number
    filter?: string
  }

  export interface CopyOptions {
    overwrite?: boolean
    preserveTimestamps?: boolean
    recursive?: boolean
    errorOnExist?: boolean
  }

  export interface MoveOptions {
    overwrite?: boolean
  }

  export interface RemoveOptions {
    recursive?: boolean
    force?: boolean
    maxRetries?: number
    retryDelay?: number
  }

  export interface ReadStreamOptions {
    start?: number
    end?: number
    highWaterMark?: number
    encoding?: BufferEncoding
  }

  export interface WriteStreamOptions {
    start?: number
    flags?: string
    mode?: number
    highWaterMark?: number
    encoding?: BufferEncoding
  }

  export interface WatchOptions {
    recursive?: boolean
    persistent?: boolean
    encoding?: BufferEncoding
  }

  export interface FSWatcher {
    close(): void
    ref(): this
    unref(): this
  }

  export interface StatsInit {
    dev: number
    ino: number
    mode: number
    nlink: number
    uid: number
    gid: number
    rdev: number
    size: number
    blksize: number
    blocks: number
    atimeMs: number
    mtimeMs: number
    ctimeMs: number
    birthtimeMs: number
  }

  export class Stats {
    readonly dev: number
    readonly ino: number
    readonly mode: number
    readonly nlink: number
    readonly uid: number
    readonly gid: number
    readonly rdev: number
    readonly size: number
    readonly blksize: number
    readonly blocks: number
    readonly atimeMs: number
    readonly mtimeMs: number
    readonly ctimeMs: number
    readonly birthtimeMs: number
    readonly atime: Date
    readonly mtime: Date
    readonly ctime: Date
    readonly birthtime: Date
    constructor(init: StatsInit)
    isFile(): boolean
    isDirectory(): boolean
    isSymbolicLink(): boolean
    isBlockDevice(): boolean
    isCharacterDevice(): boolean
    isFIFO(): boolean
    isSocket(): boolean
  }

  export type DirentType = 'file' | 'directory' | 'symlink' | 'block' | 'character' | 'fifo' | 'socket'

  export class Dirent {
    readonly name: string
    readonly parentPath: string
    readonly path: string
    constructor(name: string, parentPath: string, type: DirentType)
    isFile(): boolean
    isDirectory(): boolean
    isSymbolicLink(): boolean
    isBlockDevice(): boolean
    isCharacterDevice(): boolean
    isFIFO(): boolean
    isSocket(): boolean
  }

  export interface StatsLike {
    dev: number
    ino: number
    mode: number
    nlink: number
    uid: number
    gid: number
    rdev: number
    size: number
    blksize: number
    blocks: number
    atime: Date
    mtime: Date
    ctime: Date
    birthtime: Date
    isFile(): boolean
    isDirectory(): boolean
    isSymbolicLink(): boolean
    isBlockDevice(): boolean
    isCharacterDevice(): boolean
    isFIFO(): boolean
    isSocket(): boolean
  }

  export class FileHandle {
    readonly fd: number
    constructor(fd: number, data: Uint8Array, stats: StatsLike)
    read(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: Uint8Array }>
    write(data: Uint8Array | string, position?: number): Promise<{ bytesWritten: number }>
    stat(): Promise<Stats>
    truncate(length?: number): Promise<void>
    sync(): Promise<void>
    close(): Promise<void>
    createReadStream(options?: ReadStreamOptions): ReadableStream<Uint8Array>
    createWriteStream(options?: WriteStreamOptions): WritableStream<Uint8Array>
  }

  export type StorageTier = 'hot' | 'warm' | 'cold'

  export interface FsCapability {
    read(path: string, options?: ReadOptions): Promise<string | Uint8Array>
    write(path: string, content: string | Uint8Array, options?: WriteOptions): Promise<void>
    append(path: string, content: string | Uint8Array): Promise<void>
    exists(path: string): Promise<boolean>
    unlink(path: string): Promise<void>
    rename(oldPath: string, newPath: string, options?: MoveOptions): Promise<void>
    copyFile(src: string, dest: string, options?: CopyOptions): Promise<void>
    truncate(path: string, length?: number): Promise<void>
    list(path: string, options?: ListOptions): Promise<string[] | Dirent[]>
    readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>
    mkdir(path: string, options?: MkdirOptions): Promise<void>
    rmdir(path: string, options?: RmdirOptions): Promise<void>
    rm(path: string, options?: RemoveOptions): Promise<void>
    stat(path: string): Promise<Stats>
    lstat(path: string): Promise<Stats>
    access(path: string, mode?: number): Promise<void>
    chmod(path: string, mode: number): Promise<void>
    chown(path: string, uid: number, gid: number): Promise<void>
    utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>
    symlink(target: string, path: string): Promise<void>
    link(existingPath: string, newPath: string): Promise<void>
    readlink(path: string): Promise<string>
    realpath(path: string): Promise<string>
    createReadStream(path: string, options?: ReadStreamOptions): Promise<ReadableStream<Uint8Array>>
    createWriteStream(path: string, options?: WriteStreamOptions): Promise<WritableStream<Uint8Array>>
    open(path: string, flags?: string | number, mode?: number): Promise<FileHandle>
    watch(path: string, options?: WatchOptions, listener?: (eventType: 'rename' | 'change', filename: string) => void): FSWatcher
    getTier?(path: string): Promise<StorageTier>
    promote?(path: string, tier: 'hot' | 'warm'): Promise<void>
    demote?(path: string, tier: 'warm' | 'cold'): Promise<void>
    transaction?<T>(fn: () => Promise<T>): Promise<T>
    writeMany?(files: Array<{ path: string; content: string | Uint8Array }>): Promise<void>
  }

  // Core FSx class and backend interface
  export interface FsBackend {
    readFile(path: string, options?: ReadOptions): Promise<Uint8Array | string>
    writeFile(path: string, data: Uint8Array | string, options?: WriteOptions): Promise<void>
    stat(path: string): Promise<Stats>
    lstat(path: string): Promise<Stats>
    readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>
    readlink(path: string): Promise<string>
    realpath(path: string): Promise<string>
    access(path: string, mode?: number): Promise<void>
    mkdir(path: string, options?: MkdirOptions): Promise<void>
    rmdir(path: string, options?: RmdirOptions): Promise<void>
    unlink(path: string): Promise<void>
    rename(oldPath: string, newPath: string): Promise<void>
    copyFile(src: string, dest: string): Promise<void>
    chmod(path: string, mode: number): Promise<void>
    chown(path: string, uid: number, gid: number): Promise<void>
    utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>
    symlink(target: string, path: string): Promise<void>
    link(existingPath: string, newPath: string): Promise<void>
  }

  export class MemoryBackend implements FsBackend {
    constructor()
    readFile(path: string, options?: ReadOptions): Promise<Uint8Array | string>
    writeFile(path: string, data: Uint8Array | string, options?: WriteOptions): Promise<void>
    stat(path: string): Promise<Stats>
    lstat(path: string): Promise<Stats>
    readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>
    readlink(path: string): Promise<string>
    realpath(path: string): Promise<string>
    access(path: string, mode?: number): Promise<void>
    mkdir(path: string, options?: MkdirOptions): Promise<void>
    rmdir(path: string, options?: RmdirOptions): Promise<void>
    unlink(path: string): Promise<void>
    rename(oldPath: string, newPath: string): Promise<void>
    copyFile(src: string, dest: string): Promise<void>
    chmod(path: string, mode: number): Promise<void>
    chown(path: string, uid: number, gid: number): Promise<void>
    utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>
    symlink(target: string, path: string): Promise<void>
    link(existingPath: string, newPath: string): Promise<void>
  }

  export interface FSxOptions {
    backend: FsBackend
    cwd?: string
  }

  export class FSx implements FsCapability {
    constructor(options: FSxOptions | FsBackend)
    read(path: string, options?: ReadOptions): Promise<string | Uint8Array>
    write(path: string, content: string | Uint8Array, options?: WriteOptions): Promise<void>
    append(path: string, content: string | Uint8Array): Promise<void>
    exists(path: string): Promise<boolean>
    unlink(path: string): Promise<void>
    rename(oldPath: string, newPath: string, options?: MoveOptions): Promise<void>
    copyFile(src: string, dest: string, options?: CopyOptions): Promise<void>
    truncate(path: string, length?: number): Promise<void>
    list(path: string, options?: ListOptions): Promise<string[] | Dirent[]>
    readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>
    mkdir(path: string, options?: MkdirOptions): Promise<void>
    rmdir(path: string, options?: RmdirOptions): Promise<void>
    rm(path: string, options?: RemoveOptions): Promise<void>
    stat(path: string): Promise<Stats>
    lstat(path: string): Promise<Stats>
    access(path: string, mode?: number): Promise<void>
    chmod(path: string, mode: number): Promise<void>
    chown(path: string, uid: number, gid: number): Promise<void>
    utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>
    symlink(target: string, path: string): Promise<void>
    link(existingPath: string, newPath: string): Promise<void>
    readlink(path: string): Promise<string>
    realpath(path: string): Promise<string>
    createReadStream(path: string, options?: ReadStreamOptions): Promise<ReadableStream<Uint8Array>>
    createWriteStream(path: string, options?: WriteStreamOptions): Promise<WritableStream<Uint8Array>>
    open(path: string, flags?: string | number, mode?: number): Promise<FileHandle>
    watch(path: string, options?: WatchOptions, listener?: (eventType: 'rename' | 'change', filename: string) => void): FSWatcher
  }
}
