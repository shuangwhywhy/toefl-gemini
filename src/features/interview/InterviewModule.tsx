import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Award,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Mic,
  RefreshCw,
  Square,
  Trash2,
  UserCheck,
  Volume2,
  Zap
} from 'lucide-react';
import { AITutorChat } from '../chat/AITutorChat';
import {
  generateInterviewSession,
  type InterviewSessionData
} from './interviewGeneration';
import { buildRetryAwareMessage } from '../shared/trainingUtils';
import { playBeep } from '../../services/audio/playback';
import {
  fetchGeminiText,
  fetchNeuralTTS,
  requestTranscription
} from '../../services/llm/helpers';
import { PreloadPipeline } from '../../services/preload/orchestrator';
import { useRequestScope } from '../../services/requestScope';
import { DBUtils } from '../../services/storage/db';

export function InterviewModule({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<string>('setup');
  const [interviewData, setInterviewData] = useState<InterviewSessionData | null>(null);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [showTextState, setShowTextState] = useState([false, false, false, false]);
  const [userAnswers, setUserAnswers] = useState<any[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [currentTranscript, setCurrentTranscript] = useState('');

  const [finalEvaluation, setFinalEvaluation] = useState<any>(null);
  const [interviewHistory, setInterviewHistory] = useState<any[]>([]);
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
  const [apiError, setApiError] = useState('');

  const [audioContextParts, setAudioContextParts] = useState<any[]>([]);
  const requestScope = useRequestScope('interview');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const timerRef = useRef(0);
  const interviewDataRef = useRef<InterviewSessionData | null>(null);
  const interviewFlowTokenRef = useRef(0);
  const audioWarmupTasksRef = useRef(new Map<number, Promise<string | null>>());

  const interviewerVoice = 'Puck';

  const playSimpleSpeech = (text: string, onEndCallback?: () => void) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.onend = onEndCallback ?? null;
    synth.speak(utterance);
  };

  useEffect(() => {
    void (async () => {
      setInterviewHistory(await DBUtils.get('interview_history', []));
      setIsDbLoaded(true);
    })();

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    interviewDataRef.current = interviewData;
  }, [interviewData]);

  const beginInterviewFlowSession = () => {
    interviewFlowTokenRef.current += 1;
    audioWarmupTasksRef.current.clear();
    return interviewFlowTokenRef.current;
  };

  const isInterviewFlowCurrent = (token: number) =>
    interviewFlowTokenRef.current === token;

  const updateQuestionAudioUrl = (index: number, url: string) => {
    setInterviewData((previous) => {
      if (!previous) {
        return previous;
      }

      if (previous.questions[index]?.audioUrl === url) {
        return previous;
      }

      const nextQuestions = [...previous.questions];
      nextQuestions[index] = { ...nextQuestions[index], audioUrl: url };
      return { ...previous, questions: nextQuestions };
    });
  };

  const ensureQuestionAudio = async (
    index: number,
    flowToken: number,
    isBackground = false
  ) => {
    const activeInterview = interviewDataRef.current;
    if (!activeInterview || !activeInterview.questions[index] || !isInterviewFlowCurrent(flowToken)) {
      return null;
    }

    const existingUrl = activeInterview.questions[index].audioUrl;
    if (existingUrl) {
      return existingUrl;
    }

    const existingTask = audioWarmupTasksRef.current.get(index);
    if (existingTask) {
      return await existingTask;
    }

    const task = (async () => {
      const latestInterview = interviewDataRef.current;
      if (!latestInterview || !latestInterview.questions[index]) {
        return null;
      }

      const nextUrl = await fetchNeuralTTS(
        interviewerVoice,
        latestInterview.questions[index].text,
        null,
        {
          scopeId: requestScope.scopeId,
          supersedeKey: `interview:question-tts:${index}`,
          origin: isBackground ? 'preload' : 'ui',
          sceneKey: 'interview:question-tts',
          isBackground
        }
      );

      if (nextUrl && isInterviewFlowCurrent(flowToken)) {
        updateQuestionAudioUrl(index, nextUrl);
      }

      return nextUrl;
    })();

    audioWarmupTasksRef.current.set(index, task);
    try {
      return await task;
    } finally {
      if (audioWarmupTasksRef.current.get(index) === task) {
        audioWarmupTasksRef.current.delete(index);
      }
    }
  };

  const warmUpcomingQuestionAudio = async (startIndex: number, flowToken: number) => {
    const activeInterview = interviewDataRef.current;
    if (!activeInterview) {
      return;
    }

    for (let index = startIndex; index < activeInterview.questions.length; index += 1) {
      if (!isInterviewFlowCurrent(flowToken)) {
        return;
      }

      await ensureQuestionAudio(index, flowToken, true);
    }
  };

  const initInterviewSession = (nextInterviewData: InterviewSessionData) => {
    beginInterviewFlowSession();
    interviewDataRef.current = nextInterviewData;
    setInterviewData(nextInterviewData);
    setUserAnswers([]);
    setCurrentQIndex(0);
    setShowTextState([false, false, false, false]);
    setFinalEvaluation(null);
    setAudioContextParts([]);
    setCurrentTranscript('');
    setTimer(0);
    timerRef.current = 0;
    setStatus('ready');
  };

  const generateInterview = async () => {
    const session = requestScope.invalidateSession();
    PreloadPipeline.abortCurrent();
    setApiError('');

    if (PreloadPipeline.cache.interview) {
      initInterviewSession(PreloadPipeline.cache.interview);
      PreloadPipeline.cache.interview = null;
      return;
    }

    setStatus('generating');
    try {
      const value = await generateInterviewSession({
        voice: interviewerVoice,
        scopeId: requestScope.scopeId,
        supersedeKey: 'interview:generate',
        firstTtsSupersedeKey: 'interview:first-tts',
        mode: 'manual'
      });

      if (!requestScope.isSessionCurrent(session)) {
        return;
      }

      initInterviewSession(value);
    } catch (error) {
      if (!requestScope.isSessionCurrent(session)) {
        return;
      }
      setApiError(
        buildRetryAwareMessage(
          '生成考卷失败，可能是网络原因或频率受限，请稍后重试。',
          error
        )
      );
      setStatus('setup');
    }
  };

  const startInterview = () => {
    setStatus('interviewing');
    void playQuestionAudio(0, interviewFlowTokenRef.current);
  };

  const playQuestionAudio = async (index: number, flowToken: number) => {
    const activeInterview = interviewDataRef.current;
    if (!activeInterview || !activeInterview.questions[index]) {
      return;
    }

    const url = await ensureQuestionAudio(index, flowToken, false);
    if (!isInterviewFlowCurrent(flowToken)) {
      return;
    }

    if (audioRef.current && url) {
      audioRef.current.src = url;
      try {
        await audioRef.current.play();
      } catch (error) {
        console.warn('Audio element blocked, fallback to SpeechSynthesis');
        playSimpleSpeech(activeInterview.questions[index].text, handleInterviewerAudioEnded);
      }
    } else {
      playSimpleSpeech(activeInterview.questions[index].text, handleInterviewerAudioEnded);
    }

    void warmUpcomingQuestionAudio(index + 1, flowToken);
  };

  const handleInterviewerAudioEnded = async () => {
    if (status !== 'interviewing') {
      return;
    }

    const answerSession = requestScope.beginSession();
    setTimer(0);
    timerRef.current = 0;
    setCurrentTranscript('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await playBeep(800, 0.1);
      void warmUpcomingQuestionAudio(currentQIndex + 1, interviewFlowTokenRef.current);

      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      mediaRecorderRef.current.onstop = async () => {
        const finalBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const finalUrl = URL.createObjectURL(finalBlob);
        stream.getTracks().forEach((track) => track.stop());
        let transcript = '(No response)';

        try {
          const transcribed = await requestTranscription({
            audioBlob: finalBlob,
            prompt: 'Transcribe this English TOEFL speaking answer into plain English text.',
            scopeId: requestScope.scopeId,
            supersedeKey: `interview:transcribe:${currentQIndex}`
          });
          if (transcribed) {
            transcript = transcribed;
          }
        } catch (error) {
          console.warn('Interview transcription failed:', error);
        }

        if (!requestScope.isSessionCurrent(answerSession)) {
          return;
        }

        setCurrentTranscript(transcript);

        setUserAnswers((previous) => [
          ...previous,
          {
            qIndex: currentQIndex,
            text: transcript,
            timeTaken: timerRef.current,
            audioUrl: finalUrl,
            audioBlob: finalBlob
          }
        ]);
        if (currentQIndex < 3) {
          const nextIndex = currentQIndex + 1;
          setCurrentQIndex(nextIndex);
          window.setTimeout(() => {
            void playQuestionAudio(nextIndex, interviewFlowTokenRef.current);
          }, 1000);
        } else {
          void evaluateEntireInterview();
        }
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      timerIntervalRef.current = window.setInterval(() => {
        setTimer((previous) => {
          const next = previous + 1;
          timerRef.current = next;
          return next;
        });
      }, 1000);
    } catch (error) {
      setApiError('无法访问麦克风。请确保授予权限。');
    }
  };

  const stopAnswering = async () => {
    if (!isRecording) {
      return;
    }

    await playBeep(400, 0.15);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    window.speechSynthesis.cancel();
    setIsRecording(false);
  };

  const evaluateEntireInterview = async () => {
    setStatus('evaluating');
  };

  useEffect(() => {
    if (status === 'evaluating' && userAnswers.length === 4) {
      void runAIEvaluation();
    }
  }, [status, userAnswers]);

  const runAIEvaluation = async () => {
    const session = requestScope.invalidateSession();
    const totalTime = userAnswers.reduce((sum, current) => sum + current.timeTaken, 0);
    const totalWords = userAnswers.reduce((sum, current) => {
      const words = current.text.match(/\b\w+\b/g);
      return sum + (words ? words.length : 0);
    }, 0);

    const wordsPerSecond = totalTime > 0 ? totalWords / totalTime : 0;
    const wordsPer45s = Math.round(wordsPerSecond * 45);

    const safeDuration = 38;
    let targetWords = Math.floor(wordsPerSecond * safeDuration);
    targetWords = Math.max(45, Math.min(120, targetWords));

    let qaLog = '';
    const parts: Array<Record<string, unknown>> = [];
    const audioPartsForChat: Array<Record<string, string>> = [];

    for (let index = 0; index < 4; index += 1) {
      qaLog += `Q${index + 1}: ${interviewData.questions[index].text}\nSTT Transcript A${
        index + 1
      } (For Semantic Reference ONLY): ${userAnswers[index].text}\nTime taken for A${
        index + 1
      }: ${userAnswers[index].timeTaken}s\n\n`;
      if (userAnswers[index].audioBlob) {
        const base64Audio = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result ?? '').split(',')[1]);
          reader.readAsDataURL(userAnswers[index].audioBlob);
        });
        const mimeType = userAnswers[index].audioBlob.type || 'audio/webm';
        parts.push({ inlineData: { mimeType, data: base64Audio } });
        audioPartsForChat.push({ mimeType, data: base64Audio });
      }
    }

    setAudioContextParts(audioPartsForChat);

    const promptText = `Evaluate this TOEFL speaking response based on the AUDIO provided. Ignore STT text errors. Provide feedback in Chinese.
    Topic: ${interviewData.topic}
    Log: ${qaLog}
    User's natural speed is ${wordsPer45s} words/45s. Target safe length is ${targetWords} words.
    Return JSON: {"score": 0-30, "timeAnalysis": "...", "speedAnalysis": "...", "overallFeedback": "...", "detailedAnalysis": [{"question": "...", "feedback": "...", "tailoredResponse": [{"strategy": "...", "text": "..."}]}]}`;

    parts.unshift({ text: promptText });

    const schema = {
      type: 'OBJECT',
      properties: {
        score: { type: 'INTEGER' },
        timeAnalysis: { type: 'STRING' },
        overallFeedback: { type: 'STRING' },
        speedAnalysis: { type: 'STRING' },
        detailedAnalysis: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              question: { type: 'STRING' },
              feedback: { type: 'STRING' },
              tailoredResponse: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    strategy: { type: 'STRING' },
                    text: { type: 'STRING' }
                  },
                  required: ['strategy', 'text']
                }
              }
            },
            required: ['question', 'feedback', 'tailoredResponse']
          }
        }
      },
      required: [
        'score',
        'timeAnalysis',
        'speedAnalysis',
        'overallFeedback',
        'detailedAnalysis'
      ]
    };

    try {
      const data = await fetchGeminiText(parts, 0.4, 4000, schema, null, null, {
        scopeId: requestScope.scopeId,
        supersedeKey: 'interview:evaluate',
        origin: 'ui',
        sceneKey: 'interview:evaluate'
      });
      if (!requestScope.isSessionCurrent(session)) {
        return;
      }

      const finalData = { ...data, wordsPer45s, targetWords };
      setFinalEvaluation(finalData);

      const newHistoryItem = {
        id: Date.now(),
        type: 'interview',
        topic: interviewData.topic,
        score: finalData.score,
        totalTime,
        date: new Date().toLocaleString()
      };
      const updatedHistory = [newHistoryItem, ...interviewHistory];
      void DBUtils.set('interview_history', updatedHistory);
      setInterviewHistory(updatedHistory);
      setStatus('result');
    } catch (error) {
      if (!requestScope.isSessionCurrent(session)) {
        return;
      }
      setApiError(
        buildRetryAwareMessage(
          '打分生成失败，可能是网络问题或 AI 返回格式异常。请重试。',
          error
        )
      );
      setStatus('evaluation_failed');
    }
  };

  const getTimerColor = (seconds: number) => {
    if (seconds <= 30) {
      return 'text-emerald-500 border-emerald-200 bg-emerald-50';
    }
    if (seconds <= 45) {
      return 'text-amber-500 border-amber-200 bg-amber-50';
    }
    return 'text-rose-500 border-rose-200 bg-rose-50';
  };

  const getBadgeColor = (seconds: number) => {
    if (seconds <= 30) {
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    }
    if (seconds <= 45) {
      return 'bg-amber-100 text-amber-700 border-amber-200';
    }
    return 'bg-rose-100 text-rose-700 border-rose-200';
  };

  const toggleShowText = (index: number) => {
    const next = [...showTextState];
    next[index] = !next[index];
    setShowTextState(next);
  };

  const handleHistoryScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 10) {
      if (visibleHistoryCount < interviewHistory.length) {
        setVisibleHistoryCount((previous) => previous + 10);
      }
    }
  };

  const deleteHistoryItem = (
    id: number,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    const nextHistory = interviewHistory.filter((item) => item.id !== id);
    setInterviewHistory(nextHistory);
    void DBUtils.set('interview_history', nextHistory);
  };

  const renderHistory = () => {
    if (!isDbLoaded || interviewHistory.length === 0) {
      return null;
    }

    return (
      <div className="bg-white rounded-2xl shadow-sm p-6 border border-slate-200 mt-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
          <Clock className="w-5 h-5 mr-2 text-blue-500" /> 过往面试记录
        </h2>
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto p-1"
          onScroll={handleHistoryScroll}
        >
          {interviewHistory.slice(0, visibleHistoryCount).map((item) => (
            <div
              key={item.id}
              className="relative p-4 border border-slate-100 bg-slate-50 rounded-xl hover:border-blue-200 transition-colors text-left group"
            >
              <button
                onClick={(event) => deleteHistoryItem(item.id, event)}
                className="absolute top-3 right-3 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all p-1 bg-white rounded-full shadow-sm"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <div className="flex justify-between items-start mb-2 pr-6">
                <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded uppercase">
                  {item.type}
                </span>
                <span className="text-xs text-slate-400">{item.date}</span>
              </div>
              <h3 className="font-bold text-slate-700 mb-3 truncate" title={item.topic}>
                {item.topic}
              </h3>
              <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-200">
                <span className="text-slate-500 flex items-center">
                  <Clock className="w-3 h-3 mr-1" /> {item.totalTime}s
                </span>
                <span
                  className={`font-black flex items-center ${
                    item.score >= 25
                      ? 'text-green-500'
                      : item.score >= 20
                        ? 'text-blue-500'
                        : 'text-amber-500'
                  }`}
                >
                  <Award className="w-4 h-4 mr-1" /> Score: {item.score}/30
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-slate-100 min-h-[calc(100vh-64px)] p-4 md:p-6 font-sans pb-20">
      <audio ref={audioRef} onEnded={handleInterviewerAudioEnded} className="hidden" />
      <div className="max-w-4xl mx-auto space-y-6">
        <header
          className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition pb-4 border-b border-slate-300"
          onClick={onBack}
        >
          <div className="bg-white p-2 rounded-lg shadow-sm text-slate-600">
            <ArrowLeft className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">模拟面试 (Mock Interview)</h1>
            <p className="text-slate-500 text-xs">全真模拟，压迫感训练</p>
          </div>
        </header>

        {apiError && (
          <div className="bg-amber-50 text-amber-700 p-3 rounded-lg border border-amber-200 flex items-center text-sm animate-in fade-in slide-in-from-top-2 mb-4 mx-auto">
            <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
            {apiError}
          </div>
        )}

        {status === 'setup' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-10 text-center flex flex-col items-center">
              <div className="w-24 h-24 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-6">
                <UserCheck className="w-12 h-12" />
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-4">准备好接受面试了吗？</h2>
              <p className="text-slate-500 mb-8 max-w-lg">
                系统将随机生成一个符合新版托福 interview 范围的具体话题，并由 AI 考官对您进行 4
                轮连珠炮式的语音提问。请保证每一题的回答时长控制在合理范围（总目标
                ~180秒）。
              </p>

              <button
                onClick={() => void generateInterview()}
                disabled={String(status) === 'generating'}
                className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold shadow-lg shadow-blue-200 transition-all transform hover:scale-105 flex items-center disabled:opacity-50 disabled:scale-100"
              >
                {String(status) === 'generating' ? (
                  <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                ) : null}
                {String(status) === 'generating' ? '考卷生成中...' : '生成考卷并入座'}{' '}
                <ChevronRight className="w-5 h-5 ml-2" />
              </button>
            </div>
            {renderHistory()}
          </div>
        )}

        {status === 'generating' && (
          <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
            <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-slate-600 font-medium">考官正在为您准备专属试卷和音频...</p>
          </div>
        )}

        {status === 'ready' && interviewData && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <div className="inline-block bg-blue-100 text-blue-800 px-4 py-1.5 rounded-full font-bold text-sm mb-6 uppercase tracking-widest">
              Topic: {interviewData.topic}
            </div>
            <h3 className="text-xl text-slate-700 mb-8">考官已就绪，请授权麦克风后开始面试。</h3>
            <button
              onClick={startInterview}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-bold shadow-lg shadow-emerald-200 flex items-center mx-auto"
            >
              <Mic className="w-5 h-5 mr-2" /> 点击开始面试 (Start)
            </button>
          </div>
        )}

        {(status === 'interviewing' ||
          status === 'evaluating' ||
          status === 'evaluation_failed' ||
          status === 'result') &&
          interviewData && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[700px]">
              {status !== 'result' && (
                <div className="bg-slate-800 p-4 text-white flex justify-between items-center shrink-0">
                  <div>
                    <span className="text-slate-400 text-xs uppercase tracking-wider block mb-0.5">
                      Current Topic
                    </span>
                    <strong className="text-sm md:text-base">{interviewData.topic}</strong>
                  </div>
                  <div className="bg-slate-700 px-3 py-1 rounded-full text-xs font-mono">
                    Q: {Math.min(currentQIndex + 1, 4)} / 4
                  </div>
                </div>
              )}

              {status === 'interviewing' && (
                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 bg-slate-50">
                  {interviewData.questions.map((question: any, index: number) => {
                    if (index > currentQIndex) {
                      return null;
                    }

                    const isCurrentAsking = index === currentQIndex && !isRecording;
                    const isCurrentAnswering = index === currentQIndex && isRecording;
                    const answer = userAnswers.find((item) => item.qIndex === index);

                    return (
                      <div key={index} className="space-y-6">
                        <div className="flex items-start max-w-[85%]">
                          <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 mr-3">
                            <Bot className="w-6 h-6" />
                          </div>
                          <div className="bg-white p-4 rounded-2xl rounded-tl-sm shadow-sm border border-slate-200">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-bold text-slate-400">
                                Interviewer
                              </span>
                              <button
                                onClick={() => toggleShowText(index)}
                                className="text-slate-400 hover:text-blue-600"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            </div>
                            {showTextState[index] ? (
                              <p className="text-slate-800 text-sm md:text-base leading-relaxed">
                                {question.text}
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-1 blur-[6px] select-none opacity-60">
                                {question.text.split(' ').map((word: string, wordIndex: number) => (
                                  <span
                                    key={wordIndex}
                                    className="bg-slate-300 text-transparent rounded px-1"
                                  >
                                    {word}
                                  </span>
                                ))}
                              </div>
                            )}
                            {isCurrentAsking && (
                              <div className="mt-3 flex items-center text-xs text-blue-500 font-bold animate-pulse">
                                <Volume2 className="w-4 h-4 mr-1" /> 正在提问中...
                              </div>
                            )}
                          </div>
                        </div>

                        {isCurrentAnswering && (
                          <div className="flex items-start flex-row-reverse max-w-[90%] ml-auto">
                            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 ml-3">
                              <Mic className="w-6 h-6" />
                            </div>
                            <div className="flex flex-col items-end">
                              <div
                                className={`mb-2 px-6 py-2 rounded-full border-2 font-mono text-2xl font-bold tracking-wider shadow-sm transition-colors ${getTimerColor(timer)}`}
                              >
                                {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
                              </div>
                              <div className="bg-emerald-600 text-white p-4 rounded-2xl rounded-tr-sm shadow-md">
                                <div className="text-xs font-bold text-emerald-200 mb-1 flex items-center">
                                  <Mic className="w-3 h-3 mr-1" /> 你正在回答
                                </div>
                                <p className="text-sm italic opacity-90">
                                  {currentTranscript || 'Listening...'}
                                </p>
                              </div>
                              <button
                                onClick={() => void stopAnswering()}
                                className="mt-3 px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-full text-sm font-bold shadow transition flex items-center"
                              >
                                结束回答 <Square className="w-3 h-3 ml-2 fill-current" />
                              </button>
                            </div>
                          </div>
                        )}

                        {answer && (
                          <div className="flex items-start flex-row-reverse max-w-[85%] ml-auto">
                            <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0 ml-3">
                              <CheckCircle2 className="w-6 h-6" />
                            </div>
                            <div className="bg-slate-800 text-white p-4 rounded-2xl rounded-tr-sm shadow-md relative group">
                              <p className="text-sm md:text-base leading-relaxed">{answer.text}</p>
                              <div
                                className={`absolute -bottom-3 -left-3 px-3 py-1 rounded-full text-[10px] font-bold border shadow-sm ${getBadgeColor(answer.timeTaken)}`}
                              >
                                ⏱️ {answer.timeTaken}s
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {status === 'evaluating' && (
                <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 relative">
                  <div className="w-20 h-20 relative mb-6">
                    <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
                    <FileText className="absolute inset-0 m-auto text-blue-500 w-8 h-8" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-700">正在生成深度分析报告</h2>
                  <p className="text-slate-500 text-sm mt-2">
                    AI 考官正在分析您的语速并拆解策略逻辑...
                  </p>
                </div>
              )}

              {status === 'evaluation_failed' && (
                <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 relative p-8 text-center">
                  <AlertTriangle className="w-12 h-12 text-amber-500 mb-5" />
                  <h2 className="text-xl font-bold text-slate-700">深度分析暂时失败</h2>
                  <p className="text-slate-500 text-sm mt-2 mb-6">
                    您无需重新录音，可以直接重试分析。
                  </p>
                  <button
                    onClick={() => setStatus('evaluating')}
                    className="px-8 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-full font-bold shadow-lg transition-transform hover:scale-105"
                  >
                    重试分析
                  </button>
                </div>
              )}

              {status === 'result' && finalEvaluation && (
                <div className="flex-1 overflow-y-auto p-6 bg-white text-center">
                  <div className="mb-10 mt-6">
                    <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-xl mb-4">
                      <span className="text-4xl font-black">{finalEvaluation.score}</span>
                      <span className="text-lg mt-2">/30</span>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800">
                      Mock Interview Result
                    </h2>
                    <div className="text-slate-500 text-sm mt-2">
                      Topic: {interviewData.topic}
                    </div>
                  </div>

                  <div className="space-y-6 text-left">
                    <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-100 rounded-xl p-5 shadow-sm">
                      <h3 className="text-sm font-bold text-violet-900 uppercase flex items-center mb-3">
                        <Activity className="w-4 h-4 mr-2" /> 个人语速画像 (Speech
                        Profile)
                      </h3>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <div className="text-3xl font-black text-violet-700 font-mono tracking-tighter">
                            {finalEvaluation.targetWords}{' '}
                            <span className="text-sm font-medium text-violet-500 tracking-normal">
                              words / 题
                            </span>
                          </div>
                          <p className="text-xs text-violet-600 mt-1 opacity-80">
                            基于您的真实语速 ({finalEvaluation.wordsPer45s}词/45s)
                            <br />
                            已为您扣除 7 秒的思考与停顿安全时长
                          </p>
                        </div>
                        <div className="md:text-right md:w-1/2">
                          <div className="text-sm text-violet-800 font-bold mb-1">策略指导</div>
                          <p className="text-xs text-violet-600 leading-relaxed">
                            {finalEvaluation.speedAnalysis}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                      <h3 className="text-sm font-bold text-amber-800 uppercase flex items-center mb-2">
                        <Clock className="w-4 h-4 mr-2" /> 时间把控分析
                      </h3>
                      <p className="text-slate-700 text-sm leading-relaxed">
                        {finalEvaluation.timeAnalysis}
                      </p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                      <h3 className="text-sm font-bold text-blue-800 uppercase flex items-center mb-2">
                        <Award className="w-4 h-4 mr-2" /> 综合评价
                      </h3>
                      <p className="text-slate-700 text-sm leading-relaxed">
                        {finalEvaluation.overallFeedback}
                      </p>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 border-b pb-2">
                        逐题深度解析
                      </h3>
                      <div className="space-y-8">
                        {finalEvaluation.detailedAnalysis.map((item: any, index: number) => (
                          <div
                            key={index}
                            className="bg-slate-50 border border-slate-200 p-5 rounded-xl"
                          >
                            <p className="font-bold text-slate-800 text-sm mb-3 pb-3 border-b border-slate-200">
                              Q{index + 1}: {item.question}
                            </p>
                            <p className="text-slate-600 text-sm leading-relaxed mb-4">
                              {item.feedback}
                            </p>

                            {item.tailoredResponse && item.tailoredResponse.length > 0 && (
                              <div className="mt-6 bg-white border border-indigo-100 rounded-lg p-5 shadow-sm">
                                <div className="flex items-center justify-between mb-4 pb-3 border-b border-indigo-50">
                                  <h4 className="text-xs font-bold text-indigo-800 flex items-center">
                                    <Zap className="w-4 h-4 mr-1 text-amber-400 fill-amber-400" />{' '}
                                    专属 38s 安全容量实战拆解
                                  </h4>
                                  <span className="text-[10px] bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded-full font-mono font-bold border border-indigo-100">
                                    🎯 目标词数: ~{finalEvaluation.targetWords}
                                  </span>
                                </div>
                                <div className="space-y-3">
                                  {item.tailoredResponse.map((block: any, blockIndex: number) => (
                                    <div
                                      key={blockIndex}
                                      className="flex flex-col sm:flex-row gap-3 items-start group"
                                    >
                                      <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold px-2.5 py-1 rounded shadow-sm shrink-0 mt-0.5 whitespace-nowrap group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                        {block.strategy}
                                      </span>
                                      <p className="text-slate-700 text-sm leading-relaxed flex-1">
                                        {block.text}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setStatus('setup')}
                    className="mt-8 w-full py-4 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold shadow-lg transition-colors"
                  >
                    完成并返回 (Finish)
                  </button>

                  <div className="mt-8 pt-6 border-t border-slate-200 text-left">
                    <div className="h-[400px] rounded-xl border border-blue-100 bg-blue-50/50 overflow-hidden shadow-sm relative">
                      <AITutorChat
                        chatId="interview_chat"
                        key={interviewData.topic}
                        title="与考官探讨"
                        audioParts={audioContextParts}
                        initialAdvice={`🎉 面试完成！本次得分：${finalEvaluation.score} / 30。\n\n我刚才认真听了你的录音。关于流利度、停顿或者你的发音细节，有什么需要我帮你具体指出的吗？`}
                        contextText={`Interview Topic: ${interviewData.topic}. Score: ${finalEvaluation.score}/30. User Safe Target Words per question: ${finalEvaluation.targetWords}. \nAI Evaluation Details: ${JSON.stringify(finalEvaluation.detailedAnalysis)}`}
                      />
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t border-slate-200 text-left">
                    {renderHistory()}
                  </div>
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
