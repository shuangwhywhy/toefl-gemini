import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import { ShadowingModule } from '../features/shadowing/ShadowingModule';
import { fetchGeminiText, fetchNeuralTTS } from '../services/llm/helpers';
import { DBUtils } from '../services/storage/db';

vi.mock('../services/llm/helpers', () => ({
  fetchGeminiText: vi.fn(),
  fetchNeuralTTS: vi.fn(),
  requestTranscription: vi.fn().mockResolvedValue('Hello world')
}));

vi.mock('../services/storage/db', () => ({
  DBUtils: {
    get: vi.fn().mockImplementation((key, def) => Promise.resolve(def)),
    set: vi.fn()
  }
}));

vi.mock('../services/requestScope', () => ({
  useRequestScope: () => ({
    scopeId: 'test-scope',
    beginSession: () => 'token',
    isSessionCurrent: () => true
  })
}));

vi.mock('../services/preload/orchestrator', () => ({
  PreloadPipeline: {
    cache: { shadow: null },
    abortCurrent: vi.fn()
  }
}));

describe('ShadowingModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();
  });

  it('generates text and allows recording', async () => {
    vi.mocked(fetchGeminiText).mockResolvedValue({ sentence: 'The quick brown fox jumps over the lazy dog.' });
    vi.mocked(fetchNeuralTTS).mockResolvedValue('mock-audio');

    render(<ShadowingModule onBack={vi.fn()} />);
    
    // Loading from DB then generating if empty
    await waitFor(() => {
      expect(screen.getByText(/The quick brown fox/i)).toBeDefined();
    });

    // Mock MediaRecorder
    const mockStream = { getTracks: () => [{ stop: vi.fn() }] };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream)
      }
    });

    const mockRecorder = {
      start: vi.fn(),
      stop: vi.fn(),
      ondataavailable: null,
      onstop: null,
      state: 'inactive'
    };
    vi.stubGlobal('MediaRecorder', vi.fn(() => mockRecorder));

    // Find mic button
    const micBtn = await screen.findByTitle(/开始您的跟读/i);
    fireEvent.click(micBtn);
    expect(mockRecorder.start).toHaveBeenCalled();
    
    // Stop recording
    const stopBtn = await screen.findByTitle(/结束录音并提交评分/i);
    fireEvent.click(stopBtn);
    expect(mockRecorder.stop).toHaveBeenCalled();
    
    // Trigger onstop
    if (mockRecorder.onstop) {
      await act(async () => {
        mockRecorder.onstop();
      });
    }

    await waitFor(() => {
      expect(screen.getByText(/Hello world/i)).toBeDefined(); // Transcription result
    });
  });

  it('handles generation error', async () => {
    vi.mocked(fetchGeminiText).mockRejectedValue(new Error('Fail'));
    render(<ShadowingModule onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/生成句子失败/i)).toBeDefined();
    });
  });
});


