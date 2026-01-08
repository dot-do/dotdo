import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

describe('TanStack Start + Fumadocs Build', () => {
  describe('source.config.ts', () => {
    it('should exist at project root', () => {
      expect(existsSync('source.config.ts')).toBe(true);
    });

    it('should define docs collection', async () => {
      const content = await readFile('source.config.ts', 'utf-8');
      expect(content).toContain('defineDocs');
      expect(content).toContain("dir: 'docs'");
    });
  });

  describe('app/routes/__root.tsx', () => {
    it('should exist', () => {
      expect(existsSync('app/routes/__root.tsx')).toBe(true);
    });

    it('should use RootProvider from fumadocs-ui/provider/tanstack', async () => {
      const content = await readFile('app/routes/__root.tsx', 'utf-8');
      expect(content).toContain("fumadocs-ui/provider/tanstack");
      expect(content).toContain('RootProvider');
    });
  });

  describe('app/routes/docs/$.tsx', () => {
    it('should exist as catch-all docs route', () => {
      expect(existsSync('app/routes/docs/$.tsx')).toBe(true);
    });

    it('should use DocsLayout from fumadocs-ui', async () => {
      const content = await readFile('app/routes/docs/$.tsx', 'utf-8');
      expect(content).toContain('DocsLayout');
      expect(content).toContain('fumadocs-ui');
    });
  });

  describe('app/lib/source.ts', () => {
    it('should exist with fumadocs source loader', () => {
      expect(existsSync('app/lib/source.ts')).toBe(true);
    });
  });

  describe('app/styles/app.css', () => {
    it('should import fumadocs CSS presets', async () => {
      expect(existsSync('app/styles/app.css')).toBe(true);
      const content = await readFile('app/styles/app.css', 'utf-8');
      expect(content).toContain('fumadocs-ui/css');
    });
  });
});
