// @ts-nocheck
/// <reference types="vite/client" />
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

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

export const site = await create.doc("site", "..", import.meta.glob(["./Site.mdx"], {
  "base": "./../..",
  "query": {
    "collection": "site"
  },
  "eager": true
}));