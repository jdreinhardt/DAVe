import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  // node:sqlite is a Node 22+ built-in. Mark it external so tsup/esbuild
  // preserves the "node:" prefix in the output instead of stripping it.
  external: ['node:sqlite'],
  noSplitting: true,
  outDir: 'dist',
  clean: true,
});
