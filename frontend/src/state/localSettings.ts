/**
 * Settings that belong to this browser rather than to the open project.
 *
 * Two tiers, and the line between them is what the setting describes. How *this structure* is
 * shown -- representation, colours, which layers are on -- travels with the project, in
 * `viewSettingsSync.ts`. How *this person* works -- the element the draw tool puts down, the force
 * field the optimizer starts from, which dock tab was open -- is a preference that should be the
 * same in the next project, which is what Avogadro's QSettings were (mainwindow.cpp
 * readSettings/writeSettings). There is no user account here, so that tier is `localStorage`.
 *
 * Every access is wrapped: a private window, a browser with site data blocked, or a full quota
 * throws on read as well as on write, and a preference is never worth an exception.
 */

const PREFIX = 'atomscope.';

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback; // unreadable or not JSON: the default is always a working answer
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // nothing to do and nothing worth saying: the session simply will not be remembered
  }
}
