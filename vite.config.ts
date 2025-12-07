import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import fs from 'fs';

// preload.cjsをdist-electronにコピーするプラグイン
const copyPreloadPlugin = () => ({
  name: 'copy-preload',
  buildStart() {
    const src = path.resolve(__dirname, 'electron/preload.cjs');
    const dest = path.resolve(__dirname, 'dist-electron/preload.cjs');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  },
  handleHotUpdate({ file }: { file: string }) {
    if (file.endsWith('preload.cjs')) {
      const src = path.resolve(__dirname, 'electron/preload.cjs');
      const dest = path.resolve(__dirname, 'dist-electron/preload.cjs');
      fs.copyFileSync(src, dest);
    }
  },
});

export default defineConfig({
  plugins: [
    react(),
    copyPreloadPlugin(),
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
