import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
// The Yandex Games build (`--mode yandex`) loads the platform SDK from the path the game host serves it at.
const yandexSdk: Plugin = { name: 'yandex-sdk', transformIndexHtml: () => [{ tag: 'script', attrs: { src: '/sdk.js' }, injectTo: 'head' }] };
// Game catalogues open games in older in-app browsers too, so the yandex build is transpiled down to ES2019.
// Relative asset paths let the build run from any folder of a static site, not only the domain root.
export default defineConfig(({ mode }) => ({ base: './', plugins: [vue(), ...(mode === 'yandex' ? [yandexSdk] : [])], server: { allowedHosts: ['terminal.local'] }, build: { target: mode === 'yandex' ? 'es2019' : 'es2022', chunkSizeWarningLimit: 650, rollupOptions: { output: { manualChunks: { three: ['three'], vue: ['vue'] } } } } }));
