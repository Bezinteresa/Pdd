<script setup lang="ts">
import { computed } from 'vue';
import type { Schema } from './game/exam';

// Top view in the learner's frame: the learner always enters from the bottom; others are drawn relative to that.
const props = defineProps<{ schema: Schema }>();
const playerPath = computed(() => props.schema.laneChange ? 'M114 196 L114 140 Q114 112 86 96 L86 8' : ({
  straight: 'M114 196 L114 8',
  right: 'M114 196 L114 142 Q114 114 142 114 L194 114',
  left: 'M114 196 L114 128 Q114 86 72 86 L6 86',
  uturn: 'M114 196 L114 74 Q114 42 100 42 Q86 42 86 74 L86 196',
}[props.schema.player]));
const actorPath = (from: string) => ({ N: 'M86 6 L86 194', E: 'M194 86 L6 86', W: 'M6 114 L194 114', S: 'M114 194 L114 6' } as Record<string, string>)[from];
const signs = computed(() => props.schema.signs ?? []);
</script>

<template>
  <svg class="schema" viewBox="0 0 200 200" role="img" aria-label="Схема ситуации, вид сверху">
    <defs>
      <marker id="arrow-player" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="#2f8f4a" /></marker>
      <marker id="arrow-other" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="#d0662f" /></marker>
    </defs>
    <rect width="200" height="200" fill="#cfdcc4" />
    <rect v-if="schema.junction !== 'T'" x="72" y="0" width="56" height="200" fill="#5f6b64" />
    <rect v-else x="72" y="100" width="56" height="100" fill="#5f6b64" />
    <rect v-if="schema.junction !== 'road'" x="0" y="72" width="200" height="56" fill="#5f6b64" />
    <path v-if="schema.junction !== 'T'" d="M100 0V60M100 140V200" stroke="#e8dfbe" stroke-width="1.5" stroke-dasharray="7 6" />
    <path v-else d="M100 140V200" stroke="#e8dfbe" stroke-width="1.5" stroke-dasharray="7 6" />
    <path v-if="schema.junction !== 'road'" d="M0 100H60M140 100H200" stroke="#e8dfbe" stroke-width="1.5" stroke-dasharray="7 6" />
    <rect v-if="schema.light || signs.includes('2.5')" x="100" y="134" width="28" height="3" fill="#f2eddb" />
    <template v-for="(actor, i) in schema.actors" :key="i">
      <g v-if="actor.kind === 'pedestrian' && schema.junction === 'road'">
        <rect v-for="k in 6" :key="k" :x="68 + k * 8" y="52" width="4" height="16" fill="#f2eddb" />
        <circle cx="140" cy="60" r="5" fill="#d0662f" /><path d="M132 60H104" stroke="#d0662f" stroke-width="3" marker-end="url(#arrow-other)" />
      </g>
      <g v-else-if="actor.kind === 'pedestrian'">
        <rect v-for="k in 6" :key="k" x="146" :y="70 + k * 8" width="12" height="4" fill="#f2eddb" />
        <circle cx="152" cy="92" r="5" fill="#d0662f" /><path d="M152 100V118" stroke="#d0662f" stroke-width="3" marker-end="url(#arrow-other)" />
      </g>
      <g v-else-if="actor.kind === 'tram'">
        <path d="M0 97H200M0 103H200" stroke="#a9b1aa" stroke-width="1.2" />
        <rect x="10" y="94" width="58" height="12" rx="3" fill="#d24d3c" /><path d="M72 100H118" stroke="#d0662f" stroke-width="3" marker-end="url(#arrow-other)" />
      </g>
      <g v-else>
        <path :d="schema.laneChange ? 'M86 194 L86 6' : actorPath(actor.from)" stroke="#d0662f" stroke-width="3" fill="none" stroke-dasharray="1 0" marker-end="url(#arrow-other)" />
        <rect :x="schema.laneChange ? 80 : actor.from === 'N' ? 80 : actor.from === 'E' ? 168 : 14" :y="schema.laneChange ? 150 : actor.from === 'N' ? 14 : actor.from === 'E' ? 80 : 108" :width="actor.from === 'N' || schema.laneChange ? 12 : 20" :height="actor.from === 'N' || schema.laneChange ? 20 : 12" rx="2" fill="#d0662f" />
      </g>
    </template>
    <path :d="playerPath" stroke="#2f8f4a" stroke-width="4" fill="none" marker-end="url(#arrow-player)" />
    <rect x="108" y="168" width="12" height="20" rx="2" fill="#2f8f4a" />
    <g v-if="schema.regulator"><circle cx="100" cy="100" r="9" fill="#2f3f5c" /><circle cx="100" cy="100" r="4" fill="#c9f24d" /></g>
    <g v-if="schema.light" transform="translate(134 140)"><rect width="10" height="24" rx="2" fill="#24332c" /><circle cx="5" cy="5" r="2.6" fill="#ff5a45" /><circle cx="5" cy="12" r="2.6" fill="#57604f" /><circle cx="5" cy="19" r="2.6" fill="#8dff7a" /></g>
    <g v-if="signs.includes('2.4')" transform="translate(134 142)"><path d="M0 0H20L10 17Z" fill="#c8302a" /><path d="M4 2.5H16L10 12.5Z" fill="#fff" /></g>
    <g v-if="signs.includes('2.5')" transform="translate(144 152)"><path d="M-4 -10H4L10 -4V4L4 10H-4L-10 4V-4Z" fill="#c8302a" /><text y="2.5" text-anchor="middle" font-size="5.5" font-weight="700" fill="#fff">STOP</text></g>
  </svg>
</template>

<style scoped>
.schema { width: 100%; height: auto; display: block; border-radius: 8px; }
</style>
