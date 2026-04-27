import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Image as ImageIcon,
  Maximize2,
  Mic,
  Minimize2,
  Send,
  ToggleLeft,
  ToggleRight,
  X
} from 'lucide-react';
import {
  requestChatCompletion,
  requestTranscription
} from '../../services/llm/helpers';
import { useRequestScope } from '../../services/requestScope';
import { DBUtils } from '../../services/storage/db';

export function AITutorChat({
  chatId,
  initialAdvice,
  contextText,
  title = '私教陪练',
  audioParts = [],
  isPrimary = false,
  extraHeaderElements = null
}) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [rememberHistory, setRememberHistory] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [visibleCount, setVisibleCount] = useState(15);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const isUserScrollingRef = useRef(false);
  const chatScope = useRequestScope(`chat:${chatId || 'default'}`);

  const AI_AVATAR_URL =
    'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=150&q=80';

  useEffect(() => {
    if (!chatId) {
      return;
    }

    const loadDB = async () => {
      const isMemOn = await DBUtils.get(`remember_${chatId}`, false);
      setRememberHistory(isMemOn);
      if (isMemOn) {
        const history = await DBUtils.get(`chat_${chatId}`, []);
        setMessages(history);
      }
    };

    void loadDB();
  }, [chatId]);

  useEffect(() => {
    if (!initialAdvice) {
      return;
    }

    setMessages((previous) => {
      if (previous.length > 0 && previous[previous.length - 1].text === initialAdvice) {
        return previous;
      }

      const nextMessage = { id: Date.now(), role: 'model', text: initialAdvice };
      const next = [...previous, nextMessage];
      if (rememberHistory) {
        void DBUtils.set(`chat_${chatId}`, next);
      }
      return next;
    });
  }, [initialAdvice, rememberHistory, chatId]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    isUserScrollingRef.current = scrollHeight - scrollTop - clientHeight > 50;

    if (scrollTop === 0 && visibleCount < messages.length) {
      setVisibleCount((previous) => previous + 15);
    }
  };

  const scrollToBottom = () => {
    if (!isUserScrollingRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleToggleMemory = async () => {
    if (rememberHistory) {
      setShowConfirmModal(true);
      return;
    }

    setRememberHistory(true);
    await DBUtils.set(`remember_${chatId}`, true);
    await DBUtils.set(`chat_${chatId}`, messages);
  };

  const confirmClearMemory = async () => {
    setRememberHistory(false);
    await DBUtils.set(`remember_${chatId}`, false);
    await DBUtils.remove(`chat_${chatId}`);

    const keptMessages = initialAdvice
      ? [{ id: Date.now(), role: 'model', text: initialAdvice }]
      : [];
    setMessages(keptMessages);
    setShowConfirmModal(false);
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const toggleListen = async () => {
    if (isListening) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => setIsListening(false);
      recorder.onstop = async () => {
        setIsListening(false);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm'
        });
        audioChunksRef.current = [];
        if (audioBlob.size === 0) {
          return;
        }

        try {
          const transcript = await requestTranscription({
            audioBlob,
            prompt: 'Transcribe this user speech in Chinese. Return only the spoken text.',
            scopeId: chatScope.scopeId,
            supersedeKey: 'voice-input'
          });
          if (transcript) {
            setInputText((previous) => `${previous}${transcript}`);
          }
        } catch {
          setMessages((previous) => [
            ...previous,
            { id: Date.now(), role: 'model', text: '语音转文字失败，请稍后再试。' }
          ]);
        }
      };

      recorder.start();
      setIsListening(true);
    } catch {
      setMessages((previous) => [
        ...previous,
        { id: Date.now(), role: 'model', text: '抱歉，无法访问麦克风进行语音输入。' }
      ]);
    }
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => setSelectedImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleSend = async () => {
    if (!inputText.trim() && !selectedImage) {
      return;
    }

    const sendSession = chatScope.beginSession();
    const newUserMessage = {
      id: Date.now(),
      role: 'user',
      text: inputText,
      image: selectedImage
    };
    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    if (rememberHistory) {
      void DBUtils.set(`chat_${chatId}`, updatedMessages);
    }

    setInputText('');
    setSelectedImage(null);
    setIsTyping(true);
    isUserScrollingRef.current = false;

    try {
      const chatHistory = updatedMessages.map((message, index) => {
        const parts: Array<Record<string, unknown>> = [];
        if (message.text) {
          parts.push({ text: message.text });
        }

        if (message.image) {
          const base64Data = message.image.split(',')[1];
          const mimeType = message.image.split(';')[0].split(':')[1];
          parts.push({ inlineData: { mimeType, data: base64Data } });
        }

        if (index === updatedMessages.length - 1 && audioParts.length > 0) {
          audioParts.forEach((audioPart) => {
            parts.push({
              inlineData: {
                mimeType: audioPart.mimeType,
                data: audioPart.data
              }
            });
          });
        }

        return {
          role: message.role === 'model' ? 'model' : 'user',
          parts
        };
      });

      const systemInstruction = {
        parts: [
          {
            text: `你是一位专业的 TOEFL 英语口语/听力私教陪练。
请用中文回复。结合学生当前所有的数据维度进行高度个性化的点评和指导。
【核心指令】如果用户提问涉及到发音或语调，请解析附带的用户原始录音音频进行作答。
当前学生正在练习的上下文数据: "${contextText}"`
          }
        ]
      };

      const replyText = await requestChatCompletion({
        systemInstruction,
        contents: chatHistory,
        temperature: 0.7,
        maxOutputTokens: 1500,
        scopeId: chatScope.scopeId,
        supersedeKey: 'chat-reply'
      });

      if (!chatScope.isSessionCurrent(sendSession)) {
        return;
      }

      const newModelMessage = {
        id: Date.now(),
        role: 'model',
        text: replyText
      };
      const finalMessages = [...updatedMessages, newModelMessage];
      setMessages(finalMessages);
      if (rememberHistory) {
        void DBUtils.set(`chat_${chatId}`, finalMessages);
      }
    } catch {
      setMessages((previous) => [
        ...previous,
        { id: Date.now(), role: 'model', text: '网络异常，无法获取回复。' }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const parseMarkdown = (text: string, isUser: boolean) => {
    if (!text) {
      return { __html: '' };
    }

    let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(
      /^### (.*$)/gim,
      `<h3 class="font-bold text-base mt-3 mb-1 ${isUser ? 'text-white' : 'text-indigo-900'}">$1</h3>`
    );
    html = html.replace(
      /^## (.*$)/gim,
      `<h2 class="font-bold text-lg mt-4 mb-2 pb-1 border ${isUser ? 'border-white/30 text-white' : 'border-indigo-100 text-indigo-900'}">$1</h2>`
    );
    html = html.replace(
      /^# (.*$)/gim,
      `<h1 class="font-black text-xl mt-4 mb-2 pb-1 border ${isUser ? 'border-white/30 text-white' : 'border-indigo-100 text-indigo-900'}">$1</h1>`
    );
    html = html.replace(
      /\*\*(.*?)\*\*/g,
      `<strong class="font-black ${isUser ? 'text-white' : 'text-indigo-800 bg-indigo-50 px-1 rounded shadow-sm'}">$1</strong>`
    );
    html = html.replace(
      /\*(.*?)\*/g,
      `<em class="italic font-medium ${isUser ? 'text-white/90' : 'text-indigo-700'}">$1</em>`
    );
    html = html.replace(
      /`(.*?)`/g,
      `<code class="px-1.5 py-0.5 rounded font-mono text-[0.9em] shadow-sm border ${isUser ? 'bg-white/20 border-white/30 text-white' : 'bg-slate-50 border-slate-200 text-indigo-600'}">$1</code>`
    );
    html = html.replace(/^- (.*$)/gim, `<li class="ml-5 list-disc marker:text-indigo-400 mb-1">$1</li>`);
    html = html.replace(/\n/g, '<br/>');
    return { __html: html };
  };

  const displayMessages = messages.slice(Math.max(0, messages.length - visibleCount));

  const chatContent = (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="px-4 py-3 border-b border-indigo-100 bg-white flex justify-between items-center shrink-0 shadow-sm z-10">
        <h2 className={`${isPrimary ? 'text-base' : 'text-sm'} font-black text-indigo-900 flex items-center`}>
          <Bot className="w-4 h-4 mr-1.5 text-indigo-500" /> {title}
        </h2>

        <div className="flex items-center space-x-4">
          {extraHeaderElements}

          <div className="flex items-center space-x-1.5 cursor-pointer group" onClick={handleToggleMemory}>
            <span
              className={`text-xs font-bold transition-colors ${
                rememberHistory
                  ? 'text-indigo-600'
                  : 'text-slate-400 group-hover:text-slate-600'
              }`}
            >
              记忆对话
            </span>
            {rememberHistory ? (
              <ToggleRight className="w-5 h-5 text-indigo-600" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-slate-400" />
            )}
          </div>
          <div className="w-px h-4 bg-slate-200"></div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-slate-400 hover:text-indigo-600 transition-colors"
            title={isExpanded ? '缩小' : '全屏放大'}
          >
            {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={scrollContainerRef} onScroll={handleScroll}>
        {messages.length > visibleCount && (
          <div className="text-center text-xs text-slate-400 py-2">上滑加载更多...</div>
        )}

        {displayMessages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {message.role === 'model' && (
              <img
                src={AI_AVATAR_URL}
                alt="Tutor"
                className="w-8 h-8 rounded-full object-cover mr-3 shrink-0 shadow-sm border border-indigo-100"
              />
            )}
            <div
              className={`max-w-[85%] rounded-2xl p-4 ${
                isPrimary ? 'text-[15px]' : 'text-sm'
              } leading-[1.6] shadow-sm ${
                message.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-white border border-indigo-50 text-slate-700 rounded-tl-sm'
              }`}
            >
              {message.image && (
                <img
                  src={message.image}
                  alt="upload"
                  className="w-full max-h-40 object-cover rounded-lg mb-3 shadow-sm border border-slate-100"
                />
              )}
              <div
                dangerouslySetInnerHTML={parseMarkdown(
                  message.text,
                  message.role === 'user'
                )}
                className="break-words space-y-1.5"
              />
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <img
              src={AI_AVATAR_URL}
              alt="Tutor"
              className="w-8 h-8 rounded-full object-cover mr-3 shrink-0 shadow-sm border border-indigo-100"
            />
            <div className="bg-white border border-indigo-50 text-slate-500 rounded-2xl rounded-tl-sm p-4 flex items-center space-x-1.5 shadow-sm h-12">
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
              <div
                className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                style={{ animationDelay: '0.2s' }}
              ></div>
              <div
                className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                style={{ animationDelay: '0.4s' }}
              ></div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-slate-200 bg-white shrink-0">
        {selectedImage && (
          <div className="relative inline-block mb-3 ml-2">
            <img
              src={selectedImage}
              alt="preview"
              className="h-14 w-14 object-cover rounded-lg border border-slate-200 shadow-sm"
            />
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-1 shadow-md hover:scale-110 transition-transform"
            >
              <X size={12} />
            </button>
          </div>
        )}

        <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all shadow-sm">
          <input
            type="text"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void handleSend()}
            placeholder="随时向私教提问 (支持图文与语音)..."
            className={`flex-1 bg-transparent ${
              isPrimary ? 'text-base' : 'text-sm'
            } outline-none min-w-0 text-slate-700 placeholder-slate-400 font-medium`}
          />

          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            className="hidden"
            onChange={handleImageChange}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-slate-400 hover:text-indigo-600 transition-colors p-1.5 rounded-full hover:bg-slate-100"
            title="上传截图"
          >
            <ImageIcon size={18} />
          </button>

          <button
            onClick={() => void toggleListen()}
            className={`${
              isListening
                ? 'text-rose-500 animate-pulse bg-rose-50'
                : 'text-slate-400 hover:text-indigo-600 hover:bg-slate-100'
            } transition-colors p-1.5 rounded-full`}
            title="语音输入"
          >
            <Mic size={18} />
          </button>

          <div className="w-px h-5 bg-slate-200 mx-1"></div>

          <button
            onClick={() => void handleSend()}
            disabled={!inputText.trim() && !selectedImage}
            className="text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed p-2 rounded-full shadow-sm transition-transform active:scale-95"
          >
            <Send size={16} className="-ml-0.5" />
          </button>
        </div>
      </div>

      {showConfirmModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full text-center animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">关闭对话记忆？</h3>
            <p className="text-sm text-slate-500 leading-relaxed mb-6">
              关闭记忆功能将会立刻
              <strong className="text-rose-500">永久清空</strong>
              当前模块的所有历史提问和评价记录，且无法恢复。是否继续？
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-2.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => void confirmClearMemory()}
                className="flex-1 py-2.5 rounded-xl font-bold text-white bg-rose-500 hover:bg-rose-600 shadow-md shadow-rose-200 transition-colors"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isExpanded) {
    return (
      <>
        <div className="h-full w-full bg-slate-100/50 flex flex-col items-center justify-center text-slate-400 text-xs">
          <Maximize2 size={24} className="mb-2 opacity-50" />
          私教探讨已在全屏打开
        </div>
        <div className="fixed inset-0 sm:inset-6 z-[100] bg-white sm:rounded-2xl shadow-2xl border border-blue-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
          {chatContent}
        </div>
      </>
    );
  }

  return <div className="h-full w-full bg-transparent">{chatContent}</div>;
}
