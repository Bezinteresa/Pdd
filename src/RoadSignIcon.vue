<script setup lang="ts">
import type { SignCode } from './game/signs';

// Flat sign pictures for the HUD, matching the 3D sign textures.
defineProps<{ code: SignCode; value?: number }>();
</script>

<template>
  <svg class="sign-icon" viewBox="0 0 100 100" role="img" :aria-label="`Знак ${code}`">
    <template v-if="code === '3.24'">
      <circle cx="50" cy="50" r="47" fill="#c8302a" /><circle cx="50" cy="50" r="36" fill="#fff" />
      <text x="50" y="51" text-anchor="middle" dominant-baseline="central" font-size="36" font-weight="700" fill="#1d2120">{{ value }}</text>
    </template>
    <template v-else-if="code === '2.5'">
      <path d="M31 4H69L96 31V69L69 96H31L4 69V31Z" fill="#c8302a" stroke="#fff" stroke-width="4" />
      <text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-size="26" font-weight="700" fill="#fff">STOP</text>
    </template>
    <template v-else-if="code === '2.4'">
      <path d="M4 10H96L50 94Z" fill="#c8302a" stroke-linejoin="round" /><path d="M20 19H80L50 74Z" fill="#fff" />
    </template>
    <template v-else-if="code === '2.1'">
      <path d="M50 3 97 50 50 97 3 50Z" fill="#fff" /><path d="M50 15 85 50 50 85 15 50Z" fill="#f1c232" />
    </template>
    <template v-else-if="code === '1.5'">
      <path d="M50 5 96 90H4Z" fill="#c8302a" stroke-linejoin="round" /><path d="M50 22 82 81H18Z" fill="#fff" />
      <rect x="34" y="50" width="32" height="24" fill="#1d2120" /><rect x="37" y="54" width="11" height="8" fill="#fff" /><rect x="52" y="54" width="11" height="8" fill="#fff" /><path d="M49 50V43M42 42H58" stroke="#1d2120" stroke-width="2.5" />
    </template>
    <template v-else-if="code === '5.19.1'">
      <rect x="3" y="3" width="94" height="94" rx="6" fill="#1f5fbf" /><path d="M50 13 88 86H12Z" fill="#fff" />
      <circle cx="54" cy="40" r="5.5" fill="#1d2120" /><path d="M52 48 47 63 39 77M47 63 57 77M51 52 41 59M51 52 61 58" stroke="#1d2120" stroke-width="4.5" stroke-linecap="round" fill="none" />
    </template>
  </svg>
</template>

<style scoped>
.sign-icon { width: 100%; height: 100%; display: block; filter: drop-shadow(0 2px 4px #0003); }
</style>
