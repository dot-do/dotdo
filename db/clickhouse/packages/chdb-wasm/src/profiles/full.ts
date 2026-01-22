// Full profile entry point (~20MB gzipped)
// All features for maximum compatibility

export { createChdb } from '../chdb';
export type * from '../types';

export const profile = {
  name: 'full',
  targetSize: '20MB',
  features: {
    engines: 'All supported',
    formats: 'All supported',
    functions: 'All supported including window functions',
    sql: 'Full SQL compatibility',
  },
};

export { createChdb as default } from '../chdb';
