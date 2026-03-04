import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { buildSync } from 'esbuild';

const PRELOAD_SOURCE = path.resolve(__dirname, 'electron/preload.ts');
const PRELOAD_OUTPUT = path.resolve(__dirname, 'dist-electron/preload.cjs');
const PRELOAD_WATCH_ROOTS = [
  path.resolve(__dirname, 'electron'),
  path.resolve(__dirname, 'shared'),
];
const PRELOAD_WATCH_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function compilePreload(): void {
  buildSync({
    entryPoints: [PRELOAD_SOURCE],
    outfile: PRELOAD_OUTPUT,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: false,
    external: ['electron'],
    logLevel: 'silent',
  });
}

function shouldRebuildPreload(file: string): boolean {
  const normalized = path.normalize(file);
  if (!PRELOAD_WATCH_EXTENSIONS.has(path.extname(normalized))) return false;

  return PRELOAD_WATCH_ROOTS.some((root) => {
    const relative = path.relative(root, normalized);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
}

// preload.ts を dist-electron/preload.cjs に変換するプラグイン
const buildPreloadPlugin = () => ({
  name: 'build-preload',
  buildStart() {
    compilePreload();
  },
  handleHotUpdate({ file }: { file: string }) {
    if (shouldRebuildPreload(file)) {
      compilePreload();
    }
  },
});

export default defineConfig({
  plugins: [
    react(),
    buildPreloadPlugin(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/main.ts',
              formats: ['es'],
            },
            rollupOptions: {
              external: ['electron', 'keytar', 'fluent-ffmpeg', 'openai'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
