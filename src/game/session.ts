// Pause rules for the practice screen, kept free of Vue so they can be tested.
export interface ModalState { help: boolean; settings: boolean; examPicker: boolean; practiceList: boolean; debrief: boolean; }
export type ModalName = keyof ModalState;

export const anyModal = (m: ModalState) => m.help || m.settings || m.examPicker || m.practiceList || m.debrief;
/** The trip may run only with every dialog closed; a dialog keeps it paused until it is gone. */
export const canResume = (m: ModalState) => !anyModal(m);

/**
 * Esc closes the help, settings, exam picker and practice list dialogs and leaves the trip paused.
 * The exam debrief is not closed by Esc: the result stays until the learner picks an action.
 * Only with no dialog open does Esc toggle the pause.
 */
export function escapeAction(m: ModalState): { close: ModalName[]; togglePause: boolean } {
  if (m.debrief) return { close: [], togglePause: false };
  const close = (['help', 'settings', 'examPicker', 'practiceList'] as ModalName[]).filter(name => m[name]);
  return { close, togglePause: close.length === 0 };
}
