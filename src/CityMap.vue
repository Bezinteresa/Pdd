<script setup lang="ts">
import { computed } from 'vue';
import type { CityLayout } from './game/city';

// Schema of the exam city (debug view and orientation aid): streets, the route to the next situation, the car.
const props = defineProps<{ city: CityLayout; pose: { x: number; z: number; heading: number }; route: string[]; target: string | null }>();
const streetWidth = { street: 6, avenue: 8, main: 8, tram: 10 } as const;
const routePoints = computed(() => props.route.map(id => props.city.nodes[id]).filter(Boolean).map(n => `${n.x},${n.z}`).join(' '));
const targetNode = computed(() => props.target ? props.city.nodes[props.target] : null);
const carTransform = computed(() => `translate(${props.pose.x} ${props.pose.z}) rotate(${props.pose.heading * 180 / Math.PI})`);
</script>

<template>
  <svg class="city-map" viewBox="-200 -200 400 400" role="img" aria-label="Схема города">
    <rect x="-200" y="-200" width="400" height="400" rx="16" fill="#e7ecdf" />
    <line v-for="e in city.edges" :key="e.id" :x1="city.nodes[e.a].x" :y1="city.nodes[e.a].z" :x2="city.nodes[e.b].x" :y2="city.nodes[e.b].z" :stroke="e.kind === 'main' ? '#e2c46a' : e.kind === 'tram' ? '#c99a8d' : '#a7b1a3'" :stroke-width="streetWidth[e.kind]" stroke-linecap="square" />
    <circle v-for="n in Object.values(city.nodes).filter(n => n.kind === 'signal')" :key="n.id" :cx="n.x" :cy="n.z" r="5" fill="#5f7f5a" />
    <polyline v-if="route.length > 1" :points="routePoints" fill="none" stroke="#2f8f4a" stroke-width="5" stroke-dasharray="10 6" stroke-linejoin="round" />
    <circle v-if="targetNode" :cx="targetNode.x" :cy="targetNode.z" r="11" fill="none" stroke="#d0662f" stroke-width="4" />
    <g :transform="carTransform"><path d="M0 -12 8 9 0 4 -8 9Z" fill="#1d3a2c" stroke="#fff" stroke-width="2" /></g>
  </svg>
</template>

<style scoped>
.city-map { width: 100%; height: auto; display: block; }
</style>
