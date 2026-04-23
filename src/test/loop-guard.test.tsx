import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  fetchGeminiTextMock: vi.fn(),
  fetchNeuralTTSMock: vi.fn(),
  fetchConversationTTSMock: vi.fn(),
  sessionCounter: 0
}));

vi.mock('../services/llm/helpers', () => {
  return {
    fetchGeminiText: hoisted.fetchGeminiTextMock,
    fetchNeuralTTS: hoisted.fetchNeuralTTSMock,
    fetchConversationTTS: hoisted.fetchConversationTTSMock,
    processDictationText: vi.fn(() => []),
    requestChatCompletion: vi.fn(),
    requestTranscription: vi.fn()
  };
});

vi.mock('../services/requestScope', () => {
  return {
    useRequestScope: () => ({
      scopeId: 'test-scope',
      beginSession: () => ++hoisted.sessionCounter,
      invalidateSession: () => ++hoisted.sessionCounter,
      isSessionCurrent: () => true
    })
  };
});

import {
  ListeningDictationModule,
  ListeningPracticeModule
} from '../app/ToeflTrainerApp';
import { PreloadPipeline } from '../services/preload/orchestrator';

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

describe('Loop guards for auto-generated modules', () => {
  beforeEach(() => {
    hoisted.sessionCounter = 0;
    hoisted.fetchGeminiTextMock.mockReset();
    hoisted.fetchNeuralTTSMock.mockReset();
    hoisted.fetchConversationTTSMock.mockReset();
    resetPipeline();
  });

  it('stops dictation auto generation after a terminal failure', async () => {
    hoisted.fetchGeminiTextMock.mockRejectedValue({ status: 404, message: 'not found' });

    render(<ListeningDictationModule onBack={() => undefined} />);

    await screen.findByRole('button', { name: '重新生成' });
    await waitFor(() => {
      expect(hoisted.fetchGeminiTextMock).toHaveBeenCalledTimes(1);
    });
  });

  it('stops listening auto generation after a terminal failure', async () => {
    hoisted.fetchGeminiTextMock.mockRejectedValue({ status: 404, message: 'not found' });

    render(<ListeningPracticeModule onBack={() => undefined} />);

    await screen.findByRole('button', { name: '重新生成' });
    await waitFor(() => {
      expect(hoisted.fetchGeminiTextMock).toHaveBeenCalledTimes(1);
    });
  });
});
