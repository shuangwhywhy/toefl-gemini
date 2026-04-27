import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import { ShadowingModule } from '../features/shadowing/ShadowingModule';
import { fetchGeminiText, fetchNeuralTTS } from '../services/llm/helpers';

vi.mock('../services/llm/helpers', () => ({
  fetchGeminiText: vi.fn(),
  fetchNeuralTTS: vi.fn(),
  requestTranscription: vi.fn().mockResolvedValue('Hello world')
}));

vi.mock('../services/audio/playback', () => ({
  playBeep: vi.fn().mockResolvedValue(undefined)
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
    abortCurrent: vi.fn(),
    enqueue: vi.fn()
  }
}));


describe('ShadowingModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();
  });

  it('generates text and allows recording', async () => {

    vi.mocked(fetchGeminiText).mockImplementation(async (parts) => {
      const prompt = JSON.stringify(parts);
      if (prompt.includes('sentence')) {
        return { sentence: 'The quick brown fox jumps over the lazy dog.' };
      }
      return { 
        errors: [], 
        advice: 'Good job', 
        fluencyScore: 90, 
        intonationScore: 85, 
        suggestedFocus: 'none' 
      };
    });
    vi.mocked(fetchNeuralTTS).mockResolvedValue('mock-audio');

    await act(async () => {
      render(<ShadowingModule onBack={vi.fn()} />);
    });


    
    // Loading from DB then generating if empty
    await waitFor(() => {
      expect(fetchGeminiText).toHaveBeenCalled();
    });
    
    // Show text first (it's hidden by default in ShadowingModule)
    const showBtn = await screen.findByText(/点击显示文本内容|hidden/i);
    fireEvent.click(showBtn);
    
    expect(await screen.findByText(/quick brown fox/i)).toBeInTheDocument();


    // Mock MediaRecorder
    const mockStream = { getTracks: () => [{ stop: vi.fn() }] };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream)
      }
    });

    let recorderState = 'inactive';
    const mockRecorder = {
      start: vi.fn().mockImplementation(() => { recorderState = 'recording'; }),
      stop: vi.fn().mockImplementation(() => { recorderState = 'inactive'; }),
      ondataavailable: null,
      onstop: null,
      get state() { return recorderState; }
    };

    vi.stubGlobal('MediaRecorder', vi.fn(() => mockRecorder));

    // Find mic button
    const micBtn = await screen.findByTitle(/开始您的跟读/i);
    expect(micBtn).toBeInTheDocument();
    
    await act(async () => {
      fireEvent.click(micBtn);
    });
    
    // Wait for it to start
    await waitFor(() => {
      expect(mockRecorder.start).toHaveBeenCalled();
      expect(screen.getByTitle(/结束录音并提交评分/i)).toBeInTheDocument();
    });


    
    // Stop recording
    const stopBtn = await screen.findByTitle(/结束录音并提交评分/i);
    await act(async () => {
      fireEvent.click(stopBtn);
    });
    
    await waitFor(() => {
      expect(mockRecorder.stop).toHaveBeenCalled();
    });
    
    // Trigger data available
    if (mockRecorder.ondataavailable) {
      mockRecorder.ondataavailable({ data: new Blob(['audio-data'], { type: 'audio/webm' }) } as unknown as BlobEvent);
    }
    
    // Trigger onstop
    if (mockRecorder.onstop) {
      await act(async () => {
        mockRecorder.onstop();
      });
    }

    await screen.findByText(/评测结果/i, {}, { timeout: 15000 });
    expect(screen.getAllByText(/quick/i).length).toBeGreaterThan(1);
  }, 40000);


  it('handles generation error', async () => {
    vi.mocked(fetchGeminiText).mockRejectedValue(new Error('Fail'));
    render(<ShadowingModule onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/生成句子失败/i)).toBeDefined();
    });
  });
});


