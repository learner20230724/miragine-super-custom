export const NEVER_TUTORIAL_KEY = 'miraginewar.never';

/**
 * Adapt the one original SharedObject preference to a synchronous controller
 * store. Desktop preferences do not depend on the ephemeral loopback origin.
 * The preload bridge exposes no paths or general filesystem capabilities.
 */
export async function createPreferenceStorage({
  desktop = globalThis.miragineDesktop,
  browserStorage = () => globalThis.localStorage,
  warn = message => console.warn(message),
} = {}) {
  if (desktop !== undefined && desktop !== null) {
    if (typeof desktop.loadPreferences !== 'function' || typeof desktop.saveNeverTutorial !== 'function') {
      throw new Error('Desktop preferences bridge is incomplete.');
    }
    let preferences;
    try { preferences = await desktop.loadPreferences(); }
    catch { throw new Error('Desktop game preferences could not be loaded.'); }
    if (!preferences || typeof preferences.neverTutorial !== 'boolean') {
      throw new Error('Desktop game preferences have an invalid format.');
    }
    let never = preferences.neverTutorial;
    const saveWarning = () => warn('Game tutorial preference could not be saved.');
    return Object.freeze({
      getItem(key) { return key === NEVER_TUTORIAL_KEY ? String(never) : null; },
      setItem(key, value) {
        if (key !== NEVER_TUTORIAL_KEY) return;
        never = String(value) === 'true';
        // Queue IPC immediately, retaining synchronous SharedObject-like reads.
        // Never log backend errors: their text can contain private local paths.
        try { Promise.resolve(desktop.saveNeverTutorial(never)).catch(saveWarning); }
        catch { saveWarning(); }
      },
    });
  }
  try { return typeof browserStorage === 'function' ? browserStorage() : browserStorage; }
  catch { return null; /* Browser privacy settings can disable localStorage. */ }
}
