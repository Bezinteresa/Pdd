import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], server: { allowedHosts: ['terminal.local'] }, build: { target: 'es2022', chunkSizeWarningLimit: 650, rollupOptions: { output: { manualChunks: { three: ['three'], vue: ['vue'] } } } } });
