/**
 * Type stub for fsx.do module
 * Used during build when fsx.do package is not available
 */
declare module 'fsx.do' {
  export interface ReadOptions {
    encoding?: 'utf8' | 'binary'
  }

  export interface WriteOptions {
    encoding?: 'utf8' | 'binary'
    createDir?: boolean
  }

  export interface MkdirOptions {
    recursive?: boolean
  }

  export interface Stats {
    isFile(): boolean
    isDirectory(): boolean
    size: number
    mtime: Date
    ctime: Date
  }

  export interface Dirent {
    name: string
    isFile(): boolean
    isDirectory(): boolean
  }

  export type StorageTier = 'hot' | 'warm' | 'cold' | 'archive'

  export interface FsCapability {
    read(path: string, options?: ReadOptions): Promise<string>
    write(path: string, content: string, options?: WriteOptions): Promise<void>
    exists(path: string): Promise<boolean>
    delete(path: string): Promise<void>
    list(path: string): Promise<Dirent[]>
    mkdir(path: string, options?: MkdirOptions): Promise<void>
    stat(path: string): Promise<Stats>
    copy(from: string, to: string): Promise<void>
    move(from: string, to: string): Promise<void>
  }
}
