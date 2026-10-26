<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { DrivingEngine, type CameraMode, type GameSettings, type Look, type Telemetry } from './game/engine';
import type { Gear } from './game/vehicle';
import { lessons } from './game/lesson';
import { lampLabel } from './game/signals';
import { questions } from './theory';

const canvasHost = ref<HTMLElement>();
const mirrorLeft = ref<HTMLElement>(), mirrorRear = ref<HTMLElement>(), mirrorRight = ref<HTMLElement>();
const tab = ref<'practice' | 'theory' | 'progress'>('practice');
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
const telemetry = reactive<Telemetry>({ speed: 0, rpm: 850, gear: 'P', belt: false, handbrake: true, signal: null, steering: 0, distance: 0, fps: 60, lessonId: lessons[0].id, lessonStep: 0, completed: false, moving: false, speedLimit: null, collisions: 0, violations: [], signalAhead: null, tripTime: 0 });
const defaults: GameSettings = { quality: 'balanced', mirrors: true, motion: true, sensitivity: 1 };
function readSaved<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Browsers can deny storage; driving remains available. */ } }
const storedSettings = readSaved<Partial<GameSettings>>('pdd-settings-v1', {});
const settings = reactive<GameSettings>({ ...defaults, ...storedSettings, quality: ['low', 'balanced', 'high'].includes(storedSettings.quality || '') ? storedSettings.quality! : 'balanced', sensitivity: Math.max(.5, Math.min(1.5, Number(storedSettings.sensitivity) || 1)) });
// v1 saves lack lesson results; missing fields fall back to defaults so old progress survives.
const progress = reactive({ lessons: 0, bestDistance: 0, theoryCorrect: [] as number[], lessonResults: {} as Record<string, number>, violations: 0, ...readSaved<object>('pdd-progress-v1', {}) });
const lessonIndex = ref(Math.max(0, lessons.findIndex(l => l.id === readSaved('pdd-lesson-v1', lessons[0].id))));
const lesson = computed(() => lessons[lessonIndex.value]);
const steps = computed(() => lesson.value.steps);
const completion = computed(() => Math.round(Math.min(telemetry.lessonStep, steps.value.length) / steps.value.length * 100));
const instructorText = computed(() => telemetry.completed ? (telemetry.violations.length ? `Урок засчитан с ошибками (${telemetry.violations.length}). Разберите журнал и повторите заезд без нарушений.` : 'Урок пройден без нарушений. Продолжайте поездку или выберите следующее занятие.') : lesson.value.hints[Math.min(telemetry.lessonStep, lesson.value.hints.length - 1)]);
const lampClass = computed(() => telemetry.signalAhead ? ({ green: 'go', greenFlash: 'go flash', yellow: 'warn', redYellow: 'stop warn', red: 'stop' } as const)[telemetry.signalAhead.lamp] : '');
const formatTime = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
const questionIndex = ref(0), selectedAnswer = ref<number | null>(null);
const question = computed(() => questions[questionIndex.value]);
let engine: DrivingEngine | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let previouslyCompleted = false;
let wheelReturnFrame = 0;

