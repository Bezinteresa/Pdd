// Yandex Games SDK (https://yandex.ru/dev/games/doc/ru/sdk/sdk-about). index.html of the yandex build loads /sdk.js,
// which defines window.YaGames. Opened anywhere else (local dist, own site) the script is missing and the game runs as usual.
import type { Platform, PlatformHooks } from './index';

interface YandexSdk {
  features: { LoadingAPI?: { ready(): void }; GameplayAPI?: { start(): void; stop(): void } };
  on(event: 'game_api_pause' | 'game_api_resume', callback: () => void): void;
}
declare global { interface Window { YaGames?: { init(): Promise<YandexSdk> } } }

export async function connectYandex(hooks: PlatformHooks): Promise<Platform | null> {
  // Moderation rules 1.6.1.8 / 1.6.2.7: no context menu and no text selection on long tap or drag (styles in style.css).
  document.documentElement.classList.add('platform-yandex');
  document.addEventListener('contextmenu', event => event.preventDefault());
  if (!window.YaGames) return null;
  const ysdk = await window.YaGames.init();
  ysdk.on('game_api_pause', hooks.pause);
  ysdk.on('game_api_resume', hooks.resume);
  let active = false;
  return {
    ready() { ysdk.features.LoadingAPI?.ready(); },
    gameplay(value) {
      if (value === active) return;
      active = value;
      if (value) ysdk.features.GameplayAPI?.start(); else ysdk.features.GameplayAPI?.stop();
    },
  };
}
