/**
 * Banner images of units: a picture the user picked on their own PC, shown faintly behind the
 * attacker's Army / Unit pickers. They are kept apart from the rest of the state, under their
 * own localStorage key, so the big strings aren't rewritten on every input change and never
 * end up in an export. Keyed by unit id.
 */

import type { KeyValueStorage } from './storage';

export const BANNER_STORAGE_KEY = 'damage-calculator:banners';

/** Unit id → image as a base64 data URL (see isBannerData). */
export type Banners = Record<string, string>;

/** A base64 data URL of a PNG, JPEG, WebP or GIF image; nothing else is ever put in a style. */
export function isBannerData(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function browserStorage(): KeyValueStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The saved banners; entries that aren't an image data URL are dropped. Never throws. */
export function loadBanners(storage: KeyValueStorage | undefined = browserStorage()): Banners {
  try {
    const raw = storage?.getItem(BANNER_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, data]) => id !== '' && isBannerData(data)));
  } catch {
    return {};
  }
}

/** Save the banners; false when storage is unavailable or full. */
export function saveBanners(banners: Banners, storage: KeyValueStorage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(BANNER_STORAGE_KEY, JSON.stringify(banners));
    return true;
  } catch {
    return false;
  }
}

/** Remove the banners of units that are gone (in place); true when any was removed. */
export function pruneBanners(banners: Banners, unitIds: readonly string[]): boolean {
  const keep = new Set(unitIds);
  let changed = false;
  for (const id of Object.keys(banners)) {
    if (keep.has(id)) continue;
    delete banners[id];
    changed = true;
  }
  return changed;
}
