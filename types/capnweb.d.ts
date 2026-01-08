declare module 'capnweb' {
  export type RpcPromise<T> = Promise<T>
  export interface RpcTarget {
    [key: string]: unknown
  }
}
