import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreloadPipeline } from '../services/preload/orchestrator';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const resetPipeline = () => {
  PreloadPipeline.queue = [];
  PreloadPipeline.isProcessing = false;
  PreloadPipeline.currentController = null;
  PreloadPipeline.failedFingerprints.clear();
  PreloadPipeline.lastFingerprintByName = {};
  PreloadPipeline.cache.shadow = null;
  PreloadPipeline.cache.interview = null;
  PreloadPipeline.cache.listening = null;
  PreloadPipeline.cache.dictation = null;
};

describe('PreloadPipeline fingerprint circuit breaker', () => {
  beforeEach(() => {
    resetPipeline();
  });

  it('blocks repeated attempts for the same failed fingerprint', async () => {
    const failingTask = vi.fn(async () => {
      throw new Error('boom');
    });

    PreloadPipeline.enqueue('shadow_preload', 'fingerprint-a', failingTask);
    await flush();
    expect(failingTask).toHaveBeenCalledTimes(1);

    PreloadPipeline.enqueue('shadow_preload', 'fingerprint-a', failingTask);
    await flush();
    expect(failingTask).toHaveBeenCalledTimes(1);
  });

  it('allows retries again after the fingerprint changes', async () => {
    const failingTask = vi.fn(async () => {
      throw new Error('boom');
    });
    const successTask = vi.fn(async () => undefined);
    const reusedFingerprintTask = vi.fn(async () => undefined);

    PreloadPipeline.enqueue('shadow_preload', 'fingerprint-a', failingTask);
    await flush();
    expect(failingTask).toHaveBeenCalledTimes(1);

    PreloadPipeline.enqueue('shadow_preload', 'fingerprint-b', successTask);
    await flush();
    expect(successTask).toHaveBeenCalledTimes(1);

    PreloadPipeline.enqueue('shadow_preload', 'fingerprint-a', reusedFingerprintTask);
    await flush();
    expect(reusedFingerprintTask).toHaveBeenCalledTimes(1);
  });
});
