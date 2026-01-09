/// <reference types="vite/client" />
import { fromConfig } from 'fumadocs-mdx/runtime/vite';
import type * as Config from './source.config';

export const create = fromConfig<typeof Config>();

export const docs = create.doc("docs", "./.", import.meta.glob(["./**/*.{mdx,md}"], {
  "base": "./.",
  "query": {
    "collection": "docs"
  }
}));

export const meta = create.meta("meta", "./.", import.meta.glob(["./**/*.{json,yaml}"], {
  "import": "default",
  "base": "./.",
  "query": {
    "collection": "meta"
  }
}));