import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Award,
  Check,
  CheckCircle2,
  FileText,
  Keyboard,
  Pause,
  PenTool,
  Play,
  RefreshCw,
  Sparkles,
  Volume2
} from 'lucide-react';
import { AITutorChat } from '../chat/AITutorChat';
import { buildRetryAwareMessage } from '../shared/trainingUtils';
import { queueListeningPreload } from '../shared/preloadTasks';
import {
  fetchConversationTTS,
  fetchGeminiText,
  fetchNeuralTTS,
  processDictationText
} from '../../services/llm/helpers';

interface DictationToken {
  type: 'shown' | 'gap';
  word: string;
  gapIdx?: number;
}

interface DictationSessionData {
  topic: string;
  text: string;
  tokens: DictationToken[];
  audioUrl: string;
}

interface ListeningSessionData {
  topic: string;
  transcript: string;
  truth: Record<string, string>;
  audioUrl: string;
}

interface ListeningEvaluationData {
  totalScore: number;
  overallFeedback: string;
  fieldEvaluations: Array<{
    fieldId: string;
    fieldName: string;
    feedback: string;
    score: number;
  }>;
}
import { classifyLLMFailure } from '../../services/llm/errors';
import { runBoundedGeneration } from '../../services/llm/retry';
import { PreloadPipeline } from '../../services/preload/orchestrator';
import { useRequestScope } from '../../services/requestScope';

