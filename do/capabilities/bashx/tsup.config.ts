import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'do/index': 'src/do/index.ts',
    'db/index': 'src/db/index.ts',
    'mcp/index': 'src/mcp/index.ts',
    'safety/index': 'src/safety/index.ts',
    'ast/index': 'src/ast/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  external: ['rpc.do', 'mcp.do', 'drizzle-orm', 'cloudflare:workers'],
})
