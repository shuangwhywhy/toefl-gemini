import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Eye,
  EyeOff,
  Headphones,
  History,
  Mic,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Square,
  Trash2
} from 'lucide-react';
import { AITutorChat } from '../chat/AITutorChat';
import {
  getDifficultyDescription,
  getLengthDescription
} from '../shared/trainingUtils';
import {
  DEFAULT_SHADOW_VOICE,
  queueShadowPreload
} from '../shared/preloadTasks';
import { playBeep } from '../../services/audio/playback';
import {
  fetchGeminiText,
  fetchNeuralTTS,
  requestTranscription
} from '../../services/llm/helpers';
import { PreloadPipeline } from '../../services/preload/orchestrator';
import { useRequestScope } from '../../services/requestScope';
import { DBUtils } from '../../services/storage/db';

const EMPTY_TEXT = "Click 'Generate Next' to create your first practice sentence.";

export function ShadowingModule({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState(EMPTY_TEXT);
  const [lengthLevel, setLengthLevel] = useState(3);
  const [difficultyLevel, setDifficultyLevel] = useState(5);
  const [learningFocus, setLearningFocus] = useState('general daily English');
  const [isGenerating, setIsGenerating] = useState(false);
  const [apiError, setApiError] = useState('');

  const [aiAdvice, setAiAdvice] = useState(
    '你好！我是你的专属口语私教。开始录音练习后，我将聆听你的真实发音并进行多维度诊断。你可以随时在这里向我提问！'
  );

  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_SHADOW_VOICE);
  const [rate, setRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  const [ttsAudioUrl, setTtsAudioUrl] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [highlightStart, setHighlightStart] = useState(0);
  const [highlightLength, setHighlightLength] = useState(0);
  const [showText, setShowText] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [evaluationResult, setEvaluationResult] = useState<any>(null);
  const [mediaError, setMediaError] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);

  const [listenCount, setListenCount] = useState(0);
  const [readCount, setReadCount] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const currentSentenceParams = useRef({
    lengthLevel,
    difficultyLevel,
    learningFocus
  });
  const [currentAttempts, setCurrentAttempts] = useState<any[]>([]);
  const requestScope = useRequestScope('shadowing');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCacheRef = useRef<Record<string, string>>({});

  const hasRecordedThisSentenceRef = useRef(false);
  const [currentAudioPart, setCurrentAudioPart] = useState<any>(null);
  const manualGenControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void (async () => {
      setText(await DBUtils.get('shadow_text', EMPTY_TEXT));

      let initialLength = await DBUtils.get('shadow_lengthLevel', 3);
      if (initialLength > 10) {
        initialLength = Math.max(1, Math.min(10, Math.ceil(initialLength / 5)));
      }
      setLengthLevel(initialLength);

      setDifficultyLevel(await DBUtils.get('shadow_difficultyLevel', 5));
      setLearningFocus(await DBUtils.get('shadow_learningFocus', 'general daily English'));
      setListenCount(await DBUtils.get('shadow_listenCount', 0));
      setReadCount(await DBUtils.get('shadow_readCount', 0));
      setHistory(await DBUtils.get('shadow_history', []));
      setIsDbLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!isDbLoaded) {
      return;
    }

    const savedText = text;
    if (!savedText || savedText === EMPTY_TEXT) {
      setIsGenerating(true);
      if (
        PreloadPipeline.cache.shadow &&
        PreloadPipeline.cache.shadow.lengthLevel === lengthLevel &&
        PreloadPipeline.cache.shadow.difficultyLevel === difficultyLevel &&
        PreloadPipeline.cache.shadow.learningFocus === learningFocus
      ) {
        const preloaded = PreloadPipeline.cache.shadow;
        setText(preloaded.text);
        if (selectedVoice === preloaded.voice) {
          setTtsAudioUrl(preloaded.audioUrl);
          audioCacheRef.current[preloaded.voice] = preloaded.audioUrl;
        } else {
          setTtsAudioUrl('');
        }
        currentSentenceParams.current = {
          lengthLevel,
          difficultyLevel,
          learningFocus
        };
        PreloadPipeline.cache.shadow = null;
        setIsGenerating(false);
      } else {
        void generateNewText(lengthLevel, learningFocus, difficultyLevel);
      }
    } else {
      currentSentenceParams.current = {
        lengthLevel,
        difficultyLevel,
        learningFocus
      };
    }
  }, [isDbLoaded]);

  useEffect(() => {
    if (!isDbLoaded) {
      return;
    }

    void DBUtils.set('shadow_text', text);
    void DBUtils.set('shadow_lengthLevel', lengthLevel);
    void DBUtils.set('shadow_difficultyLevel', difficultyLevel);
    void DBUtils.set('shadow_learningFocus', learningFocus);
    void DBUtils.set('shadow_listenCount', listenCount);
    void DBUtils.set('shadow_readCount', readCount);
    void DBUtils.set('shadow_history', history);
  }, [
    text,
    lengthLevel,
    difficultyLevel,
    learningFocus,
    listenCount,
    readCount,
    history,
    isDbLoaded
  ]);

  useEffect(() => {
    hasRecordedThisSentenceRef.current = false;
    setCurrentAudioPart(null);
  }, [text]);

  useEffect(() => {
    if (isRecording) {
      hasRecordedThisSentenceRef.current = true;
    }
  }, [isRecording]);

  useEffect(() => {
    if (!isDbLoaded || !text || text === EMPTY_TEXT) {
      return;
    }

    const cache = PreloadPipeline.cache.shadow;
    if (
      cache &&
      cache.lengthLevel === lengthLevel &&
      cache.learningFocus === learningFocus &&
      cache.difficultyLevel === difficultyLevel
    ) {
      return;
    }

    let idleTimer: number | null = null;
    if (
      !isRecording &&
        !hasRecordedThisSentenceRef.current &&
        !isGenerating &&
        !isEvaluating
      ) {
        idleTimer = window.setTimeout(() => {
          queueShadowPreload(
            lengthLevel,
            learningFocus,
            difficultyLevel,
            DEFAULT_SHADOW_VOICE
          );
        }, 2000);
      }

    return () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
    };
  }, [
    text,
    isRecording,
    isGenerating,
    isEvaluating,
    lengthLevel,
    learningFocus,
    difficultyLevel,
    isDbLoaded
  ]);

  useEffect(() => {
    if (!text || text === EMPTY_TEXT) {
      return;
    }

    let isCancelled = false;
    const fetchCurrentTTS = async () => {
      handleStop();
      if (!audioCacheRef.current[selectedVoice]) {
        setIsTtsLoading(true);
        const url = await fetchNeuralTTS(selectedVoice, text, null, {
          scopeId: requestScope.scopeId,
          supersedeKey: `shadow:tts:${selectedVoice}`,
          origin: 'ui',
          sceneKey: 'shadow:tts'
        });
        if (!isCancelled && typeof url === 'string') {
          audioCacheRef.current[selectedVoice] = url;
          setTtsAudioUrl(url);
        }
        setIsTtsLoading(false);
      } else {
        setTtsAudioUrl(audioCacheRef.current[selectedVoice]);
      }
    };

    void fetchCurrentTTS();
    return () => {
      isCancelled = true;
    };
  }, [text, selectedVoice]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, [rate]);

  const playSimpleSpeech = (content: string, onEndCallback: (() => void) | null = null) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = 'en-US';
    utterance.rate = rate;
    utterance.onend = () => {
      if (onEndCallback) {
        onEndCallback();
      } else {
        setIsPlaying(false);
        setIsPaused(false);
        setListenCount((previous) => previous + 1);
      }
    };
    synth.speak(utterance);
  };

  const generateNewText = async (
    targetLengthLevel = lengthLevel,
    currentFocus = learningFocus,
    currentDifficultyLevel = difficultyLevel
  ) => {
    if (text && text !== EMPTY_TEXT && (listenCount > 0 || readCount > 0)) {
      setHistory((previous) => [
        {
          id: Date.now(),
          text,
          listenCount,
          readCount,
          accuracy: evaluationResult?.accuracy ?? null,
          date: new Date().toLocaleString()
        },
        ...previous
      ]);
    }

    setApiError('');
    setListenCount(0);
    setReadCount(0);
    setTranscribedText('');
    setEvaluationResult(null);
    setShowText(false);
    handleStop();
    setCurrentAttempts([]);

    const safeLengthLevel = Number(targetLengthLevel) || 3;
    const safeDifficultyLevel = Number(currentDifficultyLevel) || 5;

    const cache = PreloadPipeline.cache.shadow;
    if (
      cache &&
      cache.lengthLevel === safeLengthLevel &&
      cache.learningFocus === currentFocus &&
      cache.difficultyLevel === safeDifficultyLevel
    ) {
      setIsGenerating(true);
      window.setTimeout(() => {
        setText(cache.text);
        audioCacheRef.current = {};
        if (cache.audioUrl && selectedVoice === cache.voice) {
          audioCacheRef.current[cache.voice] = cache.audioUrl;
          setTtsAudioUrl(cache.audioUrl);
          setIsTtsLoading(false);
        } else {
          setTtsAudioUrl('');
        }
        currentSentenceParams.current = {
          lengthLevel: safeLengthLevel,
          difficultyLevel: safeDifficultyLevel,
          learningFocus: currentFocus
        };
        PreloadPipeline.cache.shadow = null;
        setIsGenerating(false);
      }, 50);
      return;
    }

    PreloadPipeline.abortCurrent();
    if (manualGenControllerRef.current) {
      manualGenControllerRef.current.abort();
    }
    manualGenControllerRef.current = new AbortController();
    const signal = manualGenControllerRef.current.signal;

    setIsGenerating(true);
    audioCacheRef.current = {};
    setTtsAudioUrl('');

    try {
      const session = requestScope.beginSession();
      const lengthDesc = getLengthDescription(safeLengthLevel);
      const difficultyDesc = getDifficultyDescription(safeDifficultyLevel);

      const prompt = `Act as an expert English teacher. Generate ONE complete English sentence.
      
      STRICT REQUIREMENTS:
      1. Length & Structure: The sentence should be ${lengthDesc}. (Never output short fragments).
      2. Topic: "${currentFocus}". Choose a specific TOEFL-style context (e.g., campus life, biology, history, etc.).
      3. Vocabulary: Use ${difficultyDesc}.
      
      CRITICAL INSTRUCTION: Output ONLY the actual English sentence as the value for the "sentence" key. DO NOT include any conversational filler like "Here is the sentence:" inside the JSON.`;

      const schema = {
        type: 'OBJECT',
        properties: { sentence: { type: 'STRING' } },
        required: ['sentence']
      };

      const validator = (data: { sentence?: string }) => {
        if (!data || typeof data.sentence !== 'string') {
          throw new Error('Invalid format');
        }
        let content = data.sentence.trim();
        if (content.split(/\s+/).length < Math.max(4, safeLengthLevel + 2)) {
          throw new Error('Sentence too short fragment');
        }
        if (!/[.!?]["']?$/.test(content)) {
          data.sentence = `${content}.`;
          content = data.sentence;
        }
        if (/^(here is|here's|sure|certainly|the json|json requested)/i.test(content)) {
          throw new Error('Contains AI filler');
        }
      };

      const data = await fetchGeminiText(prompt, 0.7, 400, schema, null, validator, {
        scopeId: requestScope.scopeId,
        supersedeKey: 'shadow:generate',
        origin: 'ui',
        sceneKey: 'shadow:generate'
      });
      if (signal.aborted || !requestScope.isSessionCurrent(session)) {
        return;
      }

      setText(data.sentence.trim());
      currentSentenceParams.current = {
        lengthLevel: safeLengthLevel,
        difficultyLevel: safeDifficultyLevel,
        learningFocus: currentFocus
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return;
      }
      setApiError('生成句子失败，可能是网络问题，请重试。');
    } finally {
      if (!signal.aborted) {
        setIsGenerating(false);
      }
    }
  };

  const handlePlay = async () => {
    if (isPaused && audioRef.current && ttsAudioUrl) {
      await audioRef.current.play();
      setIsPaused(false);
      setIsPlaying(true);
      return;
    }

    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      setIsPlaying(true);
      return;
    }

    if (ttsAudioUrl && audioRef.current) {
      audioRef.current.src = ttsAudioUrl;
      audioRef.current.playbackRate = rate;
      try {
        await audioRef.current.play();
        setIsPlaying(true);
        setIsPaused(false);
      } catch (error) {
        console.error('Audio block:', error);
        setApiError('浏览器自动播放拦截，已降级为系统本地机器语音。');
        window.setTimeout(() => setApiError(''), 4000);
        playSimpleSpeech(text);
        setIsPlaying(true);
        setIsPaused(false);
      }
    } else if (text) {
      setApiError('超清语音 API 请求受限，当前已自动降级为系统基础机器语音。');
      window.setTimeout(() => setApiError(''), 4000);
      playSimpleSpeech(text);
      setIsPlaying(true);
      setIsPaused(false);
    }
  };

  const handlePause = () => {
    if (audioRef.current && isPlaying && ttsAudioUrl) {
      audioRef.current.pause();
    } else if (isPlaying) {
      window.speechSynthesis.pause();
    }
    setIsPaused(true);
    setIsPlaying(false);
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setHighlightStart(0);
    setHighlightLength(0);
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setIsPaused(false);
    setHighlightStart(0);
    setHighlightLength(0);
    setListenCount((previous) => previous + 1);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current || !isPlaying) {
      return;
    }

    const { currentTime, duration } = audioRef.current;
    if (duration > 0.25 && text) {
      const adjustedTime = Math.max(0, currentTime - 0.25);
      const targetIndex = Math.floor((adjustedTime / (duration - 0.25)) * text.length);
      let start = targetIndex;
      while (start > 0 && !/\s/.test(text[start - 1])) {
        start -= 1;
      }
      let end = targetIndex;
      while (end < text.length && !/\s/.test(text[end])) {
        end += 1;
      }
      setHighlightStart(Math.max(0, start));
      setHighlightLength(Math.min(text.length, end) - start);
    }
  };

  const toggleRecording = async () => {
    setMediaError('');
    if (isRecording) {
      await playBeep(400, 0.15);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      setReadCount((previous) => previous + 1);
      return;
    }

    const recordingSession = requestScope.beginSession();
    handleStop();
    setTranscribedText('Listening...');
    setEvaluationResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await playBeep(800, 0.1);

      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      mediaRecorderRef.current.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        let transcript = '';
        try {
          transcript = await requestTranscription({
            audioBlob,
            prompt: 'Transcribe this English pronunciation practice audio into plain English text.',
            scopeId: requestScope.scopeId,
            supersedeKey: 'shadow:transcription'
          });
        } catch (error) {
          console.warn('Shadowing transcription failed:', error);
        }
        if (!requestScope.isSessionCurrent(recordingSession)) {
          return;
        }

        setTranscribedText(transcript);
        void evaluatePronunciation(text, transcript, audioBlob);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      setMediaError('无法访问麦克风。请确保授予权限。');
    }
  };

  const evaluatePronunciation = async (
    originalText: string,
    spokenText: string,
    audioBlob: Blob
  ) => {
    const originalWords = originalText.split(/\s+/).filter((word) => word.length > 0);

    if ((!spokenText || !spokenText.trim()) && (!audioBlob || audioBlob.size === 0)) {
      setEvaluationResult({
        words: originalWords.map((word) => ({
          word,
          status: 'omitted',
          isCorrect: false
        })),
        accuracy: 0
      });
      setAiAdvice('未检测到声音。请大声朗读。');
      return;
    }

    setIsEvaluating(true);
    let nextLengthLevel = lengthLevel;
    let nextFocus = learningFocus;
    let currentFluency = 0;
    let currentIntonation = 0;
    const evaluationSession = requestScope.beginSession();

    try {
      let base64Audio: string | null = null;
      let mimeType = 'audio/webm';
      if (audioBlob && audioBlob.size > 0) {
        base64Audio = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result ?? '').split(',')[1]);
          reader.readAsDataURL(audioBlob);
        });
        mimeType = audioBlob.type || 'audio/webm';
        setCurrentAudioPart({ mimeType, data: base64Audio });
      }

      const historyAccuracy =
        history
          .slice(0, 3)
          .map((item) => item.accuracy)
          .join('%, ') + (history.length > 0 ? '%' : '');
      const indexedOriginal = originalWords
        .map((word, index) => `[${index}] ${word}`)
        .join(' ');

      const promptText = `Evaluate pronunciation based strictly on the AUDIO. Ignore STT text errors.
      Original Text: ${indexedOriginal}
      Difficulty: Length Lv.${lengthLevel}, Vocab Lv.${difficultyLevel}.
      User Practice Stats: Listened ${listenCount} times, Read ${readCount + 1} times. Text was ${showText ? 'VISIBLE' : 'HIDDEN'}.
      History Context: [${historyAccuracy}]
      CRITICAL INSTRUCTION FOR 'advice' (in Chinese): 
      - Provide comprehensive, personalized feedback combining ALL user stats (e.g. mention their listen/read counts and text visibility).
      - If VISIBLE, explicitly encourage hiding text for blind listening. If HIDDEN, praise their blind effort.
      Return JSON: {"errors": [{"index": ..., "word": "...", "status": "omitted|wrong", "spoken": "...", "ipa": "..."}], "advice": "...", "fluencyScore": 0-100, "intonationScore": 0-100, "suggestedFocus": "..."}`;

      const parts: Array<Record<string, unknown>> = [{ text: promptText }];
      if (base64Audio) {
        parts.push({ inlineData: { mimeType, data: base64Audio } });
      }

      const schema = {
        type: 'OBJECT',
        properties: {
          errors: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                index: { type: 'INTEGER' },
                word: { type: 'STRING' },
                status: { type: 'STRING' },
                spoken: { type: 'STRING' },
                ipa: { type: 'STRING' }
              },
              required: ['index', 'word', 'status', 'spoken', 'ipa']
            }
          },
          advice: { type: 'STRING' },
          fluencyScore: { type: 'INTEGER' },
          intonationScore: { type: 'INTEGER' },
          suggestedFocus: { type: 'STRING' }
        },
        required: [
          'errors',
          'advice',
          'fluencyScore',
          'intonationScore',
          'suggestedFocus'
        ]
      };
      const validator = (data: any) => {
        if (!data || !Array.isArray(data.errors) || typeof data.fluencyScore !== 'number') {
          throw new Error('Invalid format from API');
        }
      };

      let data = await fetchGeminiText(parts, 0.4, 1500, schema, null, validator, {
        scopeId: requestScope.scopeId,
        supersedeKey: 'shadow:evaluate',
        origin: 'ui',
        sceneKey: 'shadow:evaluate'
      });
      if (!requestScope.isSessionCurrent(evaluationSession)) {
        return;
      }

      if (!data) {
        data = {};
      }
      const errorMap: Record<number, any> = {};
      (data.errors || []).forEach((error: any) => {
        if (error.index !== undefined) {
          errorMap[error.index] = error;
        }
      });

      const resultWords = originalWords.map((word, index) => {
        const error = errorMap[index];
        return error
          ? {
              word,
              isCorrect: false,
              status: error.status === 'wrong' ? 'wrong' : 'omitted',
              spoken:
                error.status === 'wrong'
                  ? (error.spoken || '').substring(0, 15)
                  : '',
              ipa:
                error.status === 'wrong' ? (error.ipa || '').substring(0, 20) : ''
            }
          : { word, isCorrect: true, status: 'correct', spoken: '', ipa: '' };
      });
      const realAccuracy = originalWords.length
        ? Math.round(
            (resultWords.filter((word) => word.isCorrect).length / originalWords.length) *
              100
          )
        : 0;
      currentFluency = data.fluencyScore || 0;
      currentIntonation = data.intonationScore || 0;
      setEvaluationResult({
        words: resultWords,
        accuracy: realAccuracy,
        fluency: currentFluency,
        intonation: currentIntonation
      });

      const finalAdvice = `### 🎯 跟读评测完成！\n\n- **综合准确度**：**${realAccuracy}%**\n- **发音流畅度**：**${currentFluency}%**\n- **自然语调**：**${currentIntonation}%**\n\n${data.advice || '继续努力！'}`;
      setAiAdvice(finalAdvice);

      const updatedAttempts = [
        ...currentAttempts,
        {
          accuracy: realAccuracy,
          fluency: currentFluency,
          intonation: currentIntonation
        }
      ];
      setCurrentAttempts(updatedAttempts);

      const triesCount = updatedAttempts.length;
      const getComprehensiveScore = (attempt: any) =>
        attempt.accuracy * 0.5 + attempt.fluency * 0.3 + attempt.intonation * 0.2;

      const latestScore = getComprehensiveScore(updatedAttempts[triesCount - 1]);
      const averageScore =
        updatedAttempts.reduce((sum, attempt) => sum + getComprehensiveScore(attempt), 0) /
        triesCount;

      const isFirstTryPerfect = triesCount === 1 && latestScore >= 85 && realAccuracy >= 85;
      const isConsistentlyGood =
        triesCount > 1 && latestScore >= 85 && averageScore >= 80;
      const isStruggling = triesCount >= 2 && latestScore < 75 && averageScore < 75;
      const isFirstTryTerrible = triesCount === 1 && latestScore < 60;

      let nextLength = lengthLevel;
      if (isFirstTryPerfect || isConsistentlyGood) {
        nextLength = lengthLevel + 1;
      } else if (isStruggling || isFirstTryTerrible) {
        nextLength = lengthLevel - 1;
      }

      nextLengthLevel = Math.max(1, Math.min(10, nextLength));
      nextFocus = data.suggestedFocus || learningFocus;
    } catch (error: any) {
      console.warn('AI 深度评测失败，已降级为本地评测模式。原因:', error?.message);
      const cleanWord = (word: string) => word.toLowerCase().replace(/[^\w\s']/g, '');
      const spokenWords = spokenText
        ? spokenText
            .split(/\s+/)
            .map(cleanWord)
            .filter((word) => word.length > 0)
        : [];
      let correctCount = 0;
      let spokenIndex = 0;

      const resultWords = originalWords.map((rawWord) => {
        const cleanTarget = cleanWord(rawWord);
        let isCorrect = false;
        let spoken = '';
        for (
          let index = spokenIndex;
          index < Math.min(spokenIndex + 4, spokenWords.length);
          index += 1
        ) {
          if (
            spokenWords[index] === cleanTarget ||
            spokenWords[index].startsWith(cleanTarget.substring(0, cleanTarget.length - 1))
          ) {
            isCorrect = true;
            spokenIndex = index + 1;
            correctCount += 1;
            break;
          }
        }
        if (!isCorrect && spokenIndex < spokenWords.length) {
          spoken = spokenWords[spokenIndex];
          spokenIndex += 1;
        }
        return {
          word: rawWord,
          isCorrect,
          status: isCorrect ? 'correct' : spoken ? 'wrong' : 'omitted',
          spoken,
          ipa: spoken ? 'N/A' : ''
        };
      });
      const localAccuracy = originalWords.length
        ? Math.round((correctCount / originalWords.length) * 100)
        : 0;
      setEvaluationResult({
        words: resultWords,
        accuracy: localAccuracy,
        fluency: localAccuracy,
        intonation: localAccuracy
      });

      const updatedAttempts = [
        ...currentAttempts,
        {
          accuracy: localAccuracy,
          fluency: localAccuracy,
          intonation: localAccuracy
        }
      ];
      setCurrentAttempts(updatedAttempts);

      const triesCount = updatedAttempts.length;
      const latestScore = localAccuracy;
      const averageScore =
        updatedAttempts.reduce((sum, attempt) => sum + attempt.accuracy, 0) / triesCount;

      let nextLength = lengthLevel;
      if (
        (triesCount === 1 && latestScore >= 85) ||
        (triesCount > 1 && latestScore >= 85 && averageScore >= 80)
      ) {
        nextLength = lengthLevel + 1;
      } else if (
        (triesCount >= 2 && latestScore < 75 && averageScore < 75) ||
        (triesCount === 1 && latestScore < 60)
      ) {
        nextLength = lengthLevel - 1;
      }

      nextLengthLevel = Math.max(1, Math.min(10, nextLength));
      setAiAdvice('AI 深度录音评测暂时不可用，已自动启用本地备用打分。您可以继续向我提问。');
    } finally {
      setIsEvaluating(false);
      if (nextLengthLevel !== lengthLevel) {
        setLengthLevel(nextLengthLevel);
      }
      if (nextFocus !== learningFocus) {
        setLearningFocus(nextFocus);
      }
      queueShadowPreload(
        nextLengthLevel,
        nextFocus,
        difficultyLevel,
        DEFAULT_SHADOW_VOICE
      );
    }
  };

  const handleDiscardAttempt = () => {
    setCurrentAttempts((previous) => previous.slice(0, -1));
    setEvaluationResult(null);
    setAiAdvice(
      '已撤销上一次的异常录音成绩。本次将不计入难度评估，请重新点击“开始跟读”进行尝试。'
    );
    setTranscribedText('');
    setReadCount((previous) => Math.max(0, previous - 1));

    setLengthLevel(currentSentenceParams.current.lengthLevel);
    setDifficultyLevel(currentSentenceParams.current.difficultyLevel);
    setLearningFocus(currentSentenceParams.current.learningFocus);
  };

  const handleHistoryScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 10) {
      if (visibleHistoryCount < history.length) {
        setVisibleHistoryCount((previous) => previous + 10);
      }
    }
  };

  const deleteHistoryItem = (id: number, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const nextHistory = history.filter((item) => item.id !== id);
    setHistory(nextHistory);
    void DBUtils.set('shadow_history', nextHistory);
  };

  const renderHighlightedText = () => {
    if (!isPlaying && !isPaused) {
      return (
        <p className="text-base md:text-lg leading-relaxed text-slate-800 font-medium">
          {text}
        </p>
      );
    }

    const before = text.substring(0, highlightStart);
    const highlighted = text.substring(highlightStart, highlightStart + highlightLength);
    const after = text.substring(highlightStart + highlightLength);

    return (
      <p className="text-base md:text-lg leading-relaxed text-slate-400 font-medium">
        <span>{before}</span>
        <span className="text-indigo-600 bg-indigo-50/50 rounded px-1 transition-colors duration-75">
          {highlighted}
        </span>
        <span className="text-slate-800">{after}</span>
      </p>
    );
  };

  const averageLevel = Math.round((lengthLevel + difficultyLevel) / 2);

  return (
    <div className="bg-slate-50 min-h-[calc(100vh-64px)] p-4 md:p-6 font-sans pb-20">
      <audio
        ref={audioRef}
        onEnded={handleAudioEnded}
        onTimeUpdate={handleTimeUpdate}
        className="hidden"
      />
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center space-y-3 md:space-y-0 pb-4 border-b border-slate-200">
          <div className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition" onClick={onBack}>
            <div className="bg-slate-200 p-2 rounded-lg text-slate-600">
              <ArrowLeft className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">影子跟读</h1>
              <p className="text-slate-500 text-xs">听懂、读准、掌握</p>
            </div>
          </div>
        </header>

        <div className="space-y-4">
          {apiError && (
            <div className="bg-amber-50 text-amber-700 p-3 rounded-lg border border-amber-200 flex items-center text-sm animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
              {apiError}
            </div>
          )}

          {mediaError && (
            <div className="bg-rose-50 text-rose-700 p-3 rounded-lg border border-rose-200 flex items-center text-sm animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
              {mediaError}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex justify-center w-full relative z-30">
              <div className="inline-flex items-center bg-white/90 backdrop-blur-md border border-slate-200/60 shadow-sm hover:shadow-md rounded-full px-5 py-2.5 text-xs font-medium text-slate-500 gap-5 transition-all">
                <div className="flex items-center gap-1.5 hover:text-slate-800 transition-colors relative cursor-pointer group/voice">
                  <Mic className="w-3.5 h-3.5 opacity-70" />
                  <select
                    value={selectedVoice}
                    onChange={(event) => setSelectedVoice(event.target.value)}
                    className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer appearance-none pl-0.5 pr-3 relative z-10"
                  >
                    <option value="Aoede">Aoede</option>
                    <option value="Zephyr">Zephyr</option>
                    <option value="Kore">Kore</option>
                    <option value="Puck">Puck</option>
                    <option value="Charon">Charon</option>
                    <option value="Fenrir">Fenrir</option>
                  </select>
                  <ChevronRight className="w-3 h-3 absolute right-0 top-1 text-slate-400 rotate-90 opacity-60 group-hover/voice:opacity-100 transition-opacity pointer-events-none" />
                </div>

                <div className="w-px h-3.5 bg-slate-200"></div>

                <div className="relative group/settings flex items-center gap-1.5 cursor-pointer hover:text-slate-800 transition-colors py-1">
                  <Settings className="w-3.5 h-3.5 opacity-70" />
                  <span className="font-bold text-slate-700">Lv.{averageLevel}</span>

                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-56 bg-white/95 backdrop-blur-xl border border-slate-200/80 shadow-xl rounded-2xl p-4 opacity-0 invisible group-hover/settings:opacity-100 group-hover/settings:visible transition-all duration-200 z-50 transform origin-top group-hover/settings:scale-100 scale-95">
                    <div className="space-y-5 cursor-default" onClick={(event) => event.stopPropagation()}>
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs items-center">
                          <span className="text-slate-500 font-medium">句子长度 (Length)</span>
                          <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                            L{lengthLevel}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          value={lengthLevel}
                          onChange={(event) => setLengthLevel(parseInt(event.target.value, 10))}
                          className="w-full h-1.5 bg-slate-100 rounded-full outline-none accent-indigo-500 cursor-pointer transition-all hover:h-2"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs items-center">
                          <span className="text-slate-500 font-medium">词汇难度 (Vocab)</span>
                          <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                            L{difficultyLevel}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          value={difficultyLevel}
                          onChange={(event) =>
                            setDifficultyLevel(parseInt(event.target.value, 10))
                          }
                          className="w-full h-1.5 bg-slate-100 rounded-full outline-none accent-indigo-500 cursor-pointer transition-all hover:h-2"
                        />
                      </div>
                    </div>
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-slate-200/80 rotate-45 rounded-tl-[2px]"></div>
                  </div>
                </div>

                <div className="w-px h-3.5 bg-slate-200 hidden sm:block"></div>

                <div
                  className="hidden sm:flex items-center gap-1.5 hover:text-slate-800 transition-colors"
                  title={`已听过 ${listenCount} 次`}
                >
                  <Headphones className="w-3.5 h-3.5 opacity-70" />
                  <span className="font-bold text-slate-700">{listenCount}</span>
                </div>

                <div className="w-px h-3.5 bg-slate-200"></div>

                <button
                  onClick={() => setShowText(!showText)}
                  className="flex items-center gap-1.5 hover:text-slate-800 transition-colors outline-none"
                >
                  {showText ? (
                    <EyeOff className="w-3.5 h-3.5 opacity-70" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 opacity-70" />
                  )}
                  <span className="font-bold text-slate-700">
                    {showText ? '隐藏文本' : '显示文本'}
                  </span>
                </button>

                {PreloadPipeline.cache.shadow && (
                  <div
                    className="absolute -right-0.5 -top-0.5 animate-in fade-in zoom-in duration-300"
                    title="下一句资源已就绪"
                  >
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-white"></span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-[80px] flex flex-col relative justify-center items-center w-full my-1">
              {isGenerating ? (
                <div className="animate-pulse space-y-3 w-full max-w-lg">
                  <div className="h-3 bg-slate-200 rounded w-3/4 mx-auto"></div>
                  <div className="h-3 bg-slate-200 rounded w-1/2 mx-auto"></div>
                </div>
              ) : showText ? (
                <div
                  key={text}
                  className="animate-in fade-in slide-in-from-right-4 duration-500 w-full text-center px-4"
                >
                  {renderHighlightedText()}
                </div>
              ) : (
                <div
                  className="flex flex-col items-center py-2 text-slate-400 cursor-pointer transition-colors hover:text-indigo-500 group"
                  onClick={() => setShowText(true)}
                >
                  <Eye className="w-8 h-8 mb-1.5 opacity-40 group-hover:opacity-70 transition-opacity" />
                  <p className="text-xs font-medium">点击显示文本内容</p>
                </div>
              )}
            </div>

            <div className="flex justify-center mb-2">
              <div className="bg-white border border-slate-200 rounded-full p-1.5 flex items-center justify-center space-x-1.5 shadow-md mx-auto w-max">
                {isPlaying ? (
                  <button
                    onClick={handlePause}
                    className="w-12 h-12 flex items-center justify-center bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-full transition-colors"
                    title="暂停"
                  >
                    <Pause className="w-5 h-5 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={() => void handlePlay()}
                    disabled={isGenerating || isTtsLoading || !ttsAudioUrl}
                    className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${
                      isGenerating || isTtsLoading || !ttsAudioUrl
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:scale-105 active:scale-95'
                    }`}
                    title="播放神经语音"
                  >
                    {isTtsLoading ? (
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    ) : (
                      <Play className="w-5 h-5 fill-current ml-1" />
                    )}
                  </button>
                )}

                <button
                  onClick={handleStop}
                  className="w-10 h-10 flex items-center justify-center bg-transparent hover:bg-slate-100 text-slate-500 rounded-full transition-colors"
                  disabled={!isPlaying && !isPaused}
                  title="停止"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>

                <div className="px-1">
                  <select
                    value={rate}
                    onChange={(event) => setRate(parseFloat(event.target.value))}
                    className="text-sm border-none text-slate-600 font-bold bg-transparent outline-none cursor-pointer hover:text-indigo-600 transition-colors"
                  >
                    <option value="0.8">0.8x</option>
                    <option value="1">1.0x</option>
                    <option value="1.2">1.2x</option>
                  </select>
                </div>

                <div className="w-px h-6 bg-slate-200 mx-1"></div>

                <button
                  onClick={() => void toggleRecording()}
                  disabled={isGenerating || !text || text.includes('Click')}
                  className={`w-12 h-12 flex items-center justify-center rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    isRecording
                      ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-200 animate-pulse'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm hover:scale-105 active:scale-95'
                  }`}
                  title={isRecording ? '结束录音并提交评分' : '开始您的跟读'}
                >
                  {isRecording ? (
                    <Square className="w-5 h-5 fill-current" />
                  ) : (
                    <Mic className="w-5 h-5" />
                  )}
                </button>

                <div className="w-px h-6 bg-slate-200 mx-1"></div>

                <button
                  onClick={() =>
                    void generateNewText(lengthLevel, learningFocus, difficultyLevel)
                  }
                  disabled={isGenerating}
                  className="w-12 h-12 flex items-center justify-center bg-transparent hover:bg-slate-100 text-slate-600 hover:text-indigo-600 rounded-full transition-all disabled:opacity-50"
                  title="随机生成下一句"
                >
                  {isGenerating ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <ArrowRight className="w-6 h-6" />
                  )}
                </button>
              </div>
            </div>

            {(isRecording || isEvaluating || evaluationResult) && (
              <div className="pt-1">
                {isRecording && (
                  <div className="text-center text-sm font-medium text-indigo-600 bg-indigo-50 p-4 rounded-xl border border-indigo-100 mx-auto max-w-2xl w-full shadow-sm animate-in zoom-in-95">
                    <Mic className="w-4 h-4 inline mr-2 animate-bounce" /> 正在倾听您的发音:
                    "{transcribedText || '...'}"
                  </div>
                )}
                {isEvaluating && (
                  <div className="text-center text-sm font-medium text-blue-600 bg-blue-50 p-4 rounded-xl border border-blue-100 mx-auto max-w-2xl w-full shadow-sm animate-in zoom-in-95">
                    <RefreshCw className="w-4 h-4 animate-spin inline mr-2" /> AI
                    深度发音评测中，请稍候...
                  </div>
                )}
                {!isRecording && !isEvaluating && evaluationResult && (
                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 shadow-inner mx-auto max-w-4xl w-full animate-in slide-in-from-bottom-4">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 pb-3 border-b border-slate-100 gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-bold text-slate-700 flex items-center">
                          <Sparkles className="w-4 h-4 mr-1 text-amber-500" /> 评测结果
                        </span>
                        <div className="flex space-x-2 text-xs font-bold">
                          <span
                            className={`px-2.5 py-1 rounded-md shadow-sm border ${
                              evaluationResult.accuracy >= 80
                                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                : 'text-rose-700 bg-rose-50 border-rose-200'
                            }`}
                          >
                            准确度 {evaluationResult.accuracy}%
                          </span>
                          <span
                            className={`px-2.5 py-1 rounded-md shadow-sm border ${
                              evaluationResult.fluency >= 80
                                ? 'text-blue-700 bg-blue-50 border-blue-200'
                                : 'text-amber-700 bg-amber-50 border-amber-200'
                            }`}
                          >
                            流畅度 {evaluationResult.fluency}%
                          </span>
                          <span
                            className={`px-2.5 py-1 rounded-md shadow-sm border ${
                              evaluationResult.intonation >= 80
                                ? 'text-purple-700 bg-purple-50 border-purple-200'
                                : 'text-amber-700 bg-amber-50 border-amber-200'
                            }`}
                          >
                            语调 {evaluationResult.intonation}%
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={handleDiscardAttempt}
                        className="text-xs flex items-center text-rose-500 hover:text-rose-700 transition-colors font-medium bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-md shadow-sm border border-rose-100"
                      >
                        <RotateCcw className="w-3 h-3 mr-1" /> 撤销成绩
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-y-8 gap-x-2 justify-center">
                      {evaluationResult.words.map((item: any, index: number) => (
                        <div key={index} className="flex flex-col items-center min-w-[2.5rem] relative">
                          <span
                            className={`px-2 py-1 rounded-md font-medium shadow-sm border ${
                              item.isCorrect
                                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                : 'text-rose-700 bg-rose-50 border-rose-200 underline decoration-wavy'
                            }`}
                          >
                            {item.word}
                          </span>
                          {!item.isCorrect && item.status === 'wrong' && item.spoken && (
                            <div className="absolute top-full mt-1.5 text-[10px] text-center bg-white px-1.5 py-0.5 rounded shadow border border-rose-200 z-10 w-max">
                              <span className="text-rose-600 font-bold">{item.spoken}</span>
                              <br />
                              <span className="text-indigo-600 font-mono text-[9px]">
                                /{item.ipa}/
                              </span>
                            </div>
                          )}
                          {!item.isCorrect && item.status === 'omitted' && (
                            <span className="absolute top-full mt-1.5 text-[10px] font-bold text-slate-400">
                              (漏读)
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            className={`grid grid-cols-1 ${
              isHistoryOpen ? 'lg:grid-cols-3' : 'lg:grid-cols-1'
            } gap-6 pt-4 transition-all duration-300 ease-in-out`}
          >
            <div
              className={`${
                isHistoryOpen ? 'lg:col-span-2' : 'lg:col-span-1'
              } bg-blue-50/50 rounded-xl shadow-sm border border-blue-200 h-[500px] relative overflow-hidden transition-all duration-300`}
            >
              <AITutorChat
                chatId="shadow_chat"
                key={text}
                isPrimary={true}
                title="私教陪练"
                initialAdvice={aiAdvice}
                contextText={`当前正在练习的句子是: ${text}`}
                audioParts={currentAudioPart ? [currentAudioPart] : []}
                extraHeaderElements={
                  <button
                    onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                    className={`flex items-center space-x-1.5 text-xs font-bold px-2 py-1 rounded-md transition-colors ${
                      isHistoryOpen
                        ? 'text-indigo-600 bg-indigo-50'
                        : 'text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    <History className="w-4 h-4" />
                    <span className="hidden sm:inline">
                      {isHistoryOpen ? '收起历史' : '展开历史'}
                    </span>
                  </button>
                }
              />
            </div>

            {isHistoryOpen && (
              <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-[500px] animate-in slide-in-from-right-4 duration-300">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-700 flex items-center">
                    <History className="w-4 h-4 mr-2 text-indigo-500" /> 学习历史
                  </h2>
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold shadow-sm">
                    {history.length} 条
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3" onScroll={handleHistoryScroll}>
                  {history.slice(0, visibleHistoryCount).map((item) => (
                    <div
                      key={item.id}
                      className="p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-sm transition-all relative group"
                    >
                      <div className="flex justify-between items-start mb-1.5">
                        <p className="text-[10px] font-medium text-slate-400">{item.date}</p>
                        <button
                          onClick={(event) => deleteHistoryItem(item.id, event)}
                          className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-rose-500 transition-all p-1 bg-white rounded-full shadow-sm"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <p
                        className="text-sm text-slate-700 line-clamp-3 font-medium mb-3 pr-4 leading-relaxed"
                        title={item.text}
                      >
                        {item.text}
                      </p>
                      <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                        <div className="flex space-x-3 text-slate-500">
                          <span title="听力次数" className="flex items-center">
                            <Headphones className="w-3 h-3 mr-1" /> {item.listenCount}
                          </span>
                          <span title="朗读次数" className="flex items-center">
                            <Mic className="w-3 h-3 mr-1" /> {item.readCount}
                          </span>
                        </div>
                        {item.accuracy !== null ? (
                          <span
                            className={`font-black ${
                              item.accuracy >= 80 ? 'text-emerald-600' : 'text-amber-500'
                            }`}
                          >
                            准确率 {item.accuracy}%
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium">未评测</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {history.length === 0 && (
                    <div className="text-center text-slate-400 text-xs py-10">
                      暂无历史记录
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
