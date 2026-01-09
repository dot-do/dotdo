/**
 * TypeScript declarations for WASM module imports
 */

declare module '*.wasm' {
  const wasmModule: WebAssembly.Module
  export default wasmModule
}
