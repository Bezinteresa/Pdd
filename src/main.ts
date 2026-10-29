import { createApp } from 'vue';
import App from './App.vue';
// Golos Text ships with the build: no request to Google Fonts (blocked by the CSP of game catalogues).
import '@fontsource-variable/golos-text';
import './style.css';
import { enableDragScroll } from './dragScroll';
createApp(App).mount('#app');
enableDragScroll();
