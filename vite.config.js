import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {cpSync, createReadStream, existsSync, statSync} from 'node:fs';
import {join, normalize} from 'node:path';

// data/ is rewritten by scheduled workflows and fetched at runtime, so it is served and copied, never bundled.
const liveData = {
    name: 'live-data',
    configureServer(server) {
        server.middlewares.use('/data', (req, res, next) => {
            const file = join('data', normalize(decodeURIComponent(req.url.split('?')[0])));
            if (!file.startsWith('data') || !existsSync(file) || !statSync(file).isFile()) return next();
            res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/csv; charset=utf-8');
            createReadStream(file).pipe(res);
        });
    },
    closeBundle() { cpSync('data', 'dist/data', {recursive: true}); },
};

export default defineConfig({
    base: './',
    plugins: [react(), liveData],
    build: {outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500},
});
