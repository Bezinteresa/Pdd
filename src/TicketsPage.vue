<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import Icon from './Icon.vue';
import { byTicket, byTopic, citing, EXAM_RULES, mistakesOf, record, resultOf, TicketExam, topics, type TicketQuestion } from './game/tickets';
import { findPoint, imageUrl, loadPdd, ticketProgress, type PddData, type TicketFocus } from './ticketStore';

const props = defineProps<{ focus: TicketFocus | null }>();
const emit = defineEmits<{ rule: [id: string]; consumed: [] }>();

const data = shallowRef<PddData>();
const failed = ref(false);
type Mode = { kind: 'home' } | { kind: 'train'; title: string; list: TicketQuestion[]; picked: (number | null)[] } | { kind: 'exam'; exam: TicketExam; ticket: number } | { kind: 'result'; exam: TicketExam; ticket: number; seconds: number };
const mode = shallowRef<Mode>({ kind: 'home' });
const index = ref(0);
const elapsed = ref(0);
const notice = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

const all = computed(() => data.value?.tickets ?? []);
const topicList = computed(() => topics(all.value));
const mistakes = computed(() => mistakesOf(ticketProgress, all.value));
const favorites = computed(() => all.value.filter(q => ticketProgress.favorites.includes(q.id)));

function ticketState(n: number) {
  const results = byTicket(all.value, n).map(q => resultOf(ticketProgress, q));
  if (results.some(r => r === false)) return 'bad';
  if (results.every(r => r === true)) return 'ok';
  return results.some(r => r !== null) ? 'partial' : '';
}
function topicDone(name: string) { const list = byTopic(all.value, name); return list.filter(q => resultOf(ticketProgress, q) === true).length; }

function train(title: string, list: TicketQuestion[]) {
  if (!list.length) return;
  stopTimer(); mode.value = { kind: 'train', title, list, picked: reactive(list.map(() => null)) }; index.value = 0; scrollTop();
}
function startExam(ticket = 1 + Math.floor(Math.random() * 40)) {
  stopTimer(); notice.value = '';
  const exam = reactive(new TicketExam(all.value, ticket)) as TicketExam;
  mode.value = { kind: 'exam', exam, ticket }; index.value = 0; elapsed.value = 0;
  timer = setInterval(() => { elapsed.value++; if (elapsed.value >= exam.timeLimit) { exam.expire(); finishExam(); } }, 1000);
  scrollTop();
}
function stopTimer() { clearInterval(timer); timer = undefined; }
function finishExam() {
  const m = mode.value; if (m.kind !== 'exam') return;
  stopTimer(); ticketProgress.examsTaken++; if (m.exam.status === 'passed') ticketProgress.examsPassed++;
  mode.value = { kind: 'result', exam: m.exam, ticket: m.ticket, seconds: elapsed.value }; scrollTop();
}
function home() { stopTimer(); mode.value = { kind: 'home' }; scrollTop(); }
function scrollTop() { window.scrollTo({ top: 0 }); }

const current = computed<TicketQuestion | null>(() => {
  const m = mode.value;
  if (m.kind === 'train') return m.list[index.value] ?? null;
  if (m.kind === 'exam') return m.exam.entries[index.value]?.question ?? null;
  return null;
});
const picked = computed<number | null>(() => {
  const m = mode.value;
  if (m.kind === 'train') return m.picked[index.value];
  if (m.kind === 'exam') return m.exam.entries[index.value]?.picked ?? null;
  return null;
});
const total = computed(() => { const m = mode.value; return m.kind === 'train' ? m.list.length : m.kind === 'exam' ? m.exam.entries.length : 0; });
function stripState(i: number) {
  const m = mode.value;
  if (m.kind === 'train') { const p = m.picked[i]; return p === null ? '' : p === m.list[i].correct ? 'ok' : 'bad'; }
  if (m.kind === 'exam') { const e = m.exam.entries[i]; return [e.picked === null ? '' : 'done', e.extra ? 'extra' : ''].join(' '); }
  return '';
}

function choose(answer: number) {
  const m = mode.value, q = current.value;
  if (!q || picked.value !== null) return;
  notice.value = '';
  if (m.kind === 'train') { m.picked[index.value] = answer; record(ticketProgress, q, answer === q.correct); return; }
  if (m.kind !== 'exam') return;
  const before = m.exam.entries.length;
  const ok = m.exam.answer(index.value, answer);
  record(ticketProgress, q, ok);
  if (m.exam.entries.length > before) notice.value = `Ошибка в блоке ${m.exam.entries[index.value].block}: добавлено ${m.exam.entries.length - before} вопросов и ${EXAM_RULES.extraMinutes} минут.`;
  if (m.exam.status !== 'running') { finishExam(); return; }
  const next = m.exam.entries.findIndex((e, i) => i > index.value && e.picked === null);
  index.value = next >= 0 ? next : m.exam.entries.findIndex(e => e.picked === null);
}
function go(step: number) { const n = index.value + step; if (n >= 0 && n < total.value) { index.value = n; } else if (n >= total.value && mode.value.kind === 'train') home(); }
function toggleFavorite(q: TicketQuestion) {
  const at = ticketProgress.favorites.indexOf(q.id);
  if (at >= 0) ticketProgress.favorites.splice(at, 1); else ticketProgress.favorites.push(q.id);
}
const isFavorite = (q: TicketQuestion) => ticketProgress.favorites.includes(q.id);