export function ListeningDictationModule({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<string>('generating');
  const [apiError, setApiError] = useState('');
  const [data, setData] = useState<DictationSessionData | null>(null);
  const [userInputs, setUserInputs] = useState<string[]>([]);
  const [isEvaluated, setIsEvaluated] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const initialLoadAttemptedRef = useRef(false);
  const requestScope = useRequestScope('dictation');

  const initSession = (dictationData: unknown) => {
    setData(dictationData as DictationSessionData);
    const gaps = (dictationData as { tokens: Array<{ type: string }> }).tokens.filter(
      (token) => token.type === 'gap'
    );
    setUserInputs(new Array(gaps.length).fill(''));
    setIsEvaluated(false);
    setStatus('practicing');
  };

  const consumePreloadedDictation = () => {
    if (!PreloadPipeline.cache.dictation) {
      return false;
    }

    initSession(PreloadPipeline.cache.dictation);
    PreloadPipeline.cache.dictation = null;
    return true;
  };

  useEffect(() => {
    if (initialLoadAttemptedRef.current) {
      return;
    }
    initialLoadAttemptedRef.current = true;
    void generateDictation();
  }, []);

  const generateDictation = async () => {
    const session = requestScope.invalidateSession();
    setApiError('');
    if (consumePreloadedDictation()) {
      return;
    }

    PreloadPipeline.abortCurrent();
    setStatus('generating');
    try {
      const { value } = await runBoundedGeneration({
        classify: classifyLLMFailure,
        maxRetries: 2,
        delayMs: 1000,
        action: async () => {
          const prompt = `Generate an 80-100 word academic lecture passage on a random advanced topic (e.g. biology, history, astronomy). 
      Return JSON: {"topic": "...", "text": "..."}`;

          const schema = {
            type: 'OBJECT',
            properties: {
              topic: { type: 'STRING' },
              text: { type: 'STRING' }
            },
            required: ['topic', 'text']
          };

          const result = await fetchGeminiText<{ topic: string; text: string }>(prompt, 0.9, 2000, schema, null, null, {
            scopeId: requestScope.scopeId,
            supersedeKey: 'dictation:generate',
            origin: 'ui',
            sceneKey: 'dictation:generate'
          });
          const tokens = processDictationText(result.text);
          const audio = await fetchNeuralTTS('Charon', result.text, null, {
            scopeId: requestScope.scopeId,
            supersedeKey: 'dictation:generate-tts',
            origin: 'ui',
            sceneKey: 'dictation:tts'
          });
          return { ...result, tokens, audioUrl: audio };
        }
      });
      if (!requestScope.isSessionCurrent(session)) {
        return;
      }
      initSession(value);
    } catch (error) {
      if (!requestScope.isSessionCurrent(session)) {
        return;
      }
      setApiError(buildRetryAwareMessage('生成内容失败，请检查网络后重试。', error));
      setStatus('generation_failed');
    }
  };

  const handleInputChange = (value: string, gapIndex: number) => {
    const nextInputs = [...userInputs];
    nextInputs[gapIndex] = value;
    setUserInputs(nextInputs);
  };

  const focusNext = (currentGapIndex: number) => {
    if (currentGapIndex < userInputs.length - 1) {
      inputRefs.current[currentGapIndex + 1]?.focus();
    }
  };

  const focusPrev = (currentGapIndex: number) => {
    if (currentGapIndex > 0) {
      inputRefs.current[currentGapIndex - 1]?.focus();
    }
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    gapIndex: number
  ) => {
    const target = event.currentTarget;
    if (event.key === ' ' || event.key === 'Tab') {
      event.preventDefault();
      focusNext(gapIndex);
    } else if (
      event.key === 'ArrowRight' &&
      target.selectionStart === target.value.length
    ) {
      focusNext(gapIndex);
    } else if (event.key === 'ArrowLeft' && target.selectionStart === 0) {
      focusPrev(gapIndex);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && audioRef.current.duration) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
    }
  };

  const checkResults = () => {
    setIsEvaluated(true);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
  };

  const toggleAudio = () => {
    if (!audioRef.current) {
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      void audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  let gapCounter = 0;
  const tokensWithGapIdx = (data as DictationSessionData)?.tokens.map((token: DictationToken) => {
    if (token.type === 'gap') {
      const nextToken = { ...token, gapIdx: gapCounter };
      gapCounter += 1;
      return nextToken;
    }
    return token;
  });

  const getScore = () => {
    if (!data) {
      return 0;
    }

    const gaps = (data as DictationSessionData).tokens.filter((token) => token.type === 'gap');
    let correct = 0;
    gaps.forEach((_gap, index: number) => {
      if (userInputs[index].trim().toLowerCase() === _gap.word.toLowerCase()) {
        correct += 1;
      }
    });
    return Math.round((correct / gaps.length) * 100);
  };

  return (
    <div className="bg-slate-50 min-h-[calc(100vh-64px)] p-6 font-sans">
      {data && (
        <audio
          ref={audioRef}
          src={data.audioUrl}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          className="hidden"
        />
      )}

      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between pb-4 border-b">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={onBack}>
            <div className="bg-white p-2 rounded-lg shadow-sm text-slate-600">
              <ArrowLeft className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">
                文章听写 (Article Dictation)
              </h1>
              <p className="text-slate-500 text-xs">专注拼写准确度与听力连贯性</p>
            </div>
          </div>
          {status === 'practicing' && (
            <div className="flex items-center space-x-4">
              <div className="text-[10px] text-slate-400 flex items-center bg-white px-2 py-1 rounded-full border border-slate-100 shadow-sm">
                <Keyboard className="w-3 h-3 mr-1" /> 空格/Tab: 下一格 | 方向键:
                快速跳转
              </div>
              <button
                onClick={isEvaluated ? () => void generateDictation() : checkResults}
                className={`px-5 py-2 rounded-full font-bold text-sm shadow-sm transition-all ${
                  isEvaluated
                    ? 'bg-slate-800 text-white'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {isEvaluated ? '再练一篇' : '完成校验'}
              </button>
            </div>
          )}
        </header>

        {status === 'generating' && (
          <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
            <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin mx-auto mb-4" />
            <p className="text-slate-600 font-medium">考官正在为您准备学术短文...</p>
          </div>
        )}

        {status === 'generation_failed' && (
          <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
            <p className="text-slate-700 font-medium mb-6">
              {apiError || '学术短文暂时生成失败，请稍后重试。'}
            </p>
            <button
              onClick={() => void generateDictation()}
              className="px-8 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-full font-bold shadow-lg transition-transform hover:scale-105"
            >
              重新生成
            </button>
          </div>
        )}

        {status === 'practicing' && data && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3 space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border p-6 flex items-center space-x-5">
                <button
                  onClick={toggleAudio}
                  className="w-16 h-16 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shrink-0 transition-all shadow-lg hover:scale-105 active:scale-95"
                >
                  {isPlaying ? (
                    <Pause className="w-8 h-8 fill-white" />
                  ) : (
                    <Play className="w-8 h-8 fill-white ml-1" />
                  )}
                </button>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-bold text-slate-700 flex items-center">
                      <Volume2 className="w-4 h-4 mr-1 text-indigo-500" /> Dictation Audio
                    </span>
                    <span className="text-[10px] text-indigo-600 font-bold px-2 py-0.5 bg-indigo-50 rounded uppercase">
                      {data.topic}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden w-full relative">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 min-h-[400px]">
                <div className="leading-[3rem] text-justify">
                  {tokensWithGapIdx.map((token, index: number) => {
                    const isPunctuation = /^[^a-zA-Z0-9]+$/.test(token.word);
                    const spacing = isPunctuation ? '' : ' ml-2';

                    if (token.type === 'shown') {
                      return (
                        <span
                          key={index}
                          className={`text-lg font-medium text-slate-800 ${spacing}`}
                        >
                          {token.word}
                        </span>
                      );
                    }

                    const isCorrect =
                      userInputs[token.gapIdx].trim().toLowerCase() ===
                      token.word.toLowerCase();

                    return (
                      <span key={index} className={`relative inline-block ${spacing}`}>
                        <input
                          ref={(element) => {
                            inputRefs.current[token.gapIdx] = element;
                          }}
                          type="text"
                          value={userInputs[token.gapIdx]}
                          onChange={(event) =>
                            handleInputChange(event.target.value, token.gapIdx)
                          }
                          onKeyDown={(event) => handleKeyDown(event, token.gapIdx)}
                          disabled={isEvaluated}
                          style={{
                            width: `${Math.max(3, token.word.length * 1.15)}ch`
                          }}
                          className={`h-8 px-1 text-center text-base font-bold border-b-2 bg-transparent outline-none transition-all ${
                            isEvaluated
                              ? isCorrect
                                ? 'border-emerald-500 text-emerald-600'
                                : 'border-rose-500 text-rose-600 bg-rose-50/50'
                              : 'border-indigo-200 hover:border-indigo-400 focus:border-indigo-600 focus:bg-indigo-50/30'
                          }`}
                        />
                        {isEvaluated && !isCorrect && (
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-center animate-in slide-in-from-bottom-1 z-10 pointer-events-none">
                            <span className="text-xs font-black bg-emerald-500 text-white px-2 py-0.5 rounded shadow-sm whitespace-nowrap">
                              {token.word}
                            </span>
                          </div>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="lg:col-span-1 space-y-6">
              {isEvaluated ? (
                <div className="bg-white rounded-2xl shadow-sm border p-6 text-center animate-in zoom-in-95">
                  <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Award className="w-10 h-10" />
                  </div>
                  <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">
                    完成得分
                  </h3>
                  <div className="text-4xl font-black text-slate-800 mb-4">
                    {getScore()}
                    <span className="text-lg">/100</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    学术词汇对于托福听写至关重要。拼写错误不仅影响听力，更会直接影响写作分数。
                  </p>
                </div>
              ) : (
                <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-6">
                  <h3 className="text-indigo-900 font-bold text-sm mb-4 flex items-center">
                    <Sparkles className="w-4 h-4 mr-1" /> 训练要点
                  </h3>
                  <ul className="text-xs text-indigo-700 space-y-3">
                    <li className="flex items-start">
                      <Check className="w-3 h-3 mr-2 mt-0.5 shrink-0" /> 优先完整拼出核心动词。
                    </li>
                    <li className="flex items-start">
                      <Check className="w-3 h-3 mr-2 mt-0.5 shrink-0" /> 注意名词单复数结尾 -s。
                    </li>
                    <li className="flex items-start">
                      <Check className="w-3 h-3 mr-2 mt-0.5 shrink-0" /> 利用空格键快速进入下一词。
                    </li>
                  </ul>
                </div>
              )}

              <div className="bg-white rounded-2xl shadow-sm border h-[400px] overflow-hidden relative">
                <AITutorChat
                  chatId="dictation_chat"
                  key={data.text}
                  title="词汇与拼写助教"
                  initialAdvice={
                    isEvaluated
                      ? `这篇听力中有一些容易拼错的单词，比如：${data.tokens
                          .filter((token: { word: string; type: string }) => token.word.length > 7 && token.type === 'gap')
                          .slice(0, 2)
                          .map((token: { word: string }) => token.word)
                          .join(', ')}。你对哪个单词的发音或拼写规则有疑问？`
                      : '正在等待您开始听写。您可以随时向我提问关于听力细节的问题。'
                  }
                  contextText={`Dictation Topic: ${data.topic}. Text: ${data.text}. User Score: ${getScore()}`}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ListeningPracticeModule({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<string>('generating');
  const [conversationData, setConversationData] = useState<ListeningSessionData | null>(null);
  const [notes, setNotes] = useState({
    who: '',
    problem: '',
    reason: '',
    solution: '',
    nextStep: ''
  });
  const [evaluation, setEvaluation] = useState<ListeningEvaluationData | null>(null);
  const [apiError, setApiError] = useState('');

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initialLoadAttemptedRef = useRef(false);
  const requestScope = useRequestScope('listening-practice');

  const initConversation = (nextConversationData: unknown) => {
    setConversationData(nextConversationData as ListeningSessionData);
    setNotes({ who: '', problem: '', reason: '', solution: '', nextStep: '' });
    setEvaluation(null);
    setStatus('ready');
  };

  const consumePreloadedConversation = () => {
    if (!PreloadPipeline.cache.listening) {
      return false;
    }

    initConversation(PreloadPipeline.cache.listening);
    PreloadPipeline.cache.listening = null;
    return true;
  };

  useEffect(() => {
    if (initialLoadAttemptedRef.current) {
      return;
    }
    initialLoadAttemptedRef.current = true;
    void generateConversation();
  }, []);

  const generateConversation = async ({
    queueNextAfterSuccess = false
  }: { queueNextAfterSuccess?: boolean } = {}) => {
    const session = requestScope.invalidateSession();
    setApiError('');
    if (consumePreloadedConversation()) {
      if (queueNextAfterSuccess) {
        queueListeningPreload();
      }
      return;
    }

    PreloadPipeline.abortCurrent();
    setStatus('generating');
    try {
      const { value } = await runBoundedGeneration({
        classify: classifyLLMFailure,
        maxRetries: 2,
        delayMs: 1000,
        action: async () => {
          const prompt = `Generate a 180-250 word TOEFL campus conversation. Format exactly with 'Student:' and 'Professor:'.
      Topic: A random specific campus issue.
      Return JSON: {"topic": "...", "transcript": "...", "truth": {"who": "...", "problem": "...", "reason": "...", "solution": "...", "nextStep": "..."}}`;

          const schema = {
            type: 'OBJECT',
            properties: {
              topic: { type: 'STRING' },
              transcript: { type: 'STRING' },
              truth: {
                type: 'OBJECT',
                properties: {
                  who: { type: 'STRING' },
                  problem: { type: 'STRING' },
                  reason: { type: 'STRING' },
                  solution: { type: 'STRING' },
                  nextStep: { type: 'STRING' }
                },
                required: ['who', 'problem', 'reason', 'solution', 'nextStep']
              }
            },
            required: ['topic', 'transcript', 'truth']
          };

          const data = await fetchGeminiText<{ topic: string; transcript: string; truth: Record<string, string> }>(prompt, 0.9, 2000, schema, null, null, {
            scopeId: requestScope.scopeId,
            supersedeKey: 'listening:generate',
            origin: 'ui',
            sceneKey: 'listening:generate'
          });
          if (!data || !data.transcript) {
            throw new Error('Invalid output format from LLM');
          }

          const audioUrl = await fetchConversationTTS(data.transcript, null, {
            scopeId: requestScope.scopeId,
            supersedeKey: 'listening:generate-tts',
            origin: 'ui',
            sceneKey: 'listening:tts'
          });
          if (!audioUrl) {
            throw new Error('Audio generation format failed');
          }

          return { ...data, audioUrl };
        }
      });

      if (!requestScope.isSessionCurrent(session)) {
        return;
      }
      initConversation(value);
      if (queueNextAfterSuccess) {
        queueListeningPreload();
      }
    } catch (error) {
      if (!requestScope.isSessionCurrent(session)) {
        return;
      }
      setApiError(buildRetryAwareMessage('生成进阶听力材料失败，请重试。', error));
      setStatus('generation_failed');
    }
  };

  const evaluateNotes = async () => {
    if (
      !notes.who &&
      !notes.problem &&
      !notes.reason &&
      !notes.solution &&
      !notes.nextStep
    ) {
      setApiError('笔记为空，请先在下方输入您的盲听记录后再提交哦。');
      return;
    }

    const session = requestScope.invalidateSession();
    setStatus('evaluating');
    setApiError('');
    try {
      const prompt = `Evaluate the user's notes against the ground truth for this conversation in Chinese.
      Topic: ${conversationData.topic}
      Truth: ${JSON.stringify(conversationData.truth)}
      User Notes: ${JSON.stringify(notes)}
      Return JSON: {"totalScore": 0-100, "overallFeedback": "...", "fieldEvaluations": [{"fieldId": "...", "fieldName": "...", "feedback": "...", "score": 0-20}]}`;

      const schema = {
        type: 'OBJECT',
        properties: {
          totalScore: { type: 'INTEGER' },
          overallFeedback: { type: 'STRING' },
          fieldEvaluations: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                fieldId: { type: 'STRING' },
                fieldName: { type: 'STRING' },
                feedback: { type: 'STRING' },
                score: { type: 'INTEGER' }
              }
            }
          }
        },
        required: ['totalScore', 'overallFeedback', 'fieldEvaluations']
      };

      const validator = (data: unknown) => {
        const d = data as Record<string, unknown>;
        if (
          !d ||
          typeof d.totalScore !== 'number' ||
          !Array.isArray(d.fieldEvaluations)
        ) {
          throw new Error('Invalid evaluation format from AI');
        }
      };

      const evaluationData = await fetchGeminiText<ListeningEvaluationData>(prompt, 0.4, 2000, schema, null, validator, {
        scopeId: requestScope.scopeId,
        supersedeKey: 'listening:evaluate',
        origin: 'ui',
        sceneKey: 'listening:evaluate'
      });
      if (!requestScope.isSessionCurrent(session)) {
        return;
      }
      setEvaluation(evaluationData);
      setStatus('result');
    } catch (error) {
      if (!requestScope.isSessionCurrent(session)) {
        return;
      }
      setApiError(buildRetryAwareMessage('评分分析失败，请重试。', error));
      setStatus('practicing');
    }
  };

  const toggleAudio = () => {
    if (!audioRef.current) {
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      void audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && audioRef.current.duration) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
    }
  };

  return (
    <div className="bg-slate-100 min-h-[calc(100vh-64px)] p-4 md:p-6 font-sans pb-20">
      <audio
        ref={audioRef}
        src={conversationData?.audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center space-y-3 md:space-y-0 pb-4 border-b border-slate-300">
          <div
            className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition"
            onClick={onBack}
          >
            <div className="bg-white p-2 rounded-lg shadow-sm text-slate-600">
              <ArrowLeft className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">
                听写快记 (Conversation)
              </h1>
              <p className="text-slate-500 text-xs">黄金五段逻辑剥离法</p>
            </div>
          </div>
        </header>

        {apiError && (
          <div className="bg-amber-50 text-amber-700 p-3 rounded-lg border border-amber-200 flex items-center text-sm animate-in fade-in slide-in-from-top-2 mx-auto">
            <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
            {apiError}
          </div>
        )}

        {status === 'generating' && (
          <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
            <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin mx-auto mb-4" />
            <p className="text-slate-600 font-medium">
              考官正在为您准备进阶对话音频...
            </p>
          </div>
        )}

        {status === 'generation_failed' && (
          <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
            <p className="text-slate-700 font-medium mb-6">
              进阶对话材料暂时生成失败，请稍后重试。
            </p>
            <button
              onClick={() => void generateConversation()}
              className="px-8 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-full font-bold shadow-lg transition-transform hover:scale-105"
            >
              重新生成
            </button>
          </div>
        )}

        {status === 'ready' && (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
            <div className="inline-block bg-emerald-100 text-emerald-800 px-4 py-1.5 rounded-full font-bold text-sm mb-6 uppercase tracking-widest">
              Topic: {conversationData?.topic}
            </div>
            <h3 className="text-xl text-slate-700 mb-8">
              录音已就绪。请准备好做笔记，随时可以开始。
            </h3>
            <button
              onClick={() => {
                setStatus('practicing');
                toggleAudio();
              }}
              className="px-8 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-full font-bold shadow-lg flex items-center mx-auto transition-transform hover:scale-105"
            >
              <Play className="w-5 h-5 mr-2 fill-white" /> 开始盲听与快记
            </button>
          </div>
        )}

        {status === 'evaluating' && (
          <div className="bg-white rounded-2xl shadow-sm p-16 text-center flex flex-col items-center">
            <div className="w-16 h-16 relative mb-6">
              <div className="absolute inset-0 border-4 border-emerald-200 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-emerald-600 rounded-full border-t-transparent animate-spin"></div>
            </div>
            <h2 className="text-xl font-bold text-slate-700">正在对比逻辑与批改笔记...</h2>
            <p className="text-slate-400 text-xs mt-3">
              深度批改需要阅读大量上下文，请耐心等待 (可能需要20-40秒)
            </p>
          </div>
        )}

        {(status === 'practicing' || status === 'result') && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center space-x-4">
                <button
                  onClick={toggleAudio}
                  className="w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full flex items-center justify-center shrink-0 transition-colors shadow-md"
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6 fill-white" />
                  ) : (
                    <Play className="w-6 h-6 fill-white ml-1" />
                  )}
                </button>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-bold text-slate-700">
                      Conversation Audio
                    </span>
                    <span className="text-xs text-emerald-600 font-bold px-2 py-0.5 bg-emerald-50 rounded">
                      Advanced Level
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden w-full relative">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-800 p-4 text-white flex justify-between items-center">
                  <h2 className="text-sm font-bold uppercase tracking-wider flex items-center">
                    <PenTool className="w-4 h-4 mr-2" /> 逻辑快记区 (Your Notes)
                  </h2>
                  {status === 'result' && (
                    <span className="bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-bold">
                      Score: {evaluation?.totalScore}/100
                    </span>
                  )}
                </div>

                <div className="p-6 space-y-5 bg-slate-50">
                  {[
                    {
                      id: 'who',
                      label: '1. 谁 (Who)',
                      placeholder: '对话的双方是谁？是什么关系或身份？',
                      icon: '👤'
                    },
                    {
                      id: 'problem',
                      label: '2. 问题 (Problem)',
                      placeholder: '学生遇到了什么核心困难或诉求？',
                      icon: '❓'
                    },
                    {
                      id: 'reason',
                      label: '3. 原因 (Reason)',
                      placeholder: '导致这个问题的具体原因/背景是什么？',
                      icon: '🔍'
                    },
                    {
                      id: 'solution',
                      label: '4. 解决办法 (Solution)',
                      placeholder: '教授/职员提出了哪些建议或解决方案？',
                      icon: '💡'
                    },
                    {
                      id: 'nextStep',
                      label: '5. 下一步 (Next Step)',
                      placeholder: '学生接下来立刻要去做什么？',
                      icon: '➡️'
                    }
                  ].map((field) => {
                    const evaluationData = evaluation?.fieldEvaluations?.find(
                      (item: { fieldId: string }) => item.fieldId === field.id
                    );
                    return (
                      <div
                        key={field.id}
                        className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm group focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-400 transition-all"
                      >
                        <div className="bg-slate-100/50 px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-700 flex items-center">
                            {field.icon} {field.label}
                          </label>
                          {status === 'result' && evaluationData && (
                            <span
                              className={`text-xs font-bold ${
                                evaluationData.score >= 15
                                  ? 'text-emerald-600'
                                  : evaluationData.score >= 10
                                    ? 'text-amber-500'
                                    : 'text-rose-500'
                              }`}
                            >
                              {evaluationData.score}/20
                            </span>
                          )}
                        </div>
                        <div className="p-3">
                          <textarea
                            value={notes[field.id as keyof typeof notes]}
                            onChange={(event) =>
                              setNotes({
                                ...notes,
                                [field.id]: event.target.value
                              })
                            }
                            disabled={status === 'result'}
                            placeholder={field.placeholder}
                            className="w-full h-16 text-sm bg-transparent resize-none outline-none text-slate-800 placeholder-slate-300 disabled:opacity-70"
                          />
                        </div>
                        {status === 'result' && evaluationData && (
                          <div className="border-t border-slate-100 bg-slate-50 p-4 text-sm space-y-3">
                            <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100">
                              <p className="text-xs font-bold text-emerald-800 mb-1 flex items-center">
                                <CheckCircle2 className="w-3 h-3 mr-1" /> 核心原文
                                (Ground Truth)
                              </p>
                              <p className="text-slate-700 leading-relaxed">
                                {conversationData.truth[field.id]}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-bold text-indigo-800 mb-1 flex items-center">
                                <Sparkles className="w-3 h-3 mr-1" /> AI 批改反馈
                              </p>
                              <p className="text-slate-600 leading-relaxed">
                                {evaluationData.feedback}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {status === 'practicing' && (
                    <button
                      onClick={() => void evaluateNotes()}
                      className="w-full py-4 mt-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-lg transition-colors flex items-center justify-center"
                    >
                      <Check className="w-5 h-5 mr-2" /> 提交笔记并分析
                    </button>
                  )}
                  {status === 'result' && (
                    <button
                      onClick={() =>
                        void generateConversation({ queueNextAfterSuccess: true })
                      }
                      className="w-full py-4 mt-4 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold shadow-lg transition-colors"
                    >
                      进入下一篇 (Next Conversation)
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-1 space-y-6">
              {status === 'result' && evaluation && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-emerald-900 uppercase flex items-center mb-2">
                    <Award className="w-4 h-4 mr-2" /> 听音策略点评
                  </h3>
                  <p className="text-slate-700 text-sm leading-relaxed">
                    {evaluation.overallFeedback}
                  </p>
                </div>
              )}

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-[400px]">
                <div className="p-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h2 className="text-xs font-bold text-slate-700 flex items-center">
                    <FileText className="w-3 h-3 mr-1" /> 原文 (Transcript)
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                  {status === 'result' ? (
                    conversationData.transcript
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 opacity-50 blur-[4px] select-none text-center">
                      提交笔记后即可
                      <br />
                      解锁并查看对话原文
                    </div>
                  )}
                </div>
              </div>

              {status === 'result' && (
                <div className="h-[300px] rounded-xl border border-indigo-100 bg-indigo-50/50 overflow-hidden shadow-sm relative">
                  <AITutorChat
                    chatId="listen_chat"
                    key={conversationData.topic}
                    title="与听力助教探讨"
                    initialAdvice={`🎉 练习结束！您的快记准确度得分为 ${evaluation.totalScore}分。\n\n关于这篇对话中没听懂的长难句、连读，或者记笔记的策略，您可以随时问我！`}
                    contextText={`Topic: ${conversationData.topic}. Transcript: ${conversationData.transcript}. User Score: ${evaluation.totalScore}/100. AI Feedback: ${evaluation.overallFeedback}`}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
