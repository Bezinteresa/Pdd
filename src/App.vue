<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { DrivingEngine, type CameraMode, type GameSettings, type Look, type Telemetry } from './game/engine';
import type { Gear } from './game/vehicle';
import { lessons } from './game/lesson';
import { lampLabel } from './game/signals';
import { practiceOrder, practiceScenes, readySituations, situationOutcome, situations, type Situation, type SituationOutcome } from './game/exam';
import { ruleTexts, PDD_EDITION } from './game/pddText';
import type { Violation } from './game/rules';
import SituationSchema from './SituationSchema.vue';
import RoadSignIcon from './RoadSignIcon.vue';
import CityMap from './CityMap.vue';
import { buildCity } from './game/city';
import { signCatalog } from './game/signs';
import { poseLabel, sideLabel } from './game/regulator';
import { canResume, escapeAction, type ModalState } from './game/session';
import { SoundBoard } from './sound';
import TicketsPage from './TicketsPage.vue';
import RulesPage from './RulesPage.vue';
import { ticketProgress, type TicketFocus } from './ticketStore';

const canvasHost = ref<HTMLElement>();
const mirrorLeft = ref<HTMLElement>(), mirrorRear = ref<HTMLElement>(), mirrorRight = ref<HTMLElement>();
const tab = ref<'practice' | 'tickets' | 'rules' | 'progress'>('practice');
const ruleFocus = ref<string | null>(null), ticketFocus = ref<TicketFocus | null>(null);
/** Opens a PDD point («10.2») or a sign («sign:2.4») in the rules tab, closing the exam debrief. */
function openRule(id: string) { showDebrief.value = false; ruleFocus.value = id.replace(/^sign-/, 'sign:'); tab.value = 'rules'; }
function openTickets(focus: TicketFocus) { showDebrief.value = false; ticketFocus.value = focus; tab.value = 'tickets'; }
/** Tickets citing a rule id from the judge or pddText («13.9», «sign-2.5»). */
const ticketsFor = (id: string, label: string) => openTickets(id.startsWith('sign-') ? { label, sign: id.slice(5) } : { label, point: id });
const ruleLabel = (id: string) => id.startsWith('sign-') ? `знак ${id.slice(5)}` : `п. ${id}`;
const cameraMode = ref<CameraMode>('cockpit');
const looking = ref<Look>('forward');
const playing = ref(false);
const started = ref(false);
const showHelp = ref(false), showSettings = ref(false);
const message = ref('');
const fatal = ref('');
const pedals = reactive({ throttle: false, brake: false });
const steerDegrees = ref(0);
const wheelPointer = ref<number | null>(null);
const pedalPointers = new Map<number, 'throttle' | 'brake'>();
const wheelLastAngle = ref(0);
const telemetry = reactive<Telemetry>({ speed: 0, rpm: 850, gear: 'P', belt: false, handbrake: true, signal: null, steering: 0, distance: 0, fps: 60, lessonId: lessons[0].id, lessonStep: 0, completed: false, moving: false, speedLimit: null, collisions: 0, violations: [], signalAhead: null, tripTime: 0, throttle: 0, brake: 0, exam: null, signs: [], regulatorAhead: null, mapKind: 'district', pose: { x: 0, z: 0, heading: 0 } });
// Touch gas is split into vertical zones: the lower part of the pedal gives little gas, the top gives full gas.
const GAS_LEVELS = 7;
const gasLevel = ref(0);
// Tachometer: 0–8 ×1000 rpm over a 240° arc open at the bottom; red zone from 6000.
const RPM_MAX = 8000, DIAL_SWEEP = 240;
const rpmAngle = computed(() => -DIAL_SWEEP / 2 + Math.min(1, Math.max(0, telemetry.rpm / RPM_MAX)) * DIAL_SWEEP);
const dialPoint = (value: number, radius: number) => { const a = (-DIAL_SWEEP / 2 + value / RPM_MAX * DIAL_SWEEP) * Math.PI / 180; return { x: Math.sin(a) * radius, y: -Math.cos(a) * radius }; };
const dialTicks = Array.from({ length: 17 }, (_, i) => { const value = i * 500, major = i % 2 === 0, a = dialPoint(value, major ? 95 : 99), b = dialPoint(value, 106), label = dialPoint(value, 115); return { value, major, a, b, label, red: value >= 6000 }; });
const redArc = (() => { const a = dialPoint(6000, 103), b = dialPoint(RPM_MAX, 103); return `M${a.x} ${a.y}A103 103 0 0 1 ${b.x} ${b.y}`; })();
const dialArc = (() => { const a = dialPoint(0, 103), b = dialPoint(RPM_MAX, 103); return `M${a.x} ${a.y}A103 103 0 1 1 ${b.x} ${b.y}`; })();
const shownGasLevel = computed(() => Math.max(gasLevel.value, Math.round(telemetry.throttle * GAS_LEVELS)));
const defaults: GameSettings = { quality: 'balanced', mirrors: true, motion: true, sensitivity: 1, voice: true, examHints: false, cityMap: false, sound: true };
function readSaved<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Browsers can deny storage; driving remains available. */ } }
const storedSettings = readSaved<Partial<GameSettings>>('pdd-settings-v1', {});
const settings = reactive<GameSettings>({ ...defaults, ...storedSettings, quality: ['low', 'balanced', 'high'].includes(storedSettings.quality || '') ? storedSettings.quality! : 'balanced', sensitivity: Math.max(.5, Math.min(1.5, Number(storedSettings.sensitivity) || 1)) });
// Exam with the inspector: picked situations, live route state and the debrief after the finish.
const showExamPicker = ref(false), showDebrief = ref(false), showPracticeList = ref(false);
const examSelection = ref<string[]>(readSaved<string[]>('pdd-exam-selection-v1', []).filter(id => readySituations.some(s => s.id === id)));
const examView = computed(() => telemetry.exam !== null);
// Explanations next to signs and the controller help while learning; in the exam they are off unless enabled.
const showHudHints = computed(() => !examView.value || !!practiceId.value || settings.examHints);
// The speed plate already shown as the active restriction is not repeated among the signs just passed.
const hudSigns = computed(() => telemetry.signs.filter(s => !(s.code === '3.24' && s.value === telemetry.speedLimit)));
const maneuverWords = { straight: 'прямо', right: 'направо', left: 'налево', uturn: 'разворот' } as const;
const regulatorText = computed(() => telemetry.regulatorAhead ? `${poseLabel[telemetry.regulatorAhead.pose]}, вы ${sideLabel[telemetry.regulatorAhead.side]}` : '');
const practiceId = computed(() => telemetry.exam?.practice ?? null);
const practiceSituation = computed(() => situations.find(s => s.id === practiceId.value) ?? null);
// The practice list: the two lessons first, then situations ordered from the simplest to the hardest.
type PracticeItem = { kind: 'lesson'; index: number; id: string; title: string; summary: string } | { kind: 'situation'; id: string; title: string; summary: string; topic: string };
const practiceItems = computed<PracticeItem[]>(() => [
  ...lessons.map((l, index) => ({ kind: 'lesson' as const, index, id: l.id, title: l.title, summary: l.summary })),
  ...practiceOrder.map(id => situations.find(s => s.id === id)!).map(s => ({ kind: 'situation' as const, id: s.id, title: s.title, summary: s.summary, topic: s.topic })),
]);
function practiceStatus(item: PracticeItem): 'passed' | 'failed' | 'new' {
  const best = item.kind === 'lesson' ? progress.lessonResults[item.id] : progress.practiceResults[item.id];
  return best === undefined ? 'new' : best === 0 ? 'passed' : 'failed';
}
const statusLabel = { passed: 'Без ошибок', failed: 'С ошибками', new: 'Не пройдено' } as const;
function openPracticeItem(item: PracticeItem) {
  showPracticeList.value = false;
  if (item.kind === 'lesson') { leaveExam(); selectLesson(item.index); return; }
  startPractice(item.id);
}
function startPractice(id: string) {
  if (!engine || !practiceScenes[id]) return;
  showDebrief.value = false; showPracticeList.value = false; showExamPicker.value = false; examReport.value = null;
  telemetry.exam = null; telemetry.violations = [];
  engine.startPractice(id); steerDegrees.value = 0; looking.value = 'forward';
  started.value = true; playing.value = true; engine.setPaused(false); (document.activeElement as HTMLElement | null)?.blur?.();
}
const practiceRuleTags = computed(() => (practiceSituation.value?.ruleIds ?? []).filter(id => ruleTexts[id]).slice(0, 2).map(id => ruleTexts[id].title.split(' «')[0]));
const nextPractice = computed(() => { const i = practiceOrder.indexOf(practiceId.value ?? ''); return i >= 0 && i < practiceOrder.length - 1 ? practiceOrder[i + 1] : null; });
const situationTopics = computed(() => [...new Set(situations.map(s => s.topic))].map(topic => ({ topic, items: situations.filter(s => s.topic === topic) })));
const plannedCount = situations.filter(s => s.status === 'planned').length;
const examReport = ref<{ passed: boolean; failReason: string | null; errors: number; cards: { situation: Situation; violations: Violation[]; outcome: SituationOutcome }[]; other: Violation[]; rules: string[] } | null>(null);
const outcomeText: Record<SituationOutcome, string> = { passed: 'Ситуация выполнена без ошибок.', failed: '', interrupted: 'Экзамен прекращён на этой ситуации — до конца её не проехали.', 'not-reached': 'До этой ситуации не доехали, она не оценивалась.' };
// The city has a place for every situation, so any five different ones fit one exam.
const EXAM_SIZE = 5;
const cityLayout = buildCity();
function canPick(id: string) { return examSelection.value.includes(id) || examSelection.value.length < EXAM_SIZE; }
function togglePick(id: string) { if (!canPick(id)) return; examSelection.value = examSelection.value.includes(id) ? examSelection.value.filter(x => x !== id) : [...examSelection.value, id]; }
function randomExam() { examSelection.value = [...readySituations].sort(() => Math.random() - .5).slice(0, EXAM_SIZE).map(s => s.id); }
function startExam() {
  if (!engine || examSelection.value.length === 0) return;
  save('pdd-exam-selection-v1', examSelection.value);
  showExamPicker.value = false; showDebrief.value = false; examReport.value = null; previouslyCompleted = false;
  // Drop the previous exam state at once so its "finished" flag cannot mask the end of this one.
  telemetry.exam = null; telemetry.violations = [];
  engine.startExam(examSelection.value); steerDegrees.value = 0; looking.value = 'forward';
  started.value = true; playing.value = true; engine.setPaused(false); (document.activeElement as HTMLElement | null)?.blur?.();
}
function leaveExam() { showDebrief.value = false; examReport.value = null; engine?.setLesson(lesson.value.id); pause(); }
function snapshot(id: number) { return engine?.snapshots.get(id); }
function speak(text: string) {
  if (!settings.voice || !('speechSynthesis' in window)) return;
  try { const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU'; u.rate = 1.05; const ru = speechSynthesis.getVoices().find(v => v.lang.startsWith('ru')); if (ru) u.voice = ru; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* Speech is optional. */ }
}
function buildReport() {
  const exam = telemetry.exam; if (!exam) return;
  // The report keeps its own copy, so nothing after the finish can change what is being reviewed.
  const violations = [...telemetry.violations];
  const chosen = exam.selected.map(id => situations.find(s => s.id === id)!).filter(Boolean);
  const cards = chosen.map(situation => {
    const own = violations.filter(v => v.situation === situation.id);
    return { situation, violations: own, outcome: situationOutcome(exam.progress[situation.id] ?? 'pending', own.length) };
  });
  const other = violations.filter(v => !v.situation || !exam.selected.includes(v.situation));
  const rules = [...new Set([...chosen.flatMap(s => s.ruleIds), ...violations.flatMap(v => v.ruleIds)])].filter(id => ruleTexts[id]);
  const passed = !exam.failReason && violations.length === 0 && cards.every(c => c.outcome === 'passed');
  examReport.value = { passed, failReason: exam.failReason, errors: violations.length, cards, other, rules };
  if (exam.practice) {
    // A practice result counts only when the situation was actually driven to the end.
    const best = progress.practiceResults[exam.practice];
    if (cards[0]?.outcome === 'passed' || cards[0]?.outcome === 'failed') progress.practiceResults[exam.practice] = Math.min(best ?? Infinity, violations.length);
    return;
  }
  if (passed) progress.examsPassed = (progress.examsPassed ?? 0) + 1;
  progress.examsTaken = (progress.examsTaken ?? 0) + 1;
}
watch(() => telemetry.exam?.finished, finished => { if (finished && !showDebrief.value) { pause(); buildReport(); showDebrief.value = true; } });
// v1 saves lack lesson results; missing fields fall back to defaults so old progress survives.
const progress = reactive({ lessons: 0, bestDistance: 0, lessonResults: {} as Record<string, number>, violations: 0, practiceResults: {} as Record<string, number>, examsTaken: 0, examsPassed: 0, ...readSaved<object>('pdd-progress-v1', {}) });
const lessonIndex = ref(Math.max(0, lessons.findIndex(l => l.id === readSaved('pdd-lesson-v1', lessons[0].id))));
const lesson = computed(() => lessons[lessonIndex.value]);
const steps = computed(() => lesson.value.steps);
const completion = computed(() => Math.round(Math.min(telemetry.lessonStep, steps.value.length) / steps.value.length * 100));
const instructorText = computed(() => telemetry.completed ? (telemetry.violations.length ? `Урок засчитан с ошибками (${telemetry.violations.length}). Разберите журнал и повторите заезд без нарушений.` : 'Урок пройден без нарушений. Продолжайте поездку или выберите следующее занятие.') : lesson.value.hints[Math.min(telemetry.lessonStep, lesson.value.hints.length - 1)]);
const lampClass = computed(() => telemetry.signalAhead ? ({ green: 'go', greenFlash: 'go flash', yellow: 'warn', redYellow: 'stop warn', red: 'stop' } as const)[telemetry.signalAhead.lamp] : '');
const formatTime = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
let engine: DrivingEngine | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let previouslyCompleted = false;
let wheelReturnFrame = 0;

const sound = new SoundBoard();
let tickTimer: ReturnType<typeof setInterval> | undefined;
function unlockSound() { sound.unlock(); }
watch(() => settings.sound, on => { sound.enabled = on; }, { immediate: true });
watch(() => [telemetry.rpm, telemetry.throttle, playing.value] as const, ([rpm, throttle, running]) => sound.engine(rpm, throttle, running));
watch(() => playing.value && (telemetry.signal === 'left' || telemetry.signal === 'right' || telemetry.signal === 'hazard'), blinking => {
  clearInterval(tickTimer); if (blinking) { sound.tick(); tickTimer = setInterval(() => sound.tick(), 450); }
});
watch(() => telemetry.violations.length, (count, before) => { if (count > (before ?? 0)) sound.error(); });
watch(() => examReport.value?.passed, passed => { if (passed) sound.success(); });
watch(() => telemetry.completed, done => { if (done && telemetry.violations.length === 0) sound.success(); });
function notify(text: string) { message.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => message.value = '', 4200); }
function applyCamera(mode: CameraMode) { cameraMode.value = mode; looking.value = 'forward'; engine?.setCamera(mode); }
function look(value: Look) { looking.value = value; engine?.setLook(value); }
const modals = (): ModalState => ({ help: showHelp.value, settings: showSettings.value, examPicker: showExamPicker.value, practiceList: showPracticeList.value, debrief: showDebrief.value });
// Resuming is refused while any dialog is open, so the car never drives on behind the exam picker or debrief.
function play() { if (!engine || (!playing.value && !canResume(modals()))) return; (document.activeElement as HTMLElement | null)?.blur?.(); started.value = true; playing.value = !playing.value; engine.setPaused(!playing.value); clearControls(); }
function pause() { playing.value = false; engine?.setPaused(true); clearControls(); }
function reset() { if (practiceId.value) { startPractice(practiceId.value); pause(); return; } pause(); engine?.reset(); steerDegrees.value = 0; previouslyCompleted = false; looking.value = 'forward'; }
// Driving controls act on touch-down: with one finger on the brake, mobile browsers often drop the click of a second tap.
// Keyboard activation still arrives as a click with detail 0.
function tap(event: Event, action: () => void) { if (event.type === 'pointerdown') { event.preventDefault(); action(); } else if ((event as MouseEvent).detail === 0) action(); }
function toggleSignal(side: 'left' | 'right' | 'hazard') { engine?.toggleSignal(side); }
function toggleBelt() { engine?.toggleBelt(); }
function toggleHandbrake() { engine?.toggleHandbrake(); }
function setGear(value: Gear) { engine?.gear(value); }
function selectLesson(index: number) { if (index < 0 || index >= lessons.length) return; pause(); lessonIndex.value = index; save('pdd-lesson-v1', lessons[index].id); engine?.setLesson(lessons[index].id); steerDegrees.value = 0; previouslyCompleted = false; looking.value = 'forward'; }
function keyAngle(event: PointerEvent, element: HTMLElement) { const rect = element.getBoundingClientRect(); return Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2); }
function wheelDown(event: PointerEvent) {
  if (!playing.value || wheelPointer.value !== null) return;
  event.preventDefault(); cancelAnimationFrame(wheelReturnFrame); wheelPointer.value = event.pointerId;
  const target = event.currentTarget as HTMLElement; capture(event); wheelLastAngle.value = keyAngle(event, target);
}
function wheelMove(event: PointerEvent) {
  if (wheelPointer.value !== event.pointerId) return;
  const angle = keyAngle(event, event.currentTarget as HTMLElement); let delta = angle - wheelLastAngle.value;
  if (delta > Math.PI) delta -= Math.PI * 2; if (delta < -Math.PI) delta += Math.PI * 2;
  steerDegrees.value = Math.max(-240, Math.min(240, steerDegrees.value + delta * 180 / Math.PI)); wheelLastAngle.value = angle;
  if (engine) engine.input.steer = steerDegrees.value / 240;
}
function wheelUp(event?: PointerEvent) {
  if (event && wheelPointer.value !== event.pointerId) return;
  wheelPointer.value = null;
  const returnToCenter = () => { steerDegrees.value *= .84; if (Math.abs(steerDegrees.value) < .3) steerDegrees.value = 0; if (engine) engine.input.steer = steerDegrees.value / 240; if (steerDegrees.value !== 0) wheelReturnFrame = requestAnimationFrame(returnToCenter); };
  cancelAnimationFrame(wheelReturnFrame); wheelReturnFrame = requestAnimationFrame(returnToCenter);
}
// Capture can fail (pointer already released, synthetic input); the press itself must still count.
function capture(event: PointerEvent) { try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* keep the press */ } }
function gasZone(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const fromBottom = 1 - (event.clientY - rect.top) / rect.height;
  return Math.max(1, Math.min(GAS_LEVELS, Math.ceil(fromBottom * GAS_LEVELS)));
}
function setGas(level: number) { gasLevel.value = level; if (engine) engine.input.throttle = level / GAS_LEVELS; }
function pedalDown(event: PointerEvent, pedal: 'throttle' | 'brake') {
  if (!playing.value) return; event.preventDefault(); capture(event); pedalPointers.set(event.pointerId, pedal); pedals[pedal] = true;
  if (pedal === 'throttle') setGas(gasZone(event)); else if (engine) engine.input.brake = 1;
}
// Mouse clicks on simulator buttons must not take focus, or Space/Enter would press them instead of driving.
function keepKeyboard(event: MouseEvent) { if ((event.target as Element).closest('button')) event.preventDefault(); }
function pedalMove(event: PointerEvent) { if (pedalPointers.get(event.pointerId) === 'throttle') setGas(gasZone(event)); }
function pedalUp(event: PointerEvent) {
  const pedal = pedalPointers.get(event.pointerId); if (!pedal) return; pedalPointers.delete(event.pointerId);
  if (![...pedalPointers.values()].includes(pedal)) { pedals[pedal] = false; if (pedal === 'throttle') setGas(0); else if (engine) engine.input.brake = 0; }
}
function clearControls() { cancelAnimationFrame(wheelReturnFrame); wheelPointer.value = null; steerDegrees.value = 0; pedalPointers.clear(); pedals.throttle = pedals.brake = false; gasLevel.value = 0; engine?.releaseInput(); }
const fsHint = ref(false);
let fsHintTimer: ReturnType<typeof setTimeout> | undefined;
function syncFullscreen() { if (document.fullscreenElement) { fsHint.value = false; clearTimeout(fsHintTimer); } }
function fullscreen() { fsHint.value = false; clearTimeout(fsHintTimer); if (document.fullscreenElement) document.exitFullscreen().catch(() => notify('Не удалось выйти из полного экрана')); else document.documentElement.requestFullscreen?.().catch(() => notify('Полный экран недоступен в этом браузере')); }
function keyboard(event: KeyboardEvent) {
  if (event.code !== 'Escape') return;
  const action = escapeAction(modals());
  if (action.close.includes('help')) showHelp.value = false;
  if (action.close.includes('settings')) showSettings.value = false;
  if (action.close.includes('examPicker')) showExamPicker.value = false;
  if (action.close.includes('practiceList')) showPracticeList.value = false;
  if (action.togglePause && tab.value === 'practice') play();
}
watch(settings, value => { engine?.updateSettings(value); save('pdd-settings-v1', value); }, { deep: true });
watch(progress, value => save('pdd-progress-v1', value), { deep: true });
watch(tab, async value => { pause(); engine?.setSuspended(value !== 'practice'); if (value === 'practice') { await nextTick(); window.dispatchEvent(new Event('resize')); } });
watch([showHelp, showSettings, showExamPicker, showDebrief, showPracticeList], dialogs => { if (dialogs.some(Boolean)) pause(); });
onMounted(async () => {
  await nextTick();
  try {
    engine = new DrivingEngine(canvasHost.value!, value => {
      Object.assign(telemetry, value); playing.value = value.moving;
      if (wheelPointer.value === null && !playing.value) steerDegrees.value = 0;
      if (engine) cameraMode.value = engine.cameraMode;
      if (value.completed && !previouslyCompleted) {
        previouslyCompleted = true; progress.lessons++; progress.violations += value.violations.length;
        const best = progress.lessonResults[value.lessonId]; if (best === undefined || value.violations.length < best) progress.lessonResults[value.lessonId] = value.violations.length;
      }
      const meters = Math.round(value.distance); if (meters > progress.bestDistance + 9) progress.bestDistance = meters;
    }, notify);
    engine.onSay = speak;
    // Dev builds expose the engine so browser checks can drive the car; production bundles drop this branch.
    if (import.meta.env.DEV) (window as unknown as { pddEngine?: DrivingEngine }).pddEngine = engine;
    engine.setMirrorElements([mirrorLeft.value!, mirrorRear.value!, mirrorRight.value!]); engine.updateSettings(settings); if (lessonIndex.value > 0) engine.setLesson(lesson.value.id);
  } catch (error) { fatal.value = 'Не удалось запустить 3D. Проверьте поддержку WebGL и аппаратное ускорение браузера.'; console.error(error); }
  window.addEventListener('keydown', keyboard);
  window.addEventListener('pointerdown', unlockSound); window.addEventListener('keydown', unlockSound);
  document.addEventListener('fullscreenchange', syncFullscreen);
  // Phones and short screens lose a lot of space to browser chrome: point at the fullscreen button once per visit.
  const small = window.matchMedia('(pointer: coarse)').matches || window.innerHeight < 620;
  if (small && document.fullscreenEnabled && !document.fullscreenElement) { fsHint.value = true; fsHintTimer = setTimeout(() => fsHint.value = false, 9000); }
});
onBeforeUnmount(() => { clearTimeout(toastTimer); clearInterval(tickTimer); window.removeEventListener('pointerdown', unlockSound); window.removeEventListener('keydown', unlockSound); clearTimeout(fsHintTimer); document.removeEventListener('fullscreenchange', syncFullscreen); cancelAnimationFrame(wheelReturnFrame); window.removeEventListener('keydown', keyboard); engine?.dispose(); });
</script>

