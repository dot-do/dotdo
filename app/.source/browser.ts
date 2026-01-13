// @ts-nocheck
/// <reference types="vite/client" />
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  actions: create.doc("actions", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/actions",
    "query": {
      "collection": "actions"
    },
    "eager": false
  })),
  agents: create.doc("agents", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/agents",
    "query": {
      "collection": "agents"
    },
    "eager": false
  })),
  api: create.doc("api", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/api",
    "query": {
      "collection": "api"
    },
    "eager": false
  })),
  appContent: create.doc("appContent", import.meta.glob(["./App.mdx"], {
    "base": "./../..",
    "query": {
      "collection": "appContent"
    },
    "eager": false
  })),
  architecture: create.doc("architecture", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/architecture",
    "query": {
      "collection": "architecture"
    },
    "eager": false
  })),
  cli: create.doc("cli", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/cli",
    "query": {
      "collection": "cli"
    },
    "eager": false
  })),
  compat: create.doc("compat", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/compat",
    "query": {
      "collection": "compat"
    },
    "eager": false
  })),
  concepts: create.doc("concepts", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/concepts",
    "query": {
      "collection": "concepts"
    },
    "eager": false
  })),
  database: create.doc("database", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/database",
    "query": {
      "collection": "database"
    },
    "eager": false
  })),
  deployment: create.doc("deployment", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/deployment",
    "query": {
      "collection": "deployment"
    },
    "eager": false
  })),
  events: create.doc("events", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/events",
    "query": {
      "collection": "events"
    },
    "eager": false
  })),
  functions: create.doc("functions", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/functions",
    "query": {
      "collection": "functions"
    },
    "eager": false
  })),
  gettingStarted: create.doc("gettingStarted", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/getting-started",
    "query": {
      "collection": "gettingStarted"
    },
    "eager": false
  })),
  guides: create.doc("guides", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/guides",
    "query": {
      "collection": "guides"
    },
    "eager": false
  })),
  humans: create.doc("humans", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/humans",
    "query": {
      "collection": "humans"
    },
    "eager": false
  })),
  integrations: create.doc("integrations", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/integrations",
    "query": {
      "collection": "integrations"
    },
    "eager": false
  })),
  lib: create.doc("lib", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/lib",
    "query": {
      "collection": "lib"
    },
    "eager": false
  })),
  mcp: create.doc("mcp", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/mcp",
    "query": {
      "collection": "mcp"
    },
    "eager": false
  })),
  objects: create.doc("objects", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/objects",
    "query": {
      "collection": "objects"
    },
    "eager": false
  })),
  observability: create.doc("observability", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/observability",
    "query": {
      "collection": "observability"
    },
    "eager": false
  })),
  platform: create.doc("platform", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/platform",
    "query": {
      "collection": "platform"
    },
    "eager": false
  })),
  primitives: create.doc("primitives", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/primitives",
    "query": {
      "collection": "primitives"
    },
    "eager": false
  })),
  rpc: create.doc("rpc", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/rpc",
    "query": {
      "collection": "rpc"
    },
    "eager": false
  })),
  sdk: create.doc("sdk", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/sdk",
    "query": {
      "collection": "sdk"
    },
    "eager": false
  })),
  security: create.doc("security", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/security",
    "query": {
      "collection": "security"
    },
    "eager": false
  })),
  site: create.doc("site", import.meta.glob(["./Site.mdx"], {
    "base": "./../..",
    "query": {
      "collection": "site"
    },
    "eager": false
  })),
  storage: create.doc("storage", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/storage",
    "query": {
      "collection": "storage"
    },
    "eager": false
  })),
  transport: create.doc("transport", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/transport",
    "query": {
      "collection": "transport"
    },
    "eager": false
  })),
  ui: create.doc("ui", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/ui",
    "query": {
      "collection": "ui"
    },
    "eager": false
  })),
  workflows: create.doc("workflows", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/workflows",
    "query": {
      "collection": "workflows"
    },
    "eager": false
  })),
};
export default browserCollections;