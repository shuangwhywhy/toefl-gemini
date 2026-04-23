import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  fetchNeuralTtsMock: vi.fn(),
  fetchGeminiTextMock: vi.fn(),
  requestTranscriptionMock: vi.fn(),
  playBeepMock: vi.fn(),
  dbGetMock: vi.fn(),
  dbSetMock: vi.fn(),
  sessionCounter: 0
}));

vi.mock('../features/chat/AITutorChat', () => ({
  AITutorChat: () => <div>chat</div>
}));

vi.mock('../services/audio/playback', () => ({
  playBeep: hoisted.playBeepMock
}));

vi.mock('../services/llm/helpers', () => ({
  fetchGeminiText: hoisted.fetchGeminiTextMock,
  fetchNeuralTTS: hoisted.fetchNeuralTtsMock,
  requestTranscription: hoisted.requestTranscriptionMock
}));

vi.mock('../services/requestScope', () => ({
  useRequestScope: () => ({
    scopeId: 'shadow-scope',
    beginSession: () => ++hoisted.sessionCounter,
    invalidateSession: () => ++hoisted.sessionCounter,
    isSessionCurrent: () => true
  })
}));

vi.mock('../services/storage/db', () => ({
  DBUtils: {
    get: hoisted.dbGetMock,
    set: hoisted.dbSetMock
  }
}));

vi.mock('../services/preload/orchestrator', () => ({
  PreloadPipeline: {
    enqueue: hoisted.enqueueMock,
    abortCurrent: vi.fn(),
    cache: {
      shadow: null,
      interview: null,
      listening: null,
      dictation: null
    }
  }
}));

import { ShadowingModule } from '../features/shadowing/ShadowingModule';
import { DEFAULT_SHADOW_VOICE } from '../features/shared/preloadTasks';

describe('Shadowing preload voice policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hoisted.sessionCounter = 0;
    hoisted.enqueueMock.mockReset();
    hoisted.fetchNeuralTtsMock.mockReset();
    hoisted.fetchGeminiTextMock.mockReset();
    hoisted.requestTranscriptionMock.mockReset();
    hoisted.playBeepMock.mockReset();
    hoisted.dbSetMock.mockReset();
    hoisted.dbGetMock.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'shadow_text') {
        return 'This is a saved practice sentence.';
      }
      return fallback;
    });
    hoisted.fetchNeuralTtsMock.mockResolvedValue('https://example.com/audio.wav');
  });

  it('keeps background preload on the default voice even after the user switches voice', async () => {
    const { container } = render(<ShadowingModule onBack={() => undefined} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Zephyr' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(hoisted.enqueueMock).toHaveBeenCalled();
    const [, fingerprint] = hoisted.enqueueMock.mock.calls.at(-1) ?? [];
    expect(fingerprint).toContain(`"voice":"${DEFAULT_SHADOW_VOICE}"`);
  });
});