<template>
  <div class="app-shell" :class="{ 'practice-mode': tab === 'practice' }">
    <header class="app-header">
      <a class="brand" href="#" @click.prevent="tab = 'practice'"><span class="brand-mark">У</span><span><strong>ГОРОДСКАЯ</strong><small>АВТОШКОЛА</small></span></a>
      <nav class="main-nav" aria-label="Разделы">
        <button :class="{ active: tab === 'practice' }" @click="tab = 'practice'"><Icon name="drive" />Практика</button>
        <button :class="{ active: tab === 'tickets' }" @click="tab = 'tickets'"><Icon name="ticket" />Билеты</button>
        <button :class="{ active: tab === 'rules' }" @click="tab = 'rules'"><Icon name="book" />Правила</button>
        <button :class="{ active: tab === 'progress' }" @click="tab = 'progress'"><Icon name="chart" />Прогресс</button>
      </nav>
      <div class="header-right"><span class="prototype"><i></i> ВЕРСИЯ 0.9</span><button class="icon-button" aria-label="Настройки" @click="showSettings = true"><Icon name="gear" /></button></div>
    </header>

    <main v-show="tab === 'practice'" class="practice-layout">
      <section class="simulator" :class="{ 'has-bubble': examView ? !telemetry.exam?.finished : !telemetry.completed }" aria-label="Симулятор вождения" @mousedown="keepKeyboard">
        <div ref="canvasHost" class="canvas-host"></div>
        <div class="scene-heading"><span class="eyebrow">ПРАКТИЧЕСКОЕ ЗАНЯТИЕ</span><h1>{{ examView ? 'Экзамен с инспектором' : lesson.heading }}</h1><div class="location"><Icon name="pin" :size="14" /> Учебный квартал <span>•</span> Сухая дорога <Icon name="sun" :size="14" /></div></div>
        <div v-if="fsHint" class="fs-hint" aria-hidden="true"><span class="fs-hint-frame"></span><span class="fs-hint-label">На весь экран</span></div><div class="scene-tools"><button class="glass-button" aria-label="Помощь по управлению" @click="showHelp = true"><Icon name="help" /></button><button class="glass-button fullscreen-button" :class="{ hinted: fsHint }" aria-label="Полный экран" @click="fullscreen"><Icon name="full" /></button></div>
        <div class="camera-switch"><button :class="{ selected: cameraMode === 'cockpit' }" @click="applyCamera('cockpit')">Из кабины</button><button :class="{ selected: cameraMode === 'chase' }" @click="applyCamera('chase')">От третьего лица</button></div>

        <div class="mirrors" :class="{ 'mirrors-disabled': !settings.mirrors }">
          <button class="mirror-frame mirror-left" :class="{ focused: looking === 'left' }" aria-label="Посмотреть в левое зеркало" @click="look(looking === 'left' ? 'forward' : 'left')"><span ref="mirrorLeft" class="mirror-view"></span><span class="mirror-label">ЛЕВОЕ</span></button>
          <button class="mirror-frame mirror-rear" :class="{ focused: looking === 'rear' }" aria-label="Посмотреть в зеркало заднего вида" @click="look(looking === 'rear' ? 'forward' : 'rear')"><span ref="mirrorRear" class="mirror-view"></span><span class="mirror-label">ЗАДНИЙ ВИД</span></button>
          <button class="mirror-frame mirror-right" :class="{ focused: looking === 'right' }" aria-label="Посмотреть в правое зеркало" @click="look(looking === 'right' ? 'forward' : 'right')"><span ref="mirrorRight" class="mirror-view"></span><span class="mirror-label">ПРАВОЕ</span></button>
        </div>

        <div v-if="settings.cityMap && telemetry.mapKind === 'city' && telemetry.exam" class="map-overlay"><CityMap :city="cityLayout" :pose="telemetry.pose" :route="telemetry.exam.route" :target="telemetry.exam.target" /></div>
        <div class="road-hud" aria-label="Дорожная обстановка">
          <div v-if="telemetry.signalAhead" class="hud-card signal-ahead" :class="lampClass" :title="`Светофор впереди: ${lampLabel[telemetry.signalAhead.lamp]}`"><span class="lamp-r"></span><span class="lamp-y"></span><span class="lamp-g"></span><small>{{ Math.max(0, Math.round(telemetry.signalAhead.distance)) }} м</small></div>
          <div v-if="telemetry.regulatorAhead" class="hud-card regulator-card" :class="telemetry.regulatorAhead.allowed.length ? 'go' : 'stop'" :title="regulatorText">
            <svg class="regulator-icon" viewBox="0 0 60 64" aria-hidden="true">
              <circle cx="30" cy="12" r="7" fill="#e2b892" /><rect x="22" y="9" width="16" height="4" rx="2" fill="#f4f4ef" />
              <rect x="21" y="20" width="18" height="22" rx="4" fill="#2f3f5c" /><rect x="21" y="24" width="18" height="6" fill="#c9f24d" />
              <path d="M25 42V60M35 42V60" stroke="#2c3646" stroke-width="5" stroke-linecap="round" />
              <path v-if="telemetry.regulatorAhead.pose === 'sides'" d="M21 23H4M39 23H56" stroke="#2f3f5c" stroke-width="5" stroke-linecap="round" />
              <path v-else-if="telemetry.regulatorAhead.pose === 'up'" d="M21 23 18 40M39 22 41 2" stroke="#2f3f5c" stroke-width="5" stroke-linecap="round" />
              <path v-else d="M21 23 18 40M39 23 50 32" stroke="#2f3f5c" stroke-width="5" stroke-linecap="round" />
            </svg>
            <div v-if="showHudHints" class="regulator-text"><strong>{{ telemetry.regulatorAhead.allowed.length ? `Можно: ${telemetry.regulatorAhead.allowed.map(m => maneuverWords[m]).join(', ')}` : 'Стоп' }}</strong><small>{{ regulatorText }}</small></div>
          </div>
          <div v-if="telemetry.speedLimit" class="hud-sign active" title="Действующее ограничение скорости"><RoadSignIcon code="3.24" :value="telemetry.speedLimit" /><small v-if="showHudHints">до перекрёстка</small></div>
          <div v-for="sign in hudSigns" :key="sign.id" class="hud-sign" :title="signCatalog[sign.code].name"><RoadSignIcon :code="sign.code" :value="sign.value" /><small v-if="showHudHints">{{ signCatalog[sign.code].name }}</small></div>
        </div>
        <div v-if="telemetry.violations.length" :key="telemetry.violations.length" class="violation-chip" :title="telemetry.violations[telemetry.violations.length - 1].title"><Icon name="hazard" :size="14" />{{ telemetry.violations.length }}</div>
        <div v-if="looking !== 'forward'" class="return-look"><button class="glass-button" @click="look('forward')"><Icon name="camera" :size="16" /> Взгляд вперёд</button></div>
        <div v-if="telemetry.exam && !telemetry.exam.finished" class="inspector-bubble" role="status"><span class="inspector-badge">{{ practiceId ? `ПРАКТИКА · ${practiceSituation?.topic ?? ''}` : `ИНСПЕКТОР · ${Math.min(telemetry.exam.stepIndex + 1, telemetry.exam.steps.length)}/${telemetry.exam.steps.length}` }}</span>{{ telemetry.exam.command }}<small v-if="practiceId && telemetry.speed < 6" class="inspector-hint">{{ practiceScenes[practiceId]?.hint }}</small></div>
        <div v-else-if="!examView && !telemetry.completed" class="inspector-bubble task-bubble" role="status"><span class="inspector-badge">ЗАДАНИЕ · {{ Math.min(telemetry.lessonStep + 1, steps.length) }}/{{ steps.length }}</span>{{ steps[Math.min(telemetry.lessonStep, steps.length - 1)] }}</div>
        <div v-if="message" class="toast" role="status">{{ message }}</div>
        <div v-if="fatal" class="fatal-state"><Icon name="hazard" :size="32" /><p>{{ fatal }}</p></div>

        <div class="control-deck" :class="{ chase: cameraMode === 'chase' }">
          <div class="steering-area"><div class="signal-controls"><button :class="{ lit: telemetry.signal === 'left' || telemetry.signal === 'hazard' }" aria-label="Левый поворотник" @pointerdown="tap($event, () => toggleSignal('left'))" @click="tap($event, () => toggleSignal('left'))"><Icon name="left" /></button><button :class="{ 'hazard-lit': telemetry.signal === 'hazard' }" aria-label="Аварийная сигнализация" @pointerdown="tap($event, () => toggleSignal('hazard'))" @click="tap($event, () => toggleSignal('hazard'))"><Icon name="hazard" :size="18" /></button><button :class="{ lit: telemetry.signal === 'right' || telemetry.signal === 'hazard' }" aria-label="Правый поворотник" @pointerdown="tap($event, () => toggleSignal('right'))" @click="tap($event, () => toggleSignal('right'))"><Icon name="arrow" /></button></div><div class="gear-selector" aria-label="Селектор автоматической коробки"><span>АКПП</span><button v-for="gear in (['P', 'R', 'N', 'D'] as Gear[])" :key="gear" :class="{ selected: telemetry.gear === gear }" :aria-label="`Выбрать ${gear}`" :aria-pressed="telemetry.gear === gear" @pointerdown="tap($event, () => setGear(gear))" @click="tap($event, () => setGear(gear))">{{ gear }}</button></div><div class="steering-caption">{{ wheelPointer !== null ? 'РУЛЕНИЕ' : 'ВРАЩАЙТЕ РУЛЬ' }}</div><button class="steering-wheel" aria-label="Руль: вращайте пальцем или используйте A и D" @pointerdown="wheelDown" @pointermove="wheelMove" @pointerup="wheelUp" @pointercancel="wheelUp" @lostpointercapture="wheelUp"><svg viewBox="0 0 180 180" :style="{ transform: `rotate(${wheelPointer !== null || Math.abs(steerDegrees) > 1 ? steerDegrees : telemetry.steering * 240}deg)` }"><circle class="wheel-outer" cx="90" cy="90" r="75"/><circle class="wheel-inner" cx="90" cy="90" r="58"/><path class="wheel-spoke" d="M74 80 20 64l-4 24 58 10m32-18 54-16 4 24-58 10m-23 8-6 55h26l-6-55"/><circle class="wheel-hub" cx="90" cy="90" r="24"/><text x="90" y="97" text-anchor="middle">У</text><path class="wheel-stripe" d="M86 10h8v15h-8z"/></svg></button><span class="control-key">A / D <span>или пальцем</span></span></div>

          <div class="center-controls">
            <div class="cluster"><svg class="tacho" viewBox="-125 -125 250 250" aria-hidden="true"><circle class="tacho-face" r="112" /><path class="tacho-track" :d="dialArc" /><path class="tacho-red" :d="redArc" /><line v-for="t in dialTicks" :key="t.value" :class="['tacho-tick', { major: t.major, red: t.red }]" :x1="t.a.x" :y1="t.a.y" :x2="t.b.x" :y2="t.b.y" /><text v-for="t in dialTicks.filter(t => t.major)" :key="`l${t.value}`" :class="['tacho-label', { red: t.red }]" :x="t.label.x" :y="t.label.y">{{ t.value / 1000 }}</text><g class="tacho-needle" :style="{ transform: `rotate(${rpmAngle}deg)` }"><path d="M-3 -88 0 -112 3 -88Z" /><circle cy="-88" r="3" /></g></svg>
            <div class="speedometer"><div class="speed-number" :class="{ speeding: telemetry.speedLimit && telemetry.speed > telemetry.speedLimit + .5 }">{{ Math.round(telemetry.speed).toString().padStart(2, '0') }}</div><div class="speed-unit">КМ/Ч</div><div class="rpm-line"><span :style="{ width: `${Math.min(100, telemetry.rpm / 50)}%` }"></span></div><div class="speed-meta"><span>{{ Math.round(telemetry.rpm / 100) / 10 }} <small>×1000 об/мин</small></span><strong>{{ telemetry.gear }}</strong></div></div>
            </div>
          </div>

          <div class="pedals-area"><div class="aux-controls"><button :class="{ engaged: telemetry.belt }" aria-label="Пристегнуть или отстегнуть ремень" @pointerdown="tap($event, toggleBelt)" @click="tap($event, toggleBelt)"><Icon name="belt" :size="18"/><span>Ремень</span><i></i></button><button :class="{ 'handbrake-on': telemetry.handbrake }" aria-label="Включить или снять ручник" @pointerdown="tap($event, toggleHandbrake)" @click="tap($event, toggleHandbrake)"><Icon name="brake" :size="18"/><span>Ручник</span><i></i></button></div><div class="pedals"><button class="pedal brake-pedal" :class="{ pressed: pedals.brake || telemetry.brake > 0 }" aria-label="Тормоз: удерживайте" @pointerdown="pedalDown($event, 'brake')" @pointerup="pedalUp" @pointercancel="pedalUp" @lostpointercapture="pedalUp"><span class="pedal-ribs"></span><strong>ТОРМОЗ</strong><small>S / ↓</small></button><button class="pedal gas-pedal" :class="{ pressed: shownGasLevel > 0 }" aria-label="Газ: чем выше палец на педали, тем сильнее нажатие" @pointerdown="pedalDown($event, 'throttle')" @pointermove="pedalMove" @pointerup="pedalUp" @pointercancel="pedalUp" @lostpointercapture="pedalUp"><span class="gas-scale" aria-hidden="true"><i v-for="level in GAS_LEVELS" :key="level" :class="{ lit: GAS_LEVELS - level < shownGasLevel }"></i></span><strong>ГАЗ</strong><small>W / ↑</small></button></div></div>
        </div>

        <div v-if="!playing && !fatal" class="paused-label"><span>{{ started ? 'ПОЕЗДКА НА ПАУЗЕ' : 'ВСЁ НАЧИНАЕТСЯ С ПЕРВОГО МЕТРА' }}</span><div class="lesson-picker" aria-label="Выбор занятия"><button v-for="(item, index) in lessons" :key="item.id" :class="{ selected: lessonIndex === index }" @click="selectLesson(index)">{{ (index + 1).toString().padStart(2, '0') }} · {{ item.title }}</button><button class="practice-entry" :class="{ selected: !!practiceId }" @click="showPracticeList = true">Ситуации по очереди</button><button class="exam-entry" :class="{ selected: examView && !practiceId }" @click="showExamPicker = true">Экзамен с инспектором</button></div><button @click="play"><Icon name="play" :size="17" />{{ started ? 'Продолжить' : 'За руль' }}</button></div>
        <footer class="scene-footer"><span><i></i> {{ playing ? 'Поездка идёт' : 'Готов к поездке' }}</span><span>{{ telemetry.fps }} FPS <b>·</b> WEB 0.9</span></footer>
      </section>

      <aside class="lesson-panel">
        <template v-if="!examView"><div class="lesson-panel-top"><span class="eyebrow">ВАШ МАРШРУТ ОБУЧЕНИЯ</span><div class="lesson-switch"><span class="lesson-number">{{ (lessonIndex + 1).toString().padStart(2, '0') }} <span>/ {{ lessons.length.toString().padStart(2, '0') }}</span></span><span><button aria-label="Предыдущее занятие" :disabled="lessonIndex === 0" @click="selectLesson(lessonIndex - 1)"><Icon name="left" :size="15" /></button><button aria-label="Следующее занятие" :disabled="lessonIndex === lessons.length - 1" @click="selectLesson(lessonIndex + 1)"><Icon name="arrow" :size="15" /></button></span></div><h2>{{ lesson.title }}</h2><p>{{ lesson.summary }}</p><div class="lesson-tags"><span v-for="tag in lesson.tags" :key="tag">{{ tag }}</span></div></div>
        <div class="lesson-progress"><span>Прогресс занятия <strong>{{ completion }}%</strong></span><div><i :style="{ width: `${completion}%` }"></i></div></div>
        <ol class="lesson-steps"><li v-for="(step, index) in steps" :key="step" :class="{ done: telemetry.lessonStep > index, current: telemetry.lessonStep === index }"><span class="step-circle"><Icon v-if="telemetry.lessonStep > index" name="check" :size="13"/><template v-else>{{ index + 1 }}</template></span><span>{{ step }}</span></li></ol>
        <div class="instructor-note"><span class="note-icon"><Icon :name="telemetry.completed ? 'flag' : 'help'" :size="18" /></span><div><strong>{{ telemetry.completed ? (telemetry.violations.length ? 'Есть над чем поработать' : 'Урок пройден!') : 'Подсказка инструктора' }}</strong><p>{{ instructorText }}</p></div></div>
        </template><template v-else-if="practiceSituation"><div class="lesson-panel-top"><span class="eyebrow">ПРАКТИКА ПО СИТУАЦИЯМ · {{ practiceOrder.indexOf(practiceSituation.id) + 1 }}/{{ practiceOrder.length }}</span><h2>{{ practiceSituation.title }}</h2><p>{{ practiceSituation.summary }}</p><div class="lesson-tags"><span>{{ practiceSituation.topic }}</span><span v-for="tag in practiceRuleTags" :key="tag">{{ tag }}</span></div></div>
        <div class="instructor-note"><span class="note-icon"><Icon name="help" :size="18" /></span><div><strong>Подсказка</strong><p>{{ practiceScenes[practiceSituation.id].hint }}</p></div></div>
        </template><template v-else><div class="lesson-panel-top"><span class="eyebrow">ПРАКТИЧЕСКИЙ ЭКЗАМЕН</span><h2>Экзамен<br>с инспектором</h2><p>Выполняйте команды инспектора. Ошибки разберём после финиша.</p><div v-if="telemetry.mapKind === 'city' && telemetry.exam" class="panel-map"><CityMap :city="cityLayout" :pose="telemetry.pose" :route="telemetry.exam.route" :target="telemetry.exam.target" /></div><div class="lesson-tags"><span v-for="id in telemetry.exam!.selected" :key="id">{{ situations.find(s => s.id === id)?.topic }}</span></div></div>
        <ol class="lesson-steps exam-steps"><li v-for="(step, index) in telemetry.exam!.steps" :key="index" :class="{ done: telemetry.exam!.stepIndex > index, current: telemetry.exam!.stepIndex === index }"><span class="step-circle"><Icon v-if="telemetry.exam!.stepIndex > index" name="check" :size="13"/><template v-else>{{ index + 1 }}</template></span><span>{{ step.command }}</span></li></ol>
        </template><section class="trip-log" aria-label="Журнал поездки"><div class="trip-log-head"><span class="eyebrow">ЖУРНАЛ ПОЕЗДКИ</span><span>{{ telemetry.violations.length ? `${telemetry.violations.length} наруш.` : 'без нарушений' }}</span></div><ol v-if="telemetry.violations.length"><li v-for="item in [...telemetry.violations].reverse()" :key="item.id"><strong>{{ item.title }}</strong><p>{{ item.detail }}</p><small>{{ formatTime(item.time) }}<template v-if="item.rule"> · <button v-for="id in item.ruleIds" :key="id" class="rule-link" @click="openRule(id)">{{ ruleLabel(id) }}</button></template></small></li></ol><p v-else class="trip-log-empty">Судья следит за ремнём, скоростью, сигналами светофора, поворотниками и выездом с проезжей части.</p></section>
        <div class="lesson-actions"><button class="primary-button" @click="play"><Icon :name="playing ? 'pause' : 'play'" :size="17"/>{{ playing ? 'Приостановить' : started ? 'Продолжить поездку' : 'Начать занятие' }}</button><button class="reset-button" @click="reset"><Icon name="reset" :size="16"/>Начать заново</button><button class="reset-button" @click="showPracticeList = true"><Icon name="drive" :size="16"/>Ситуации по очереди</button><button class="reset-button" @click="examView ? leaveExam() : (showExamPicker = true)"><Icon name="flag" :size="16"/>{{ practiceId ? 'Выйти из практики' : examView ? 'Выйти из экзамена' : 'Экзамен с инспектором' }}</button></div>
        <div class="prototype-note"><Icon name="drive" :size="17"/><p>Учебный прототип. Тексты пунктов ПДД — официальная редакция на 01.04.2024; оценка игровая, не официальная процедура ГИБДД.</p></div>
      </aside>
    </main>

    <TicketsPage v-if="tab === 'tickets'" :focus="ticketFocus" @rule="openRule" @consumed="ticketFocus = null" />
    <RulesPage v-if="tab === 'rules'" :focus="ruleFocus" @tickets="openTickets" @consumed="ruleFocus = null" />

    <main v-if="tab === 'progress'" class="content-page progress-page"><div class="page-intro"><span class="eyebrow">МАЛЕНЬКИЕ ШАГИ — БОЛЬШОЙ ПУТЬ</span><h1>Ваш прогресс</h1><p>Результаты сохраняются в этом браузере на вашем устройстве.</p></div><div class="stat-grid"><div><Icon name="flag" :size="26"/><strong>{{ progress.lessons }}</strong><span>Успешных занятий</span></div><div><Icon name="drive" :size="26"/><strong>{{ progress.bestDistance }} <small>м</small></strong><span>Самая длинная поездка</span></div><div><Icon name="ticket" :size="26"/><strong>{{ Object.values(ticketProgress.results).filter(r => r.ok).length }} <small>/ 800</small></strong><span>Вопросов билетов решено верно</span></div><div><Icon name="clock" :size="26"/><strong>{{ ticketProgress.examsPassed }} <small>/ {{ ticketProgress.examsTaken }}</small></strong><span>Экзаменов по билетам сдано</span></div><div><Icon name="flag" :size="26"/><strong>{{ progress.examsPassed }} <small>/ {{ progress.examsTaken }}</small></strong><span>Экзаменов сдано</span></div><div><Icon name="check" :size="26"/><strong>{{ practiceOrder.filter(id => progress.practiceResults[id] === 0).length }} <small>/ {{ practiceOrder.length }}</small></strong><span>Ситуаций без ошибок</span></div></div><section v-for="(item, index) in lessons" :key="item.id" class="progress-lesson"><span class="progress-lesson-icon"><Icon :name="progress.lessonResults[item.id] === 0 ? 'check' : 'drive'" :size="38" /></span><div><span class="eyebrow">ПРАКТИКА · ЗАНЯТИЕ {{ (index + 1).toString().padStart(2, '0') }}</span><h2>{{ item.title }}</h2><p>{{ item.summary }} {{ progress.lessonResults[item.id] === undefined ? 'Ещё не пройдено.' : progress.lessonResults[item.id] === 0 ? 'Пройдено без нарушений.' : `Лучший результат: нарушений — ${progress.lessonResults[item.id]}.` }}</p></div><button class="primary-button" @click="selectLesson(index); tab = 'practice'">За руль<Icon name="arrow" :size="16" /></button></section></main>

    <div v-if="showHelp || showSettings" class="modal-backdrop" @click.self="showHelp = showSettings = false"><section class="modal" role="dialog" aria-modal="true" :aria-label="showHelp ? 'Управление' : 'Настройки'"><button class="modal-close icon-button" aria-label="Закрыть" @click="showHelp = showSettings = false"><Icon name="close"/></button><span class="eyebrow">ГОРОДСКАЯ АВТОШКОЛА</span><h2>{{ showHelp ? 'Всё под рукой' : 'Настроим под вас' }}</h2><template v-if="showHelp"><p>На телефоне вращайте руль пальцем. Газ и тормоз можно удерживать одновременно с рулением.</p><dl class="key-list"><div><dt>W / ↑</dt><dd>Газ</dd></div><div><dt>S / ↓</dt><dd>Тормоз</dd></div><div><dt>A / D</dt><dd>Руль влево / вправо</dd></div><div><dt>1 · 2 · 3 · 4</dt><dd>P · R · N · D</dd></div><div><dt>Q / E</dt><dd>Поворотники</dd></div><div><dt>Пробел / B / C</dt><dd>Ручник / ремень / камера</dd></div><div><dt>Esc</dt><dd>Пауза / продолжение</dd></div></dl><div class="info-banner">Для выхода из P удерживайте тормоз. Затем снимите ручник и плавно нажмите газ.</div></template><template v-else><label class="setting-row">Качество графики<select v-model="settings.quality"><option value="low">Экономичное</option><option value="balanced">Сбалансированное</option><option value="high">Высокое</option></select></label><label class="setting-row">Звук<input v-model="settings.sound" type="checkbox" /></label><label class="setting-row">Голос инспектора<input v-model="settings.voice" type="checkbox" /></label><label class="setting-row">Схема города на экране<input v-model="settings.cityMap" type="checkbox" /></label><label class="setting-row">Подсказки к знакам на экзамене<input v-model="settings.examHints" type="checkbox" /></label><label class="setting-row">Рабочие зеркала<input v-model="settings.mirrors" type="checkbox" /></label><label class="setting-row">Покачивание кузова<input v-model="settings.motion" type="checkbox" /></label><label class="setting-row">Чувствительность руля<input v-model.number="settings.sensitivity" type="range" min="0.5" max="1.5" step="0.1" /></label><p class="settings-note">Если игра замедляется, выберите экономичное качество. Зеркала показывают настоящую обстановку с отдельных камер.</p></template><button class="primary-button" @click="showHelp = showSettings = false">Понятно<Icon name="check" :size="16" /></button></section></div>
    <div v-if="showExamPicker" class="modal-backdrop" @click.self="showExamPicker = false"><section class="modal exam-modal" role="dialog" aria-modal="true" aria-label="Экзамен с инспектором">
      <button class="modal-close icon-button" aria-label="Закрыть" @click="showExamPicker = false"><Icon name="close"/></button>
      <span class="eyebrow">ПРАКТИЧЕСКИЙ ЭКЗАМЕН</span><h2>Экзамен с инспектором</h2>
      <p>Выберите 5 ситуаций — они встанут на перекрёстки города, а инспектор проведёт вас к ним командами «через 100 метров направо», как на настоящем экзамене. Свернёте не туда — будет ошибка и новый маршрут. Темы взяты из экзаменационных билетов.</p>
      <div class="exam-picker">
        <section v-for="group in situationTopics.filter(g => g.items.some(i => i.status === 'ready'))" :key="group.topic"><h3>{{ group.topic }}</h3>
          <button v-for="item in group.items.filter(i => i.status === 'ready')" :key="item.id" class="exam-option" :class="{ picked: examSelection.includes(item.id) }" :disabled="!canPick(item.id)" @click="togglePick(item.id)"><span class="exam-check"><Icon v-if="examSelection.includes(item.id)" name="check" :size="13" /></span><span><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span></button>
        </section>
      </div>
      <details class="exam-planned"><summary>Готовим ещё {{ plannedCount }} ситуаций из билетов</summary><ul><li v-for="item in situations.filter(s => s.status === 'planned')" :key="item.id"><strong>{{ item.title }}</strong> — {{ item.summary }}</li></ul></details>
      <div class="exam-actions"><button class="reset-button" @click="randomExam"><Icon name="reset" :size="16"/>Случайные 5</button><button class="primary-button" :disabled="examSelection.length === 0" @click="startExam"><Icon name="play" :size="16"/>Начать экзамен ({{ examSelection.length }})</button></div>
    </section></div>
    <div v-if="showPracticeList" class="modal-backdrop" @click.self="showPracticeList = false"><section class="modal exam-modal" role="dialog" aria-modal="true" aria-label="Ситуации по очереди">
      <button class="modal-close icon-button" aria-label="Закрыть" @click="showPracticeList = false"><Icon name="close"/></button>
      <span class="eyebrow">ПРАКТИКА</span><h2>Ситуации по очереди</h2>
      <p>Выберите ситуацию — машина сразу окажется перед нужным местом. Одна команда, подсказка перед въездом и короткий разбор.</p>
      <ol class="practice-list">
        <li v-for="(item, index) in practiceItems" :key="item.id"><button class="practice-item" :class="practiceStatus(item)" @click="openPracticeItem(item)">
          <span class="practice-index">{{ (index + 1).toString().padStart(2, '0') }}</span>
          <span class="practice-text"><strong>{{ item.title }}</strong><small>{{ item.kind === 'lesson' ? 'Урок' : item.topic }} · {{ item.summary }}</small></span>
          <span class="practice-status">{{ statusLabel[practiceStatus(item)] }}</span>
        </button></li>
      </ol>
    </section></div>
    <div v-if="showDebrief && examReport" class="modal-backdrop"><section class="modal exam-modal debrief" role="dialog" aria-modal="true" aria-label="Разбор экзамена">
      <div v-if="examReport.passed" class="celebrate" aria-hidden="true"><i v-for="n in 16" :key="n"></i></div>
      <span class="eyebrow">{{ practiceId ? 'РАЗБОР СИТУАЦИИ' : 'РАЗБОР ЭКЗАМЕНА' }}</span>
      <h2 :class="examReport.passed ? 'verdict-ok' : 'verdict-fail'">{{ practiceId ? (examReport.passed ? 'Ситуация пройдена' : examReport.failReason ? 'Ситуация не выполнена' : 'Есть ошибки') : (examReport.passed ? 'Экзамен сдан' : 'Экзамен не сдан') }}</h2>
      <p>{{ examReport.failReason ? `${practiceId ? 'Остановлено' : 'Экзамен прекращён'}: ${examReport.failReason}` : examReport.passed ? 'Ни одной ошибки. Так держать!' : `Ошибок: ${examReport.errors}. Ниже — где и почему.` }}</p>
      <article v-for="card in examReport.cards" :key="card.situation.id" class="debrief-card" :class="[card.outcome, { failed: card.violations.length }]">
        <div class="debrief-schema"><SituationSchema v-if="card.situation.schema" :schema="card.situation.schema" /></div>
        <div class="debrief-body"><h3><Icon :name="card.outcome === 'passed' ? 'check' : card.violations.length ? 'hazard' : 'flag'" :size="16" />{{ card.situation.title }}</h3><p>{{ card.situation.summary }}</p>
          <div v-for="v in card.violations" :key="v.id" class="debrief-error"><img v-if="snapshot(v.id)" :src="snapshot(v.id)" alt="Вид сверху в момент ошибки" /><div><strong>{{ v.title }}</strong><p>{{ v.detail }}</p><small>{{ formatTime(v.time) }}<template v-if="v.rule"> · <button v-for="id in v.ruleIds" :key="id" class="rule-link" @click="openRule(id)">{{ ruleLabel(id) }}</button><button v-if="v.ruleIds.length" class="rule-link" @click="ticketsFor(v.ruleIds[0], v.title)">билеты</button></template></small></div></div>
          <p v-if="outcomeText[card.outcome]" :class="card.outcome === 'passed' ? 'debrief-ok' : 'debrief-skip'">{{ outcomeText[card.outcome] }}</p>
        </div>
      </article>
      <article v-if="examReport.other.length" class="debrief-card failed"><div class="debrief-body"><h3><Icon name="hazard" :size="16" />Другие ошибки на маршруте</h3>
        <div v-for="v in examReport.other" :key="v.id" class="debrief-error"><img v-if="snapshot(v.id)" :src="snapshot(v.id)" alt="Вид сверху в момент ошибки" /><div><strong>{{ v.title }}</strong><p>{{ v.detail }}</p><small>{{ formatTime(v.time) }}<template v-if="v.rule"> · <button v-for="id in v.ruleIds" :key="id" class="rule-link" @click="openRule(id)">{{ ruleLabel(id) }}</button><button v-if="v.ruleIds.length" class="rule-link" @click="ticketsFor(v.ruleIds[0], v.title)">билеты</button></template></small></div></div>
      </div></article>
      <section class="debrief-rules"><h3>Что говорят Правила</h3><p class="rules-edition">Текст ПДД РФ, {{ PDD_EDITION }}</p><details v-for="id in examReport.rules" :key="id"><summary>{{ ruleTexts[id].title }}</summary><p>{{ ruleTexts[id].text }}</p><p class="rule-links"><button class="rule-link" @click="openRule(id)">Открыть в Правилах</button><button class="rule-link" @click="ticketsFor(id, ruleTexts[id].title)">Вопросы из билетов</button></p></details></section>
      <div v-if="practiceId" class="exam-actions"><button class="reset-button" @click="showDebrief = false; showPracticeList = true"><Icon name="drive" :size="16"/>К списку</button><button class="reset-button" @click="startPractice(practiceId)"><Icon name="reset" :size="16"/>Повторить</button><button v-if="nextPractice" class="primary-button" @click="startPractice(nextPractice)">Следующая ситуация<Icon name="arrow" :size="16"/></button></div>
      <div v-else class="exam-actions"><button class="reset-button" @click="leaveExam"><Icon name="close" :size="16"/>Закрыть</button><button class="reset-button" @click="showDebrief = false; showExamPicker = true">Другие ситуации</button><button class="primary-button" @click="startExam"><Icon name="reset" :size="16"/>Пересдать</button></div>
    </section></div>
    <div class="rotate-device"><Icon name="full" :size="38"/><h2>Поверните устройство</h2><p>Для вождения нужен горизонтальный экран.</p></div>
  </div>
</template>
