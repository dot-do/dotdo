// @ts-nocheck
/// <reference types="vite/client" />
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const actions = await create.docs("actions", "../docs/actions", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/actions",
  "query": {
    "collection": "actions"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/actions",
  "query": {
    "collection": "actions"
  },
  "eager": true
}));

export const agents = await create.docs("agents", "../docs/agents", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/agents",
  "query": {
    "collection": "agents"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/agents",
  "query": {
    "collection": "agents"
  },
  "eager": true
}));

export const api = await create.docs("api", "../docs/api", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/api",
  "query": {
    "collection": "api"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/api",
  "query": {
    "collection": "api"
  },
  "eager": true
}));

export const appContent = await create.doc("appContent", "..", import.meta.glob(["./App.mdx"], {
  "base": "./../..",
  "query": {
    "collection": "appContent"
  },
  "eager": true
}));

export const architecture = await create.docs("architecture", "../docs/architecture", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/architecture",
  "query": {
    "collection": "architecture"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/architecture",
  "query": {
    "collection": "architecture"
  },
  "eager": true
}));

export const cli = await create.docs("cli", "../docs/cli", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/cli",
  "query": {
    "collection": "cli"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/cli",
  "query": {
    "collection": "cli"
  },
  "eager": true
}));

export const compat = await create.docs("compat", "../docs/compat", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/compat",
  "query": {
    "collection": "compat"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/compat",
  "query": {
    "collection": "compat"
  },
  "eager": true
}));

export const concepts = await create.docs("concepts", "../docs/concepts", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/concepts",
  "query": {
    "collection": "concepts"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/concepts",
  "query": {
    "collection": "concepts"
  },
  "eager": true
}));

export const database = await create.docs("database", "../docs/database", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/database",
  "query": {
    "collection": "database"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/database",
  "query": {
    "collection": "database"
  },
  "eager": true
}));

export const deployment = await create.docs("deployment", "../docs/deployment", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/deployment",
  "query": {
    "collection": "deployment"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/deployment",
  "query": {
    "collection": "deployment"
  },
  "eager": true
}));

export const events = await create.docs("events", "../docs/events", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/events",
  "query": {
    "collection": "events"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/events",
  "query": {
    "collection": "events"
  },
  "eager": true
}));

export const functions = await create.docs("functions", "../docs/functions", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/functions",
  "query": {
    "collection": "functions"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/functions",
  "query": {
    "collection": "functions"
  },
  "eager": true
}));

export const gettingStarted = await create.docs("gettingStarted", "../docs/getting-started", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/getting-started",
  "query": {
    "collection": "gettingStarted"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/getting-started",
  "query": {
    "collection": "gettingStarted"
  },
  "eager": true
}));

export const guides = await create.docs("guides", "../docs/guides", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/guides",
  "query": {
    "collection": "guides"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/guides",
  "query": {
    "collection": "guides"
  },
  "eager": true
}));

export const humans = await create.docs("humans", "../docs/humans", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/humans",
  "query": {
    "collection": "humans"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/humans",
  "query": {
    "collection": "humans"
  },
  "eager": true
}));

export const integrations = await create.docs("integrations", "../docs/integrations", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/integrations",
  "query": {
    "collection": "integrations"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/integrations",
  "query": {
    "collection": "integrations"
  },
  "eager": true
}));

export const lib = await create.docs("lib", "../docs/lib", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/lib",
  "query": {
    "collection": "lib"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/lib",
  "query": {
    "collection": "lib"
  },
  "eager": true
}));

export const mcp = await create.docs("mcp", "../docs/mcp", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/mcp",
  "query": {
    "collection": "mcp"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/mcp",
  "query": {
    "collection": "mcp"
  },
  "eager": true
}));

export const objects = await create.docs("objects", "../docs/objects", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/objects",
  "query": {
    "collection": "objects"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/objects",
  "query": {
    "collection": "objects"
  },
  "eager": true
}));

export const observability = await create.docs("observability", "../docs/observability", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/observability",
  "query": {
    "collection": "observability"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/observability",
  "query": {
    "collection": "observability"
  },
  "eager": true
}));

export const platform = await create.docs("platform", "../docs/platform", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/platform",
  "query": {
    "collection": "platform"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/platform",
  "query": {
    "collection": "platform"
  },
  "eager": true
}));

export const primitives = await create.docs("primitives", "../docs/primitives", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/primitives",
  "query": {
    "collection": "primitives"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/primitives",
  "query": {
    "collection": "primitives"
  },
  "eager": true
}));

export const rpc = await create.docs("rpc", "../docs/rpc", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/rpc",
  "query": {
    "collection": "rpc"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/rpc",
  "query": {
    "collection": "rpc"
  },
  "eager": true
}));

export const sdk = await create.docs("sdk", "../docs/sdk", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/sdk",
  "query": {
    "collection": "sdk"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/sdk",
  "query": {
    "collection": "sdk"
  },
  "eager": true
}));

export const security = await create.docs("security", "../docs/security", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/security",
  "query": {
    "collection": "security"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/security",
  "query": {
    "collection": "security"
  },
  "eager": true
}));

export const site = await create.doc("site", "..", import.meta.glob(["./Site.mdx"], {
  "base": "./../..",
  "query": {
    "collection": "site"
  },
  "eager": true
}));

export const storage = await create.docs("storage", "../docs/storage", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/storage",
  "query": {
    "collection": "storage"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/storage",
  "query": {
    "collection": "storage"
  },
  "eager": true
}));

export const transport = await create.docs("transport", "../docs/transport", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/transport",
  "query": {
    "collection": "transport"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/transport",
  "query": {
    "collection": "transport"
  },
  "eager": true
}));

export const ui = await create.docs("ui", "../docs/ui", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/ui",
  "query": {
    "collection": "ui"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/ui",
  "query": {
    "collection": "ui"
  },
  "eager": true
}));

export const workflows = await create.docs("workflows", "../docs/workflows", import.meta.glob(["./**/*.{json,yaml}"], {
  "base": "./../../docs/workflows",
  "query": {
    "collection": "workflows"
  },
  "import": "default",
  "eager": true
}), import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./../../docs/workflows",
  "query": {
    "collection": "workflows"
  },
  "eager": true
}));