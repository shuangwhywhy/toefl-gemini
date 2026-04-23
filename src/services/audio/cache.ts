import { DBUtils } from '../storage/db';

const memoryCache = new Map<string, string>();

export const globalAudioCache = {
  async get(key: string): Promise<string | null> {
    // 1. Check memory cache first
    if (memoryCache.has(key)) {
      return memoryCache.get(key) || null;
    }

    // 2. Check IndexedDB
    const stored = await DBUtils.get<{ data: ArrayBuffer; mimeType: string } | null>(
      `audio_cache_${key}`,
      null
    );
    if (stored) {
      const url = URL.createObjectURL(new Blob([stored.data], { type: stored.mimeType }));
      memoryCache.set(key, url);
      return url;
    }

    return null;
  },

  async set(key: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    memoryCache.set(key, url);

    // Persist to IndexedDB
    const buffer = await blob.arrayBuffer();
    await DBUtils.set(`audio_cache_${key}`, {
      data: buffer,
      mimeType: blob.type
    });
  },

  has(key: string): boolean {
    return memoryCache.has(key);
  }
};
