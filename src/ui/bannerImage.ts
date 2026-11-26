import { isBannerData } from '../state/banners';

/** Largest size a banner is stored at; bigger images are scaled down (it is shown faintly). */
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 800;
/** Longest data URL kept (about 450 kB of image), so a few banners fit in localStorage. */
export const MAX_BANNER_CHARS = 600_000;
const QUALITIES = [0.82, 0.65, 0.5, 0.35];

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file could not be read as an image.'));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

/**
 * The picked image file as a banner: scaled down to fit 1200 × 800 and encoded as WebP (or
 * PNG where the browser can't), lowering the quality until it fits MAX_BANNER_CHARS. Rejects
 * with a message for the user when it isn't a readable image or stays too big.
 */
export async function prepareBanner(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file (PNG, JPEG, WebP, GIF, …).');
  const img = await loadImage(file);
  const width = img.naturalWidth || MAX_WIDTH;
  const height = img.naturalHeight || MAX_HEIGHT / 2;
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t process images.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of QUALITIES) {
    const data = canvas.toDataURL('image/webp', quality);
    if (isBannerData(data) && data.length <= MAX_BANNER_CHARS) return data;
  }
  throw new Error('This image is too large to keep, even scaled down. Try a smaller or simpler one.');
}
