import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  fetchNeuralTtsMock: vi.fn(),
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

vi.mock('../services/llm/helpers', async () => {
  const actual = await vi.importActual('../services/llm/helpers');
  return {
    ...actual,
    fetchNeuralTTS: hoisted.fetchNeuralTtsMock,
    requestTranscription: hoisted.requestTranscriptionMock
  };
});

vi.mock('../services/requestScope', () => ({
  useRequestScope: () => ({
    scopeId: 'interview-scope',
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
    enqueue: vi.fn(),
    abortCurrent: vi.fn(),
    cache: {
      shadow: null,
      interview: null,
      listening: null,
      dictation: null
    }
  }
}));

import { InterviewModule } from '../features/interview/InterviewModule';
import { PreloadPipeline } from '../services/preload/orchestrator';

class MockMediaRecorder {
  public state = 'inactive';
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;

  constructor(public readonly stream: MediaStream) {}

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

describe('InterviewModule audio warmup', () => {
  beforeEach(() => {
    hoisted.sessionCounter = 0;
    hoisted.fetchNeuralTtsMock.mockReset();
    hoisted.requestTranscriptionMock.mockReset();
    hoisted.playBeepMock.mockReset();
    hoisted.dbSetMock.mockReset();
    hoisted.dbGetMock.mockResolvedValue([]);
    hoisted.fetchNeuralTtsMock.mockImplementation(
      async (_voice: string, text: string) => `https://example.com/${encodeURIComponent(text)}.wav`
    );

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: () => undefined }]
        }))
      }
    });

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: MockMediaRecorder
    });

    PreloadPipeline.cache.interview = {
      topic: 'Shared study booths in a library',
      questions: [
        {
          role: 'personal_anchor',
          text: 'How often do you use shared study booths in a library?',
          audioUrl: 'https://example.com/q1.wav'
        },
        {
          role: 'personal_choice',
          text: 'Would you rather reserve a booth or find one when you arrive?',
          audioUrl: null
        },
        {
          role: 'broad_opinion',
          text: 'Do you think shared booths make studying more effective for students?',
          audioUrl: null
        },
        {
          role: 'future_or_tradeoff',
          text: 'How could shared booths change the way libraries serve students in the future?',
          audioUrl: null
        }
      ]
    };
  });

  it('warms later question audio after Q1 starts and while the user is answering', async () => {
    const { container } = render(<InterviewModule onBack={() => undefined} />);

    await screen.findByText('准备好接受面试了吗？');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /生成考卷并入座/i }));
    });

    await screen.findByRole('button', { name: /点击开始面试/i });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /点击开始面试/i }));
    });

    await waitFor(() => {
      expect(hoisted.fetchNeuralTtsMock).toHaveBeenCalledWith(
        'Puck',
        'Would you rather reserve a booth or find one when you arrive?',
        null,
        expect.objectContaining({
          scopeId: 'interview-scope',
          supersedeKey: 'interview:question-tts:1',
          isBackground: true
        })
      );
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    await act(async () => {
      fireEvent.ended(audio as HTMLAudioElement);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(hoisted.fetchNeuralTtsMock).toHaveBeenCalledWith(
        'Puck',
        'Do you think shared booths make studying more effective for students?',
        null,
        expect.objectContaining({
          scopeId: 'interview-scope',
          supersedeKey: 'interview:question-tts:2',
          isBackground: true
        })
      );
      expect(hoisted.fetchNeuralTtsMock).toHaveBeenCalledWith(
        'Puck',
        'How could shared booths change the way libraries serve students in the future?',
        null,
        expect.objectContaining({
          scopeId: 'interview-scope',
          supersedeKey: 'interview:question-tts:3',
          isBackground: true
        })
      );
    });
  });
});
