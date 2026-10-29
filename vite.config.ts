import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
// The Yandex Games build (`--mode yandex`) loads the platform SDK from the path the game host serves it at.
const yandexSdk: Plugin = { name: 'yandex-sdk', transformIndexHtml: () => [{ tag: 'script', attrs: { src: '/sdk.js' }, injectTo: 'head' }] };
// Relative asset paths let the build run from any folder of a static site, not only the domain root.
export default defineConfig(({ mode }) => ({ base: './', plugins: [vue(), ...(mode === 'yandex' ? [yandexSdk] : [])], server: { allowedHosts: ['terminal.local'] }, build: { target: 'es2022', chunkSizeWarningLimit: 650, rollupOptions: { output: { manualChunks: { three: ['three'], vue: ['vue'] } } } } }));
