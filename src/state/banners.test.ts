import { describe, expect, it } from 'vitest';
import { BANNER_STORAGE_KEY, bannerCss, isBanner, isBannerData, isBannerUrl, loadBanners, normalizeBannerUrl, pruneBanners, saveBanners } from './banners';
import type { KeyValueStorage } from './storage';

const png = 'data:image/png;base64,iVBORw0KGgo=';
const webp = 'data:image/webp;base64,UklGRg==';
const link = 'https://example.com/banners/intercessors.png';

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

describe('normalizeBannerUrl / isBannerUrl', () => {
  it('accepts https links and returns them in canonical form', () => {
    expect(normalizeBannerUrl(`  ${link}  `)).toBe(link);
    expect(normalizeBannerUrl('HTTPS://Example.com/a b.png')).toBe('https://example.com/a%20b.png');
    expect(normalizeBannerUrl('https://example.com/a.png?x="y"')).toBe('https://example.com/a.png?x=%22y%22');
    expect(normalizeBannerUrl('https://en.wikipedia.org/wiki/File:A_(b).jpg')).toBe('https://en.wikipedia.org/wiki/File:A_(b).jpg');
    expect(isBannerUrl(link)).toBe(true);
  });

  it('refuses anything else', () => {
    for (const text of ['', 'example.com/a.png', 'http://example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,iVBORw0KGgo=', 'https://user:pw@example.com/a.png', `https://example.com/${'a'.repeat(2048)}`]) {
      expect(normalizeBannerUrl(text)).toBeNull();
    }
    // Only the canonical form counts as a stored link.
    expect(isBannerUrl('HTTPS://example.com/a.png')).toBe(false);
    expect(isBannerUrl('https://example.com/a b.png')).toBe(false);
    expect(isBannerUrl(42)).toBe(false);
  });

  it('turns banners into a CSS value', () => {
    expect(isBanner(png) && isBanner(link)).toBe(true);
    expect(bannerCss(link)).toBe(`url("${link}")`);
    expect(bannerCss(png)).toBe(`url("${png}")`);
    expect(bannerCss('https://example.com/a")')).toBe('');
    expect(bannerCss(undefined)).toBe('');
  });
});

describe('loadBanners / saveBanners', () => {
  it('round trips the banners under their own key', () => {
    const storage = memoryStorage();
    expect(saveBanners({ u1: png, u2: webp, u3: link }, storage)).toBe(true);
    expect(Object.keys(storage.data)).toEqual([BANNER_STORAGE_KEY]);
    expect(loadBanners(storage)).toEqual({ u1: png, u2: webp, u3: link });
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
