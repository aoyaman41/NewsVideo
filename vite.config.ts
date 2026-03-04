import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import fs from 'fs';
import { transformSync } from 'esbuild';

const PRELOAD_SOURCE = path.resolve(__dirname, 'electron/preload.ts');
const PRELOAD_OUTPUT = path.resolve(__dirname, 'dist-electron/preload.cjs');

function compilePreload(): void {
  const source = fs.readFileSync(PRELOAD_SOURCE, 'utf-8');
  const { code } = transformSync(source, {
    loader: 'ts',
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: false,
  });

  fs.mkdirSync(path.dirname(PRELOAD_OUTPUT), { recursive: true });
  fs.writeFileSync(PRELOAD_OUTPUT, code, 'utf-8');
}

// preload.ts を dist-electron/preload.cjs に変換するプラグイン
const buildPreloadPlugin = () => ({
  name: 'build-preload',
  buildStart() {
    compilePreload();
  },
  handleHotUpdate({ file }: { file: string }) {
    const normalized = path.normalize(file);
    if (normalized === path.normalize(PRELOAD_SOURCE)) {
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
