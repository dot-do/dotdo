/**
 * Memory-backed DurableObjectStub mock
 *
 * This module provides a mock DurableObjectStub implementation that uses
 * MemoryBackend for filesystem operations. Used for SDK singleton initialization
 * and testing scenarios where a real Durable Object is not available.
 *
 * @internal This module is not part of the public API
 * @module
 */

import type { MemoryBackend } from '../core/backend.js'

/**
 * Parameters for RPC method calls
 */
interface MethodParams {
  path?: string
  oldPath?: string
  newPath?: string
  existingPath?: string
  src?: string
  dest?: string
  target?: string
  data?: string
  encoding?: string
  mode?: number
  recursive?: boolean
  force?: boolean
  withFileTypes?: boolean
  uid?: number
  gid?: number
  atime?: number
  mtime?: number
  length?: number
}

/**
 * Error response from method handlers
 */
interface MethodError {
  code: string
  message: string
  path?: string
}

/**
 * Create a mock DurableObjectStub that wraps a MemoryBackend.
 *
 * This enables SDK-style usage without requiring a real Durable Object binding.
 * The stub simulates the RPC protocol used by FSx to communicate with FileSystemDO.
 *
 * @param backend - The MemoryBackend to use for filesystem operations
 * @returns A mock DurableObjectStub that forwards calls to the backend
 *
 * @example
 * ```typescript
 * const backend = new MemoryBackend()
 * const stub = createMemoryStub(backend)
 * const fs = new FSx(stub)
 * ```
 *
 * @internal
 */
export function createMemoryStub(backend: MemoryBackend): DurableObjectStub {
  const stub: Pick<DurableObjectStub, 'fetch'> = {
    async fetch(url: string, init?: RequestInit): Promise<Response> {
      if (init?.method !== 'POST' || !init.body) {
        return new Response('Not found', { status: 404 })
      }

      const body = JSON.parse(init.body as string) as { method: string; params: MethodParams }
      const { method, params } = body

      try {
        const result = await handleMethod(backend, method, params)
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error: unknown) {
        const err = error as Error & MethodError
        return new Response(
          JSON.stringify({
            code: err.code ?? 'UNKNOWN',
            message: err.message,
            path: err.path,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }
    },
  }

  return stub as unknown as DurableObjectStub
}

/**
 * Handle individual RPC method calls by delegating to the backend.
 *
 * @param backend - The MemoryBackend instance
 * @param method - The method name to invoke
 * @param params - The parameters for the method
 * @returns The result of the method call
 * @throws Error with code/message/path for filesystem errors
 *
 * @internal
 */
async function handleMethod(
  backend: MemoryBackend,
  method: string,
  params: MethodParams
): Promise<unknown> {
  switch (method) {
    case 'readFile': {
      const path = params.path!
      const data = await backend.readFile(path)
      let binary = ''
      for (const byte of data) {
        binary += String.fromCharCode(byte)
      }
      return { data: btoa(binary), encoding: 'base64' }
    }

    case 'writeFile': {
      const path = params.path!
      const data = params.data!
      const encoding = params.encoding!
      const mode = params.mode

      let bytes: Uint8Array
      if (encoding === 'base64') {
        const binary = atob(data)
        bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
      } else {
        bytes = new TextEncoder().encode(data)
      }

      await backend.writeFile(path, bytes, { mode })
      return {}
    }

    case 'unlink': {
      const path = params.path!
      await backend.unlink(path)
      return {}
    }

    case 'rename': {
      const oldPath = params.oldPath!
      const newPath = params.newPath!
      await backend.rename(oldPath, newPath)
      return {}
    }

    case 'copyFile': {
      const src = params.src!
      const dest = params.dest!
      await backend.copyFile(src, dest)
      return {}
    }

    case 'mkdir': {
      const path = params.path!
      const recursive = params.recursive ?? false
      const mode = params.mode
      await backend.mkdir(path, { recursive, mode })
      return {}
    }

    case 'rmdir': {
      const path = params.path!
      const recursive = params.recursive ?? false
      await backend.rmdir(path, { recursive })
      return {}
    }

    case 'rm': {
      const path = params.path!
      const recursive = params.recursive ?? false
      const force = params.force ?? false

      if (force) {
        try {
          const exists = await backend.exists(path)
          if (!exists) return {}
        } catch {
          return {}
        }
      }

      const stat = await backend.stat(path)
      if (stat.isDirectory()) {
        await backend.rmdir(path, { recursive })
      } else {
        await backend.unlink(path)
      }
      return {}
    }

    case 'readdir': {
      const path = params.path!
      const withFileTypes = params.withFileTypes ?? false
      const entries = await backend.readdir(path, { withFileTypes })
      return entries
    }

    case 'stat':
    case 'lstat': {
      const path = params.path!
      const stats = await backend.stat(path)
      return {
        dev: stats.dev,
        ino: stats.ino,
        mode: stats.mode,
        nlink: stats.nlink,
        uid: stats.uid,
        gid: stats.gid,
        rdev: stats.rdev,
        size: stats.size,
        blksize: stats.blksize,
        blocks: stats.blocks,
        atime: stats.atimeMs,
        mtime: stats.mtimeMs,
        ctime: stats.ctimeMs,
        birthtime: stats.birthtimeMs,
      }
    }

    case 'access': {
      const path = params.path!
      const exists = await backend.exists(path)
      if (!exists) {
        throw { code: 'ENOENT', message: 'no such file or directory', path }
      }
      return {}
    }

    case 'chmod': {
      const path = params.path!
      const mode = params.mode!
      await backend.chmod(path, mode)
      return {}
    }

    case 'chown': {
      const path = params.path!
      const uid = params.uid!
      const gid = params.gid!
      await backend.chown(path, uid, gid)
      return {}
    }

    case 'utimes': {
      const path = params.path!
      const atime = params.atime!
      const mtime = params.mtime!
      await backend.utimes(path, atime, mtime)
      return {}
    }

    case 'symlink': {
      const target = params.target!
      const path = params.path!
      await backend.symlink(target, path)
      return {}
    }

    case 'link': {
      const existingPath = params.existingPath!
      const newPath = params.newPath!
      await backend.link(existingPath, newPath)
      return {}
    }

    case 'readlink': {
      const path = params.path!
      const target = await backend.readlink(path)
      return target
    }

    case 'realpath': {
      const path = params.path!
      const exists = await backend.exists(path)
      if (!exists) {
        throw { code: 'ENOENT', message: 'no such file or directory', path }
      }
      return path
    }

    case 'truncate': {
      const path = params.path!
      const length = params.length ?? 0
      const data = await backend.readFile(path)
      const truncated = data.slice(0, length)
      await backend.writeFile(path, truncated)
      return {}
    }

    case 'open': {
      // Return a simple fd for compatibility
      return 1
    }

    default:
      throw new Error(`Unknown method: ${method}`)
  }
}
