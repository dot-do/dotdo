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
  appContent: create.doc("appContent", import.meta.glob(["./App.mdx"], {
    "base": "./../..",
    "query": {
      "collection": "appContent"
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
  site: create.doc("site", import.meta.glob(["./Site.mdx"], {
    "base": "./../..",
    "query": {
      "collection": "site"
    },
    "eager": false
  })),
};
export default browserCollections;