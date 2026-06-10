import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  // node:sqlite is a Node 22+ built-in. Mark it external so tsup/esbuild
  // preserves the "node:" prefix in the output instead of stripping it.
  external: ['node:sqlite'],
  // @dave/shared is a workspace package with no build step (its exports point at
  // raw .ts) and it isn't installed in the pruned runtime image. tsup externalizes
  // `dependencies` by default, so it must be force-bundled — otherwise a runtime
  // (value) import of it leaves a live `import from "@dave/shared"` in the output
  // that fails with ERR_MODULE_NOT_FOUND in the container.
  noExternal: ['@dave/shared'],
  noSplitting: true,
  outDir: 'dist',
  clean: true,
});
