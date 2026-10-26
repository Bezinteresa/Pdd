import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
// Relative asset paths let the build run from any folder of a static site, not only the domain root.
export default defineConfig({ base: './', plugins: [vue()], server: { allowedHosts: ['terminal.local'] }, build: { target: 'es2022', chunkSizeWarningLimit: 650, rollupOptions: { output: { manualChunks: { three: ['three'], vue: ['vue'] } } } } });
