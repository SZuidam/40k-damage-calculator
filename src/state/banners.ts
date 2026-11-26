/**
 * Banner images of units, shown faintly behind the attacker's Army / Unit pickers: a picture the
 * user picked on their own PC (a data URL) or a link to an online image (an https URL). They are
 * kept apart from the rest of the state, under their own localStorage key, so the big strings
 * aren't rewritten on every input change. Pictures from the PC never end up in an export; links
 * do (see share.ts). Keyed by unit id.
 */

import type { KeyValueStorage } from './storage';

export const BANNER_STORAGE_KEY = 'damage-calculator:banners';

/** Unit id → image as a base64 data URL (isBannerData) or an https link (isBannerUrl). */
export type Banners = Record<string, string>;

/** Longest banner link accepted. */
export const MAX_BANNER_URL = 2048;

/** A base64 data URL of a PNG, JPEG, WebP or GIF image; nothing else is ever put in a style. */
export function isBannerData(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/**
 * An https link in its canonical form (as `new URL(…).href` writes it), so it holds no quotes,
 * backslashes or whitespace and is safe inside `url("…")`.
 */
export function isBannerUrl(value: unknown): value is string {
  return typeof value === 'string' && normalizeBannerUrl(value) === value;
}

/** Anything that may be put in a style: a picture from the PC or an online link. */
export function isBanner(value: unknown): value is string {
  return isBannerData(value) || isBannerUrl(value);
}

/** The typed text as a canonical https link, or null when it isn't one (or is too long). */
export function normalizeBannerUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > MAX_BANNER_URL) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return null;
  const href = url.href;
  return href.length <= MAX_BANNER_URL && !/["\\\s]/.test(href) ? href : null;
}

/** The banner as a CSS background-image value; '' for none. */
export function bannerCss(value: string | undefined | null): string {
  return value && isBanner(value) ? `url("${value}")` : '';
}

function browserStorage(): KeyValueStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The saved banners; entries that aren't an image data URL or https link are dropped. Never throws. */
export function loadBanners(storage: KeyValueStorage | undefined = browserStorage()): Banners {
  try {
    const raw = storage?.getItem(BANNER_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, data]) => id !== '' && isBanner(data)));
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