/** A point that ends with a colon continues in its sub-points; long texts (definitions in 1.2) are cut, the full one is a tap away. */
function pointText(d: PddData, id: string, text: string) {
  if (text.trimEnd().endsWith(':')) text += ' ' + [...d.points.values()].filter(p => p.id.startsWith(id + '.')).map(p => `${p.id}. ${p.text}`).join(' ');
  return text.length > 600 ? text.slice(0, text.lastIndexOf(' ', 560)) + ' …' : text;
}
function explain(q: TicketQuestion) {
  const d = data.value; if (!d) return { points: [], signs: [], marks: [] };
  const seen = new Set<string>();
  const points = q.points.map(id => ({ id, point: findPoint(d, id) })).filter(p => p.point && !seen.has(p.point.id) && seen.add(p.point.id)).map(p => ({ id: p.id, ref: p.point!.id, text: pointText(d, p.point!.id, p.point!.text) }));
  return { points, signs: q.signs.map(code => ({ code, name: d.signs.get(code) ?? null })), marks: q.marks };
}
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s) % 60)).padStart(2, '0')}`;
const left = computed(() => mode.value.kind === 'exam' ? mode.value.exam.timeLimit - elapsed.value : 0);
const resultMistakes = computed(() => mode.value.kind === 'result' ? mode.value.exam.entries.filter(e => e.picked !== null && e.picked !== e.question.correct) : []);

function applyFocus() {
  const f = props.focus; if (!f || !data.value) return;
  const list = citing(all.value, f);
  emit('consumed');
  if (list.length) train(f.label, list); else { home(); notice.value = `В билетах нет вопросов по теме «${f.label}».`; }
}
watch(() => props.focus, applyFocus);
// Keeps the current number visible in the question strip.
watch([index, mode], () => nextTick(() => document.querySelector('.ticket-strip .current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })));

function keys(event: KeyboardEvent) {
  if (event.target instanceof Element && event.target.matches('input,select,textarea') || !current.value) return;
  const digit = Number(event.key);
  if (digit >= 1 && digit <= current.value.answers.length) { event.preventDefault(); choose(digit - 1); }
  else if (event.key === 'ArrowRight' || event.key === 'Enter' && picked.value !== null) { event.preventDefault(); go(1); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
}
onMounted(() => {
  window.addEventListener('keydown', keys);
  loadPdd().then(d => { data.value = d; applyFocus(); }).catch(() => failed.value = true);
});
onBeforeUnmount(() => { stopTimer(); window.removeEventListener('keydown', keys); });
</script>

<template>
  <main class="content-page tickets-page">
    <div v-if="failed" class="info-banner">Не удалось загрузить билеты. Проверьте соединение и обновите страницу.</div>
    <div v-else-if="!data" class="tickets-loading">Загружаем билеты…</div>

    <template v-else-if="mode.kind === 'home'">
      <div class="page-intro"><span class="eyebrow">ЭКЗАМЕНАЦИОННЫЕ БИЛЕТЫ ABM</span><h1>Билеты</h1><p>40 билетов по 20 вопросов. После ответа — пункты Правил, на которые он опирается.</p></div>
      <div v-if="notice" class="info-banner">{{ notice }}</div>
      <div class="ticket-actions">
        <button class="ticket-action primary" @click="startExam()"><Icon name="clock" :size="26" /><strong>Экзамен</strong><span>{{ EXAM_RULES.questions }} вопросов · {{ EXAM_RULES.minutes }} минут · ошибка = +5 вопросов</span></button>
        <button class="ticket-action" :disabled="!mistakes.length" @click="train('Работа над ошибками', mistakes)"><Icon name="hazard" :size="26" /><strong>Работа над ошибками</strong><span>{{ mistakes.length ? `${mistakes.length} вопр.` : 'Ошибок нет' }}</span></button>
        <button class="ticket-action" :disabled="!favorites.length" @click="train('Избранное', favorites)"><Icon name="star" :size="26" /><strong>Избранное</strong><span>{{ favorites.length ? `${favorites.length} вопр.` : 'Отмечайте звёздочкой' }}</span></button>
      </div>
      <section class="ticket-section"><h2>Билеты по номеру</h2>
        <div class="ticket-grid"><button v-for="n in 40" :key="n" :class="ticketState(n)" :aria-label="`Билет ${n}`" @click="train(`Билет ${n}`, byTicket(all, n))">{{ n }}</button></div>
      </section>
      <section class="ticket-section"><h2>Темы</h2>
        <div class="topic-grid"><button v-for="t in topicList" :key="t.name" @click="train(t.name, byTopic(all, t.name))"><span>{{ t.name }}</span><small>{{ topicDone(t.name) }} / {{ t.count }}</small><i :style="{ width: `${topicDone(t.name) / t.count * 100}%` }"></i></button></div>
      </section>
      <p class="source-note">Вопросы: {{ data.source }}. Пояснения — официальный текст ПДД РФ ({{ data.edition }}).</p>
    </template>

    <template v-else-if="mode.kind === 'result'">
      <section class="ticket-result" :class="{ passed: mode.exam.status === 'passed' }">
        <span class="eyebrow">БИЛЕТ {{ mode.ticket }} · {{ clock(mode.seconds) }}</span>
        <h1>{{ mode.exam.status === 'passed' ? 'Экзамен сдан' : 'Экзамен не сдан' }}</h1>
        <p>{{ mode.exam.status === 'passed' ? (resultMistakes.length ? `Ошибок: ${resultMistakes.length}, дополнительные вопросы решены.` : 'Без единой ошибки!') : mode.exam.failReason }}</p>
        <div class="ticket-result-buttons"><button class="primary-button" @click="startExam()">Ещё экзамен</button><button class="secondary-button" @click="home()">К билетам</button></div>
      </section>
      <article v-for="e in resultMistakes" :key="e.question.id" class="ticket-review" :class="{ 'no-image': !e.question.image }">
        <img v-if="e.question.image" :src="imageUrl(e.question.image)" alt="" loading="lazy" />
        <div><small>Билет {{ e.question.ticket }}, вопрос {{ e.question.number }}</small><h3>{{ e.question.question }}</h3>
          <p class="review-wrong">Ваш ответ: {{ e.question.answers[e.picked!] }}</p><p class="review-right">Верно: {{ e.question.answers[e.question.correct] }}</p>
          <div class="explain-rules"><div v-for="p in explain(e.question).points" :key="p.ref"><button class="rule-link" @click="emit('rule', p.ref)">п. {{ p.ref }}</button> {{ p.text }}</div></div>
        </div>
      </article>
    </template>

    <section v-else-if="current" class="ticket-run">
      <div class="ticket-bar">
        <button class="icon-button" aria-label="Назад к билетам" @click="home()"><Icon name="left" /></button>
        <strong>{{ mode.kind === 'exam' ? `Экзамен · билет ${mode.ticket}` : mode.kind === 'train' ? mode.title : '' }}</strong>
        <span v-if="mode.kind === 'exam'" class="ticket-timer" :class="{ low: left < 120 }"><Icon name="clock" :size="16" />{{ clock(left) }}</span>
        <div class="ticket-strip"><button v-for="i in total" :key="i" :class="[stripState(i - 1), { current: i - 1 === index }]" @click="index = i - 1">{{ i }}</button></div>
        <button class="icon-button star-button" :class="{ on: isFavorite(current) }" :aria-label="isFavorite(current) ? 'Убрать из избранного' : 'В избранное'" @click="toggleFavorite(current)"><Icon name="star" /></button>
      </div>
      <div v-if="mode.kind === 'exam' && notice" class="info-banner">{{ notice }}</div>
      <div class="ticket-card" :class="{ 'no-image': !current.image }">
        <div v-if="current.image" class="ticket-image"><img :src="imageUrl(current.image)" alt="Иллюстрация к вопросу" /></div>
        <div class="ticket-body">
          <small class="ticket-meta">Билет {{ current.ticket }} · вопрос {{ current.number }}<template v-if="mode.kind === 'exam' && mode.exam.entries[index].extra"> · дополнительный</template></small>
          <h2>{{ current.question }}</h2>
          <div class="ticket-answers">
            <button v-for="(a, i) in current.answers" :key="i" :disabled="picked !== null"
              :class="mode.kind === 'train' && picked !== null ? { correct: i === current.correct, wrong: i === picked && i !== current.correct } : { chosen: i === picked }"
              @click="choose(i)"><span>{{ i + 1 }}</span>{{ a }}</button>
          </div>
          <div v-if="mode.kind === 'train' && picked !== null" class="ticket-explain">
            <strong>{{ picked === current.correct ? 'Верно!' : 'Неверно' }}</strong>
            <div class="explain-rules">
              <div v-for="p in explain(current).points" :key="p.ref"><button class="rule-link" @click="emit('rule', p.ref)">п. {{ p.ref }}</button> {{ p.text }}</div>
              <div v-for="s in explain(current).signs" :key="s.code"><button class="rule-link" @click="emit('rule', `sign:${s.code}`)">Знак {{ s.code }}</button> {{ s.name ? `«${s.name}»` : '' }}</div>
              <div v-if="explain(current).marks.length">Разметка: {{ explain(current).marks.join(', ') }}</div>
            </div>
            <button class="primary-button" @click="go(1)">{{ index + 1 < total ? 'Дальше' : 'Готово' }} <Icon name="arrow" :size="16" /></button>
          </div>
        </div>
      </div>
      <div class="ticket-nav"><button class="secondary-button" :disabled="index === 0" @click="go(-1)"><Icon name="left" :size="16" /> Назад</button><button class="secondary-button" :disabled="index + 1 >= total" @click="go(1)">Вперёд <Icon name="arrow" :size="16" /></button></div>
    </section>
  </main>
</template>