function notify(text: string) { message.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => message.value = '', 4200); }
function applyCamera(mode: CameraMode) { cameraMode.value = mode; looking.value = 'forward'; engine?.setCamera(mode); }
function look(value: Look) { looking.value = value; engine?.setLook(value); }
function play() { if (!engine) return; started.value = true; playing.value = !playing.value; engine.setPaused(!playing.value); clearControls(); }
function pause() { playing.value = false; engine?.setPaused(true); clearControls(); }
function reset() { pause(); engine?.reset(); steerDegrees.value = 0; previouslyCompleted = false; looking.value = 'forward'; }
function setGear(value: Gear) { engine?.gear(value); }
function selectLesson(index: number) { if (index < 0 || index >= lessons.length) return; pause(); lessonIndex.value = index; save('pdd-lesson-v1', lessons[index].id); engine?.setLesson(lessons[index].id); steerDegrees.value = 0; previouslyCompleted = false; looking.value = 'forward'; }
function keyAngle(event: PointerEvent, element: HTMLElement) { const rect = element.getBoundingClientRect(); return Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2); }
function wheelDown(event: PointerEvent) {
  if (!playing.value || wheelPointer.value !== null) return;
  event.preventDefault(); cancelAnimationFrame(wheelReturnFrame); wheelPointer.value = event.pointerId;
  const target = event.currentTarget as HTMLElement; target.setPointerCapture(event.pointerId); wheelLastAngle.value = keyAngle(event, target);
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
function pedalDown(event: PointerEvent, pedal: 'throttle' | 'brake') {
  if (!playing.value) return; event.preventDefault(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); pedalPointers.set(event.pointerId, pedal); pedals[pedal] = true; if (engine) engine.input[pedal] = 1;
}
function pedalUp(event: PointerEvent) { const pedal = pedalPointers.get(event.pointerId); if (!pedal) return; pedalPointers.delete(event.pointerId); if (![...pedalPointers.values()].includes(pedal)) { pedals[pedal] = false; if (engine) engine.input[pedal] = 0; } }
function clearControls() { cancelAnimationFrame(wheelReturnFrame); wheelPointer.value = null; steerDegrees.value = 0; pedalPointers.clear(); pedals.throttle = pedals.brake = false; engine?.releaseInput(); }
function fullscreen() { if (document.fullscreenElement) document.exitFullscreen().catch(() => notify('Не удалось выйти из полного экрана')); else document.documentElement.requestFullscreen?.().catch(() => notify('Полный экран недоступен в этом браузере')); }
function answer(index: number) { if (selectedAnswer.value !== null) return; selectedAnswer.value = index; if (index === question.value.correct && !progress.theoryCorrect.includes(questionIndex.value)) progress.theoryCorrect.push(questionIndex.value); }
function nextQuestion() { questionIndex.value = (questionIndex.value + 1) % questions.length; selectedAnswer.value = null; }
function keyboard(event: KeyboardEvent) { if (event.code === 'Escape') { if (showHelp.value || showSettings.value) { showHelp.value = showSettings.value = false; } else if (tab.value === 'practice') play(); } }
watch(settings, value => { engine?.updateSettings(value); save('pdd-settings-v1', value); }, { deep: true });
watch(progress, value => save('pdd-progress-v1', value), { deep: true });
watch(tab, async value => { pause(); engine?.setSuspended(value !== 'practice'); if (value === 'practice') { await nextTick(); window.dispatchEvent(new Event('resize')); } });
watch([showHelp, showSettings], ([help, prefs]) => { if (help || prefs) pause(); });
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
    engine.setMirrorElements([mirrorLeft.value!, mirrorRear.value!, mirrorRight.value!]); engine.updateSettings(settings); if (lessonIndex.value > 0) engine.setLesson(lesson.value.id);
  } catch (error) { fatal.value = 'Не удалось запустить 3D. Проверьте поддержку WebGL и аппаратное ускорение браузера.'; console.error(error); }
  window.addEventListener('keydown', keyboard);
});
onBeforeUnmount(() => { clearTimeout(toastTimer); cancelAnimationFrame(wheelReturnFrame); window.removeEventListener('keydown', keyboard); engine?.dispose(); });
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <a class="brand" href="#" @click.prevent="tab = 'practice'"><span class="brand-mark">У</span><span><strong>ГОРОДСКАЯ</strong><small>АВТОШКОЛА</small></span></a>
      <nav class="main-nav" aria-label="Разделы">
        <button :class="{ active: tab === 'practice' }" @click="tab = 'practice'"><Icon name="drive" />Практика</button>
        <button :class="{ active: tab === 'theory' }" @click="tab = 'theory'"><Icon name="book" />Теория</button>
        <button :class="{ active: tab === 'progress' }" @click="tab = 'progress'"><Icon name="chart" />Прогресс</button>
      </nav>
      <div class="header-right"><span class="prototype"><i></i> ПРОТОТИП 0.2</span><button class="icon-button" aria-label="Настройки" @click="showSettings = true"><Icon name="gear" /></button></div>
    </header>

    <main v-show="tab === 'practice'" class="practice-layout">
      <section class="simulator" aria-label="Симулятор вождения">
        <div ref="canvasHost" class="canvas-host"></div>
        <div class="scene-heading"><span class="eyebrow">ПРАКТИЧЕСКОЕ ЗАНЯТИЕ</span><h1>{{ lesson.heading }}</h1><div class="location"><Icon name="pin" :size="14" /> Учебный квартал <span>•</span> Сухая дорога <Icon name="sun" :size="14" /></div></div>
        <div class="scene-tools"><button class="glass-button" aria-label="Помощь по управлению" @click="showHelp = true"><Icon name="help" /></button><button class="glass-button" aria-label="Полный экран" @click="fullscreen"><Icon name="full" /></button></div>
        <div class="camera-switch"><button :class="{ selected: cameraMode === 'cockpit' }" @click="applyCamera('cockpit')">Из кабины</button><button :class="{ selected: cameraMode === 'chase' }" @click="applyCamera('chase')">От третьего лица</button></div>

        <div class="mirrors" :class="{ 'mirrors-disabled': !settings.mirrors }">
          <button class="mirror-frame mirror-left" :class="{ focused: looking === 'left' }" aria-label="Посмотреть в левое зеркало" @click="look(looking === 'left' ? 'forward' : 'left')"><span ref="mirrorLeft" class="mirror-view"></span><span class="mirror-label">ЛЕВОЕ</span></button>
          <button class="mirror-frame mirror-rear" :class="{ focused: looking === 'rear' }" aria-label="Посмотреть в зеркало заднего вида" @click="look(looking === 'rear' ? 'forward' : 'rear')"><span ref="mirrorRear" class="mirror-view"></span><span class="mirror-label">ЗАДНИЙ ВИД</span></button>
          <button class="mirror-frame mirror-right" :class="{ focused: looking === 'right' }" aria-label="Посмотреть в правое зеркало" @click="look(looking === 'right' ? 'forward' : 'right')"><span ref="mirrorRight" class="mirror-view"></span><span class="mirror-label">ПРАВОЕ</span></button>
        </div>

        <div v-if="telemetry.speedLimit" class="road-sign" title="Действующее ограничение скорости">{{ telemetry.speedLimit }}</div>
        <div v-if="telemetry.signalAhead" class="signal-ahead" :class="lampClass" :title="`Светофор впереди: ${lampLabel[telemetry.signalAhead.lamp]}`"><span class="lamp-r"></span><span class="lamp-y"></span><span class="lamp-g"></span><small>{{ Math.max(0, Math.round(telemetry.signalAhead.distance)) }} м</small></div>
        <div v-if="telemetry.violations.length" class="violation-chip" :title="telemetry.violations[telemetry.violations.length - 1].title"><Icon name="hazard" :size="14" />{{ telemetry.violations.length }}</div>
        <div v-if="looking !== 'forward'" class="return-look"><button class="glass-button" @click="look('forward')"><Icon name="camera" :size="16" /> Взгляд вперёд</button></div>
        <div v-if="message" class="toast" role="status">{{ message }}</div>
        <div v-if="fatal" class="fatal-state"><Icon name="hazard" :size="32" /><p>{{ fatal }}</p></div>

        <div class="control-deck">
          <div class="steering-area"><div class="steering-caption">{{ wheelPointer !== null ? 'РУЛЕНИЕ' : 'ВРАЩАЙТЕ РУЛЬ' }}</div><button class="steering-wheel" aria-label="Руль: вращайте пальцем или используйте A и D" @pointerdown="wheelDown" @pointermove="wheelMove" @pointerup="wheelUp" @pointercancel="wheelUp" @lostpointercapture="wheelUp"><svg viewBox="0 0 180 180" :style="{ transform: `rotate(${wheelPointer !== null || Math.abs(steerDegrees) > 1 ? steerDegrees : telemetry.steering * 240}deg)` }"><circle class="wheel-outer" cx="90" cy="90" r="75"/><circle class="wheel-inner" cx="90" cy="90" r="58"/><path class="wheel-spoke" d="M74 80 20 64l-4 24 58 10m32-18 54-16 4 24-58 10m-23 8-6 55h26l-6-55"/><circle class="wheel-hub" cx="90" cy="90" r="24"/><text x="90" y="97" text-anchor="middle">У</text><path class="wheel-stripe" d="M86 10h8v15h-8z"/></svg></button><span class="control-key">A / D <span>или пальцем</span></span></div>

          <div class="center-controls">
            <div class="signal-controls"><button :class="{ lit: telemetry.signal === 'left' || telemetry.signal === 'hazard' }" aria-label="Левый поворотник" @click="engine?.toggleSignal('left')"><Icon name="left" /></button><button :class="{ 'hazard-lit': telemetry.signal === 'hazard' }" aria-label="Аварийная сигнализация" @click="engine?.toggleSignal('hazard')"><Icon name="hazard" :size="18" /></button><button :class="{ lit: telemetry.signal === 'right' || telemetry.signal === 'hazard' }" aria-label="Правый поворотник" @click="engine?.toggleSignal('right')"><Icon name="arrow" /></button></div>
            <div class="speedometer"><div class="speed-number" :class="{ speeding: telemetry.speedLimit && telemetry.speed > telemetry.speedLimit + .5 }">{{ Math.round(telemetry.speed).toString().padStart(2, '0') }}</div><div class="speed-unit">КМ/Ч</div><div class="rpm-line"><span :style="{ width: `${Math.min(100, telemetry.rpm / 50)}%` }"></span></div><div class="speed-meta"><span>{{ Math.round(telemetry.rpm / 100) / 10 }} <small>×1000 об/мин</small></span><strong>{{ telemetry.gear }}</strong></div></div>
            <div class="aux-controls"><button :class="{ engaged: telemetry.belt }" aria-label="Пристегнуть или отстегнуть ремень" @click="engine?.toggleBelt()"><Icon name="belt" :size="18"/><span>Ремень</span><i></i></button><button :class="{ 'handbrake-on': telemetry.handbrake }" aria-label="Включить или снять ручник" @click="engine?.toggleHandbrake()"><Icon name="brake" :size="18"/><span>Ручник</span><i></i></button></div>
          </div>

          <div class="pedals-area"><div class="gear-selector" aria-label="Селектор автоматической коробки"><span>АКПП</span><button v-for="gear in (['P', 'R', 'N', 'D'] as Gear[])" :key="gear" :class="{ selected: telemetry.gear === gear }" :aria-label="`Выбрать ${gear}`" :aria-pressed="telemetry.gear === gear" @click="setGear(gear)">{{ gear }}</button></div><div class="pedals"><button class="pedal brake-pedal" :class="{ pressed: pedals.brake }" aria-label="Тормоз: удерживайте" @pointerdown="pedalDown($event, 'brake')" @pointerup="pedalUp" @pointercancel="pedalUp" @lostpointercapture="pedalUp"><span class="pedal-ribs"></span><strong>ТОРМОЗ</strong><small>S / ↓</small></button><button class="pedal gas-pedal" :class="{ pressed: pedals.throttle }" aria-label="Газ: удерживайте" @pointerdown="pedalDown($event, 'throttle')" @pointerup="pedalUp" @pointercancel="pedalUp" @lostpointercapture="pedalUp"><span class="pedal-ribs"></span><strong>ГАЗ</strong><small>W / ↑</small></button></div></div>
        </div>

        <div v-if="!playing && !fatal" class="paused-label"><span>{{ started ? 'ПОЕЗДКА НА ПАУЗЕ' : 'ВСЁ НАЧИНАЕТСЯ С ПЕРВОГО МЕТРА' }}</span><div class="lesson-picker" aria-label="Выбор занятия"><button v-for="(item, index) in lessons" :key="item.id" :class="{ selected: lessonIndex === index }" @click="selectLesson(index)">{{ (index + 1).toString().padStart(2, '0') }} · {{ item.title }}</button></div><button @click="play"><Icon name="play" :size="17" />{{ started ? 'Продолжить' : 'За руль' }}</button></div>
        <footer class="scene-footer"><span><i></i> {{ playing ? 'Поездка идёт' : 'Готов к поездке' }}</span><span>{{ telemetry.fps }} FPS <b>·</b> WEB 0.2</span></footer>
      </section>

      <aside class="lesson-panel">
        <div class="lesson-panel-top"><span class="eyebrow">ВАШ МАРШРУТ ОБУЧЕНИЯ</span><div class="lesson-switch"><span class="lesson-number">{{ (lessonIndex + 1).toString().padStart(2, '0') }} <span>/ {{ lessons.length.toString().padStart(2, '0') }}</span></span><span><button aria-label="Предыдущее занятие" :disabled="lessonIndex === 0" @click="selectLesson(lessonIndex - 1)"><Icon name="left" :size="15" /></button><button aria-label="Следующее занятие" :disabled="lessonIndex === lessons.length - 1" @click="selectLesson(lessonIndex + 1)"><Icon name="arrow" :size="15" /></button></span></div><h2>{{ lesson.title }}</h2><p>{{ lesson.summary }}</p><div class="lesson-tags"><span v-for="tag in lesson.tags" :key="tag">{{ tag }}</span></div></div>
        <div class="lesson-progress"><span>Прогресс занятия <strong>{{ completion }}%</strong></span><div><i :style="{ width: `${completion}%` }"></i></div></div>
        <ol class="lesson-steps"><li v-for="(step, index) in steps" :key="step" :class="{ done: telemetry.lessonStep > index, current: telemetry.lessonStep === index }"><span class="step-circle"><Icon v-if="telemetry.lessonStep > index" name="check" :size="13"/><template v-else>{{ index + 1 }}</template></span><span>{{ step }}</span></li></ol>
        <div class="instructor-note"><span class="note-icon"><Icon :name="telemetry.completed ? 'flag' : 'help'" :size="18" /></span><div><strong>{{ telemetry.completed ? (telemetry.violations.length ? 'Есть над чем поработать' : 'Урок пройден!') : 'Подсказка инструктора' }}</strong><p>{{ instructorText }}</p></div></div>
        <section class="trip-log" aria-label="Журнал поездки"><div class="trip-log-head"><span class="eyebrow">ЖУРНАЛ ПОЕЗДКИ</span><span>{{ telemetry.violations.length ? `${telemetry.violations.length} наруш.` : 'без нарушений' }}</span></div><ol v-if="telemetry.violations.length"><li v-for="item in [...telemetry.violations].reverse()" :key="item.id"><strong>{{ item.title }}</strong><p>{{ item.detail }}</p><small>{{ formatTime(item.time) }}<template v-if="item.rule"> · {{ item.rule }}</template></small></li></ol><p v-else class="trip-log-empty">Судья следит за ремнём, скоростью, сигналами светофора, поворотниками и выездом с проезжей части.</p></section>
        <div class="lesson-actions"><button class="primary-button" @click="play"><Icon :name="playing ? 'pause' : 'play'" :size="17"/>{{ playing ? 'Приостановить' : started ? 'Продолжить поездку' : 'Начать занятие' }}</button><button class="reset-button" @click="reset"><Icon name="reset" :size="16"/>Начать заново</button></div>
        <div class="prototype-note"><Icon name="drive" :size="17"/><p>Учебный прототип. Ссылки на ПДД требуют сверки с актуальной редакцией; пешеходы, уступание и трамваи — следующие этапы.</p></div>
      </aside>
    </main>

    <main v-if="tab === 'theory'" class="content-page theory-page">
      <div class="page-intro"><span class="eyebrow">ПОНИМАТЬ, А НЕ ЗАПОМИНАТЬ</span><h1>Теория за рулём</h1><p>Короткая авторская подборка к первому практическому занятию.</p><div class="info-banner"><Icon name="book" :size="18" /> Это учебные вопросы. Полную проверенную базу официальных билетов добавим отдельным этапом.</div></div>
      <div class="theory-layout"><aside class="topic-list"><span class="eyebrow">ПОДГОТОВКА И УПРАВЛЕНИЕ</span><button v-for="(item, index) in questions" :key="item.topic" :class="{ active: questionIndex === index }" @click="questionIndex = index; selectedAnswer = null"><span>{{ (index + 1).toString().padStart(2, '0') }}</span>{{ item.topic }}<Icon v-if="progress.theoryCorrect.includes(index)" name="check" :size="16" /></button></aside><section class="question-card"><div class="question-top"><span>{{ question.topic }}</span><span>{{ questionIndex + 1 }} / {{ questions.length }}</span></div><div class="question-illustration"><span class="big-gear">{{ questionIndex === 1 || questionIndex === 2 ? 'D' : 'У' }}</span><div><small>ГОРОДСКАЯ АВТОШКОЛА</small><strong>{{ question.topic }}</strong></div><Icon name="drive" :size="84" /></div><h2>{{ question.question }}</h2><div class="answer-list"><button v-for="(option, index) in question.answers" :key="option" :disabled="selectedAnswer !== null" :class="{ correct: selectedAnswer !== null && index === question.correct, wrong: selectedAnswer === index && index !== question.correct }" @click="answer(index)"><span>{{ index + 1 }}</span>{{ option }}<Icon v-if="selectedAnswer !== null && index === question.correct" name="check" /></button></div><div v-if="selectedAnswer !== null" class="explanation"><strong>{{ selectedAnswer === question.correct ? 'Верно!' : 'Разберём ответ' }}</strong><p>{{ question.explanation }}</p></div><button v-if="selectedAnswer !== null" class="primary-button next-question" @click="nextQuestion">Следующий вопрос<Icon name="arrow" :size="17" /></button></section></div>
    </main>

    <main v-if="tab === 'progress'" class="content-page progress-page"><div class="page-intro"><span class="eyebrow">МАЛЕНЬКИЕ ШАГИ — БОЛЬШОЙ ПУТЬ</span><h1>Ваш прогресс</h1><p>Результаты сохраняются в этом браузере на вашем устройстве.</p></div><div class="stat-grid"><div><Icon name="flag" :size="26"/><strong>{{ progress.lessons }}</strong><span>Успешных занятий</span></div><div><Icon name="drive" :size="26"/><strong>{{ progress.bestDistance }} <small>м</small></strong><span>Самая длинная поездка</span></div><div><Icon name="book" :size="26"/><strong>{{ progress.theoryCorrect.length }} <small>/ {{ questions.length }}</small></strong><span>Вопросов разобрано верно</span></div></div><section v-for="(item, index) in lessons" :key="item.id" class="progress-lesson"><span class="progress-lesson-icon"><Icon :name="progress.lessonResults[item.id] === 0 ? 'check' : 'drive'" :size="38" /></span><div><span class="eyebrow">ПРАКТИКА · ЗАНЯТИЕ {{ (index + 1).toString().padStart(2, '0') }}</span><h2>{{ item.title }}</h2><p>{{ item.summary }} {{ progress.lessonResults[item.id] === undefined ? 'Ещё не пройдено.' : progress.lessonResults[item.id] === 0 ? 'Пройдено без нарушений.' : `Лучший результат: нарушений — ${progress.lessonResults[item.id]}.` }}</p></div><button class="primary-button" @click="selectLesson(index); tab = 'practice'">За руль<Icon name="arrow" :size="16" /></button></section></main>

    <div v-if="showHelp || showSettings" class="modal-backdrop" @click.self="showHelp = showSettings = false"><section class="modal" role="dialog" aria-modal="true" :aria-label="showHelp ? 'Управление' : 'Настройки'"><button class="modal-close icon-button" aria-label="Закрыть" @click="showHelp = showSettings = false"><Icon name="close"/></button><span class="eyebrow">ГОРОДСКАЯ АВТОШКОЛА</span><h2>{{ showHelp ? 'Всё под рукой' : 'Настроим под вас' }}</h2><template v-if="showHelp"><p>На телефоне вращайте руль пальцем. Газ и тормоз можно удерживать одновременно с рулением.</p><dl class="key-list"><div><dt>W / ↑</dt><dd>Газ</dd></div><div><dt>S / ↓</dt><dd>Тормоз</dd></div><div><dt>A / D</dt><dd>Руль влево / вправо</dd></div><div><dt>1 · 2 · 3 · 4</dt><dd>P · R · N · D</dd></div><div><dt>Q / E</dt><dd>Поворотники</dd></div><div><dt>Пробел / B / C</dt><dd>Ручник / ремень / камера</dd></div><div><dt>Esc</dt><dd>Пауза / продолжение</dd></div></dl><div class="info-banner">Для выхода из P удерживайте тормоз. Затем снимите ручник и плавно нажмите газ.</div></template><template v-else><label class="setting-row">Качество графики<select v-model="settings.quality"><option value="low">Экономичное</option><option value="balanced">Сбалансированное</option><option value="high">Высокое</option></select></label><label class="setting-row">Рабочие зеркала<input v-model="settings.mirrors" type="checkbox" /></label><label class="setting-row">Покачивание кузова<input v-model="settings.motion" type="checkbox" /></label><label class="setting-row">Чувствительность руля<input v-model.number="settings.sensitivity" type="range" min="0.5" max="1.5" step="0.1" /></label><p class="settings-note">Если игра замедляется, выберите экономичное качество. Зеркала показывают настоящую обстановку с отдельных камер.</p></template><button class="primary-button" @click="showHelp = showSettings = false">Понятно<Icon name="check" :size="16" /></button></section></div>
    <div class="rotate-device"><Icon name="full" :size="38"/><h2>Поверните устройство</h2><p>Для вождения нужен горизонтальный экран.</p></div>
  </div>
</template>
