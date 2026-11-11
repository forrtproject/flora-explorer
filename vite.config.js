import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {cpSync} from 'node:fs';

// data/ is refreshed by scheduled workflows and fetched at runtime, so it is copied, not bundled.
const copyData = {
    name: 'copy-data',
    apply: 'build',
    closeBundle() { cpSync('data', 'dist/data', {recursive: true}); },
};

export default defineConfig({
    base: './',
    publicDir: false,
    plugins: [react(), copyData],
    build: {outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000},
});
