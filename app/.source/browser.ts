// @ts-nocheck
/// <reference types="vite/client" />
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  api: create.doc("api", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/api",
    "query": {
      "collection": "api"
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
  gettingStarted: create.doc("gettingStarted", import.meta.glob(["./**/*.{mdx,md}"], {
    "base": "./../../docs/getting-started",
    "query": {
      "collection": "gettingStarted"
    },
    "eager": false
  })),
};
export default browserCollections;