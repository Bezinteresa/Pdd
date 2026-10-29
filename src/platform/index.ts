// Hosting platform hooks. The ordinary web build has none; `vite build --mode yandex` adds the Yandex Games SDK.
export interface PlatformHooks {
  /** The platform takes the screen (ad, purchase window, hidden tab): stop driving and fall silent. */
  pause(): void;
  /** The platform gives the screen back: sound may play again; driving stays paused until the player resumes it. */
  resume(): void;
}
export interface Platform {
  /** The game is loaded and the player can start. */
  ready(): void;
  /** Driving started (true) or stopped (false): menus, pause, results. */
  gameplay(active: boolean): void;
}

const none: Platform = { ready() {}, gameplay() {} };

export async function connectPlatform(hooks: PlatformHooks): Promise<Platform> {
  // MODE is replaced at build time, so the ordinary build drops this branch together with the SDK module.
  if (import.meta.env.MODE === 'yandex') {
    try { const { connectYandex } = await import('./yandex'); return await connectYandex(hooks) ?? none; } catch (error) { console.warn('Yandex Games SDK unavailable', error); }
  }
  return none;
}
