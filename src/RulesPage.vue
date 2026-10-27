<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import Icon from './Icon.vue';
import RoadSignIcon from './RoadSignIcon.vue';
import { citing } from './game/tickets';
import { signCatalog, type SignCode } from './game/signs';
import { findPoint, loadPdd, type PddData, type TicketFocus } from './ticketStore';

/** What to open on arrival: a point «6.10», a sign «sign:2.4» or the catalog «signs». */
const props = defineProps<{ focus: string | null }>();
const emit = defineEmits<{ tickets: [focus: TicketFocus]; consumed: [] }>();

const data = shallowRef<PddData>();
const failed = ref(false);
const section = ref('1');
const query = ref('');
const focused = ref('');
const page = ref<HTMLElement>();

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const current = computed(() => data.value?.sections.find(s => s.id === section.value));
const results = computed(() => {
  const q = norm(query.value.trim()), d = data.value;
  if (q.length < 3 || !d) return null;
  const points = d.sections.flatMap(s => s.points.filter(p => norm(p.text).includes(q) || p.id === q).map(p => ({ ...p, section: s.id }))).slice(0, 60);
  const signs = d.signGroups.flatMap(g => g.signs).filter(s => norm(s.name).includes(q) || s.code === q).slice(0, 30);
  return { points, signs };
});
const count = (ref: { point?: string; sign?: string }) => data.value ? citing(data.value.tickets, ref).length : 0;
const hasIcon = (code: string): code is SignCode => code in signCatalog;
const shape = (code: string) => ({ '1': 'warn', '2': 'prio', '3': 'ban', '4': 'order', '5': 'special', '6': 'info', '7': 'service', '8': 'plate' } as Record<string, string>)[code[0]] ?? 'info';

function paragraphs(text: string) { return text.split('\n'); }
function highlight(text: string) {
  const q = query.value.trim(); if (q.length < 3) return [{ t: text, hit: false }];
  const parts: { t: string; hit: boolean }[] = []; const n = norm(text), nq = norm(q); let at = 0;
  for (let i = n.indexOf(nq); i >= 0; i = n.indexOf(nq, at)) { parts.push({ t: text.slice(at, i), hit: false }, { t: text.slice(i, i + q.length), hit: true }); at = i + q.length; }
  parts.push({ t: text.slice(at), hit: false });
  return parts;
}

async function open(target: string) {
  const d = data.value; if (!d) return;
  query.value = '';
  if (target === 'signs' || target.startsWith('sign:')) section.value = 'signs';
  else { const p = findPoint(d, target); if (!p) return; section.value = p.section; target = p.id; }
  focused.value = target;
  await nextTick();
  const el = document.getElementById(`rule-${target}`);
  if (el) el.scrollIntoView({ block: 'center' }); else window.scrollTo({ top: 0 });
}
function pick(id: string) { section.value = id; query.value = ''; focused.value = ''; page.value?.scrollIntoView({ block: 'start' }); }
function applyFocus() { if (props.focus && data.value) { open(props.focus); emit('consumed'); } }
watch(() => props.focus, applyFocus);
onMounted(() => loadPdd().then(d => { data.value = d; applyFocus(); }).catch(() => failed.value = true));
</script>

<template>
  <main ref="page" class="content-page rules-page">
    <div class="page-intro"><span class="eyebrow">ОФИЦИАЛЬНЫЙ ТЕКСТ</span><h1>Правила дорожного движения</h1><p v-if="data">{{ data.rulesSource }}, {{ data.edition }}.</p></div>
    <div v-if="failed" class="info-banner">Не удалось загрузить Правила. Обновите страницу.</div>
    <div v-else-if="!data" class="tickets-loading">Загружаем Правила…</div>
    <div v-else class="rules-layout">
      <nav class="rules-nav" aria-label="Разделы Правил">
        <button v-for="s in data.sections" :key="s.id" :class="{ active: !results && section === s.id }" @click="pick(s.id)"><span>{{ s.id }}</span>{{ s.title }}</button>
        <button :class="{ active: !results && section === 'signs' }" @click="pick('signs')"><span><Icon name="sign" :size="14" /></span>Дорожные знаки</button>
      </nav>
      <section class="rules-body">
        <label class="rules-search"><Icon name="search" :size="18" /><input v-model="query" type="search" placeholder="Поиск: «обгон», «10.2», «Уступите дорогу»" /></label>

        <template v-if="results">
          <p class="rules-hint">{{ results.points.length + results.signs.length ? `Найдено: ${results.points.length + results.signs.length}` : 'Ничего не найдено' }}</p>
          <article v-for="p in results.points" :key="p.id" class="rule-point"><button class="rule-id" @click="open(p.id)">{{ p.id }}</button><div><p v-for="(line, i) in paragraphs(p.text)" :key="i"><template v-for="(part, j) in highlight(line)" :key="j"><mark v-if="part.hit">{{ part.t }}</mark><template v-else>{{ part.t }}</template></template></p></div></article>
          <div v-if="results.signs.length" class="sign-grid"><button v-for="s in results.signs" :key="s.code" class="sign-card" @click="open(`sign:${s.code}`)"><RoadSignIcon v-if="hasIcon(s.code)" :code="s.code" :value="40" /><span v-else class="sign-shape" :class="shape(s.code)">{{ s.code }}</span><strong>{{ s.code }}</strong><small>{{ s.name }}</small></button></div>
        </template>

        <template v-else-if="section === 'signs'">
          <section v-for="g in data.signGroups" :key="g.id" class="sign-group"><h2>{{ g.id }}. {{ g.title }}</h2>
            <div class="sign-grid">
              <div v-for="s in g.signs" :id="`rule-sign:${s.code}`" :key="s.code" class="sign-card" :class="{ focused: focused === `sign:${s.code}` }">
                <RoadSignIcon v-if="hasIcon(s.code)" :code="s.code" :value="40" /><span v-else class="sign-shape" :class="shape(s.code)">{{ s.code }}</span>
                <strong>{{ s.code }}</strong><small>{{ s.name }}</small>
                <button v-if="count({ sign: s.code })" class="rule-tickets" @click="emit('tickets', { label: `Знак ${s.code} «${s.name}»`, sign: s.code })"><Icon name="ticket" :size="14" />{{ count({ sign: s.code }) }}</button>
              </div>
            </div>
          </section>
        </template>

        <template v-else-if="current">
          <h2 class="rules-title">{{ current.id }}. {{ current.title }}</h2>
          <p v-if="current.intro" class="rules-intro">{{ current.intro }}</p>
          <article v-for="p in current.points" :id="`rule-${p.id}`" :key="p.id" class="rule-point" :class="{ focused: focused === p.id }">
            <span class="rule-id">{{ p.id }}</span>
            <div><p v-for="(line, i) in paragraphs(p.text)" :key="i">{{ line }}</p>
              <button v-if="count({ point: p.id })" class="rule-tickets" @click="emit('tickets', { label: `Пункт ${p.id}`, point: p.id })"><Icon name="ticket" :size="14" />Вопросы в билетах: {{ count({ point: p.id }) }}</button></div>
          </article>
        </template>
      </section>
    </div>
  </main>
</template>
