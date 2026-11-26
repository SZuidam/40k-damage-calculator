import { describe, expect, it } from 'vitest';
import { BANNER_STORAGE_KEY, isBannerData, loadBanners, pruneBanners, saveBanners } from './banners';
import type { KeyValueStorage } from './storage';

const png = 'data:image/png;base64,iVBORw0KGgo=';
const webp = 'data:image/webp;base64,UklGRg==';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) };
}

describe('isBannerData', () => {
  it('accepts base64 image data URLs only', () => {
    expect(isBannerData(png)).toBe(true);
    expect(isBannerData(webp)).toBe(true);
    expect(isBannerData('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isBannerData('data:image/png;base64,abc")')).toBe(false);
    expect(isBannerData('https://example.com/a.png')).toBe(false);
    expect(isBannerData(42)).toBe(false);
  });
});

describe('loadBanners / saveBanners', () => {
  it('round trips the banners under their own key', () => {
    const storage = memoryStorage();
    expect(saveBanners({ u1: png, u2: webp }, storage)).toBe(true);
    expect(Object.keys(storage.data)).toEqual([BANNER_STORAGE_KEY]);
    expect(loadBanners(storage)).toEqual({ u1: png, u2: webp });
  });

  it('drops entries that aren’t images and survives junk', () => {
    expect(loadBanners(memoryStorage({ [BANNER_STORAGE_KEY]: JSON.stringify({ u1: png, u2: 'javascript:alert(1)', u3: 7, '': png }) }))).toEqual({ u1: png });
    expect(loadBanners(memoryStorage({ [BANNER_STORAGE_KEY]: '{oops' }))).toEqual({});
    expect(loadBanners(memoryStorage({ [BANNER_STORAGE_KEY]: '[1]' }))).toEqual({});
    expect(loadBanners(memoryStorage())).toEqual({});
    expect(loadBanners(undefined)).toEqual({});
  });

  it('reports a full or missing storage', () => {
    const full: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(saveBanners({ u1: png }, full)).toBe(false);
    expect(saveBanners({ u1: png }, undefined)).toBe(false);
  });
});

describe('pruneBanners', () => {
  it('removes the banners of units that are gone', () => {
    const banners = { u1: png, gone: webp };
    expect(pruneBanners(banners, ['u1', 'u2'])).toBe(true);
    expect(banners).toEqual({ u1: png });
    expect(pruneBanners(banners, ['u1'])).toBe(false);
  });
});
