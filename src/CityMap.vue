<script setup lang="ts">
import { computed } from 'vue';
import type { CityLayout } from './game/city';

// Schema of the exam city (debug view and orientation aid): streets, the route to the next situation, the car.
const props = defineProps<{ city: CityLayout; pose: { x: number; z: number; heading: number }; route: string[]; target: string | null }>();
const streetWidth = { street: 8, avenue: 11, main: 11, tram: 13, ring: 12 } as const;
const streetColor = { street: '#a7b1a3', avenue: '#a7b1a3', main: '#e2c46a', tram: '#c99a8d', ring: '#8fb3d9' } as const;
const routePoints = computed(() => props.route.map(id => props.city.nodes[id]).filter(Boolean).map(n => `${n.x},${n.z}`).join(' '));
const targetNode = computed(() => props.target ? props.city.nodes[props.target] : null);
const carTransform = computed(() => `translate(${props.pose.x} ${props.pose.z}) rotate(${props.pose.heading * 180 / Math.PI})`);
</script>

<template>
  <svg class="city-map" viewBox="-385 -385 770 770" role="img" aria-label="Схема города">
    <rect x="-385" y="-385" width="770" height="770" rx="24" fill="#e7ecdf" />
    <rect v-for="p in city.plateaus" :key="p.x" :x="p.x - p.halfX - 14" :y="p.z - p.halfZ - 14" :width="p.halfX * 2 + 28" :height="p.halfZ * 2 + 28" rx="18" fill="#cfe0b8" />
    <line v-for="e in city.edges" :key="e.id" :x1="city.nodes[e.a].x" :y1="city.nodes[e.a].z" :x2="city.nodes[e.b].x" :y2="city.nodes[e.b].z" :stroke="streetColor[e.kind]" :stroke-width="streetWidth[e.kind]" stroke-linecap="square" />
    <circle v-for="n in Object.values(city.nodes).filter(n => n.kind === 'signal')" :key="n.id" :cx="n.x" :cy="n.z" r="8" fill="#5f7f5a" />
    <text v-for="p in city.plateaus" :key="`t${p.x}`" :x="p.x" :y="p.z - p.halfZ - 22" text-anchor="middle" font-size="26" font-weight="700" fill="#5f7f5a">Верхний город</text>
    <polyline v-if="route.length > 1" :points="routePoints" fill="none" stroke="#2f8f4a" stroke-width="8" stroke-dasharray="16 10" stroke-linejoin="round" />
    <circle v-if="targetNode" :cx="targetNode.x" :cy="targetNode.z" r="18" fill="none" stroke="#d0662f" stroke-width="7" />
    <g :transform="carTransform"><path d="M0 -22 15 17 0 8 -15 17Z" fill="#1d3a2c" stroke="#fff" stroke-width="3.5" /></g>
  </svg>
</template>

<style scoped>
.city-map { width: 100%; height: auto; display: block; }
</style>
