<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string> = {
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9Z',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5-2 5 5',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  ticket: 'M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6ZM10 9h4m-4 3h4m-4 3h4',
  sign: 'M12 2 22 12 12 22 2 12ZM12 22v0',
  drive: 'M4 16V9l2-5h12l2 5v7M4 10h16M7 14h2m6 0h2M5 16v3m14-3v3M9 5l-1 5m7-5 1 5',
  book: 'M12 5v15M3 4h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z',
  chart: 'M4 20h17M7 16v-5m6 5V5m6 11V9',
  gear: 'm9 3-.6 2.2-2 .8-2-.9-2 3.5 1.5 1.6-.2 2.2L2 14l2 3.5 2.2-.5 1.8 1.3L9 21h4l.6-2.2 2-.8 2 .9 2-3.5-1.5-1.6.2-2.2L21 10l-2-3.5-2.2.5L15 5.7 14 3Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  left: 'M19 12H5m6-6-6 6 6 6',
  play: 'm9 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  reset: 'M4 10a8 8 0 1 1 0 5M4 4v6h6',
  check: 'm5 12 4 4L19 6',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  belt: 'm4 3 16 18M5 15l3-7 4 2 2 8m-7-3 11-8M6 21v-3m11 3v-3M12 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  brake: 'M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0M10 15V9h3a1.5 1.5 0 0 1 0 3h-3',
  mirror: 'M3 7h18v9H3ZM12 16v4m-4 0h8',
  help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  full: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  flag: 'M5 21V3m0 0h14l-3 4 3 4H5',
  close: 'm6 6 12 12M6 18 18 6',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  hazard: 'm12 3 10 18H2ZM12 9v5m0 3v.1',
  pin: 'M12 22s8-8 8-14a8 8 0 1 0-16 0c0 6 8 14 8 14ZM15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
};
</script>
<template><svg :width="size || 20" :height="size || 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.drive" /></svg></template>
