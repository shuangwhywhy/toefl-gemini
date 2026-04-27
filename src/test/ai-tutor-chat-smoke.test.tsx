import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AITutorChat } from '../features/chat/AITutorChat';
import { requestChatCompletion } from '../services/llm/helpers';
import { DBUtils } from '../services/storage/db';

vi.mock('../services/llm/helpers', () => ({
  requestChatCompletion: vi.fn(),
  requestTranscription: vi.fn()
}));

vi.mock('../services/storage/db', () => ({
  DBUtils: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn()
  }
}));

vi.mock('../services/requestScope', () => ({
  useRequestScope: () => ({
    scopeId: 'test-scope',
    beginSession: () => 'token',
    isSessionCurrent: () => true
  })
}));

describe('AITutorChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(DBUtils.get).mockImplementation((key) => {
      if (key.startsWith('remember_')) return Promise.resolve(false);
      if (key.startsWith('chat_')) return Promise.resolve([]);
      return Promise.resolve(null);
    });
    window.scrollTo = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders initial advice', async () => {
    render(<AITutorChat chatId="test" initialAdvice="Hello student" contextText="test" />);
    expect(screen.getByText(/Hello student/i)).toBeDefined();
  });

  it('sends a message and receives reply', async () => {
    vi.mocked(requestChatCompletion).mockResolvedValue('I am your assistant');
    
    render(<AITutorChat chatId="test" initialAdvice="Hi" contextText="test" />);
    
    const input = screen.getByPlaceholderText(/随时向私教提问/i);
    fireEvent.change(input, { target: { value: 'How are you?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    
    expect(screen.getByText('How are you?')).toBeDefined();
    
    await waitFor(() => {
      expect(screen.getByText(/I am your assistant/i)).toBeDefined();
    });
  });

  it('handles image upload preview', async () => {
    render(<AITutorChat chatId="test" initialAdvice="Hi" contextText="test" />);
    
    const file = new File(['hello'], 'hello.png', { type: 'image/png' });
    const input = screen.getByTitle('上传截图').parentElement?.querySelector('input[type="file"]') as HTMLInputElement;
    
    // Mock FileReader
    const readAsDataURLSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function(this: FileReader) {
      if (this.onloadend) {
        this.onloadend({ target: { result: 'data:image/png;base64,mock' } } as any);
      }
    });

    fireEvent.change(input, { target: { files: [file] } });
    
    await waitFor(() => {
      expect(screen.getByAltText('preview')).toBeDefined();
    });
    
    readAsDataURLSpy.mockRestore();
  });

  it('toggles expansion', () => {
    render(<AITutorChat chatId="test" initialAdvice="Hi" contextText="test" />);
    const expandBtn = screen.getByTitle('全屏放大');
    fireEvent.click(expandBtn);
    expect(screen.getByText(/私教探讨已在全屏打开/i)).toBeDefined();
  });

  it('handles memory toggle and confirmation', async () => {
    vi.mocked(DBUtils.get).mockImplementation((key) => {
      if (key.startsWith('remember_')) return Promise.resolve(true); // Start with memory on
      if (key.startsWith('chat_')) return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(<AITutorChat chatId="test" initialAdvice="Hi" contextText="test" />);
    
    await waitFor(() => {
      expect(screen.getByText('记忆对话')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('记忆对话'));
    });
    expect(screen.getByText(/关闭对话记忆/i)).toBeDefined();
    
    await act(async () => {
      fireEvent.click(screen.getByText('确认清空'));
    });
    
    await waitFor(() => {
      expect(DBUtils.remove).toHaveBeenCalledWith('chat_test');
    });
  });

  it('toggles mic listening state', async () => {

    render(<AITutorChat chatId="test" initialAdvice="Hi" contextText="Context" />);


    
    const micBtn = await screen.findByTitle(/语音输入/i);
    await act(async () => {
      fireEvent.click(micBtn);
    });
    
    expect(micBtn).toBeInTheDocument();
  });
});
