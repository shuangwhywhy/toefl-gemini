import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Ear,
  Headphones,
  MessageCircle,
  Mic,
  PencilLine,
  PenTool,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Volume2
} from 'lucide-react';

export type PreloadStatus = {
  shadow: boolean;
  interview: boolean;
  listening: boolean;
  dictation: boolean;
  shadowError: boolean;
  interviewError: boolean;
  listeningError: boolean;
  dictationError: boolean;
};

export function DeviceSetupModule({ onComplete }: { onComplete: () => void }) {
  const [speakerStatus, setSpeakerStatus] = useState('idle');
  const [micStatus, setMicStatus] = useState('idle');
  const [micVolume, setMicVolume] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const autoCheckMic = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasGrantedMic = devices.some(
          (device) => device.kind === 'audioinput' && !!device.label
        );
        if (hasGrantedMic) {
          setMicStatus('passed');
          return;
        }

        if (navigator.permissions && navigator.permissions.query) {
          const permission = await navigator.permissions.query({
            name: 'microphone' as PermissionName
          });
          if (permission.state === 'granted') {
            setMicStatus('passed');
          }
        }
      } catch (error) {
        console.warn('自动检测麦克风权限失败', error);
      }
    };

    void autoCheckMic();
  }, []);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        void audioContextRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handleTestSpeaker = () => {
    setSpeakerStatus('testing');
    const utterance = new SpeechSynthesisUtterance(
      'Welcome to the AI TOEFL training system.'
    );
    utterance.lang = 'en-US';
    utterance.onend = () => setSpeakerStatus('passed');
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    window.setTimeout(() => {
      setSpeakerStatus((current) => (current !== 'passed' ? 'passed' : current));
    }, 3000);
  };

  const handleTestMic = async () => {
    setMicStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error('AudioContext unavailable');
      }

      audioContextRef.current = new AudioContextCtor();
      const analyser = audioContextRef.current.createAnalyser();
      const microphone =
        audioContextRef.current.createMediaStreamSource(stream);
      microphone.connect(analyser);
      analyser.fftSize = 256;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      setMicStatus('listening');
      let soundDetectedCount = 0;
      let frameCount = 0;

      const updateVolume = () => {
        if (!audioContextRef.current) {
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let index = 0; index < dataArray.length; index += 1) {
          sum += dataArray[index];
        }
        const average = sum / dataArray.length;
        const volume = Math.min(100, Math.max(0, average * 2.5));
        setMicVolume(volume);

        frameCount += 1;
        if (frameCount > 30 && volume > 30) {
          soundDetectedCount += 1;
        }

        if (soundDetectedCount > 20) {
          setMicStatus('passed');
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
          }
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }
        } else {
          animationFrameRef.current = requestAnimationFrame(updateVolume);
        }
      };

      updateVolume();
    } catch {
      setMicStatus('error');
    }
  };

  const allPassed = speakerStatus === 'passed' && micStatus === 'passed';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
      <div className="max-w-xl w-full bg-white p-8 md:p-12 rounded-3xl shadow-xl border border-slate-200">
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldCheck className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight mb-2">
            环境准备与授权
          </h1>
          <p className="text-slate-500">确保您的音响和麦克风正常可用</p>
        </div>

        <div className="space-y-4 mb-10">
          <div
            className={`p-5 rounded-2xl border transition-all flex items-center justify-between ${
              speakerStatus === 'passed'
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center space-x-4">
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  speakerStatus === 'passed'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-white text-slate-500 shadow-sm border border-slate-200'
                }`}
              >
                <Volume2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">1. 播放设备</h3>
                <p className="text-[10px] text-slate-400">点击按钮播放测试音</p>
              </div>
            </div>
            <div className="w-28 shrink-0 flex justify-end">
              {speakerStatus === 'passed' ? (
                <span className="flex justify-center items-center text-emerald-600 font-bold w-full py-2 bg-white rounded-full shadow-sm text-xs">
                  <Check className="w-3 h-3 mr-1" /> 已就绪
                </span>
              ) : speakerStatus === 'testing' ? (
                <button
                  disabled
                  className="w-full py-2 bg-indigo-200 text-indigo-700 rounded-full font-bold text-xs flex items-center justify-center"
                >
                  <RefreshCw className="w-3 h-3 animate-spin mr-1" /> 播放中
                </button>
              ) : (
                <button
                  onClick={handleTestSpeaker}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-bold text-xs shadow-md transition-colors flex justify-center items-center"
                >
                  测试声音
                </button>
              )}
            </div>
          </div>

          <div
            className={`p-5 rounded-2xl border transition-all flex items-center justify-between ${
              micStatus === 'passed'
                ? 'bg-emerald-50 border-emerald-200'
                : micStatus === 'error'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center space-x-4">
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  micStatus === 'passed'
                    ? 'bg-emerald-100 text-emerald-600'
                    : micStatus === 'error'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-white text-slate-500 shadow-sm border border-slate-200'
                }`}
              >
                <Mic className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">2. 录音设备</h3>
                <p className="text-[10px] text-slate-400">授权并大声说两句</p>
              </div>
            </div>
            <div className="w-28 shrink-0 flex justify-end">
              {micStatus === 'passed' ? (
                <span className="flex justify-center items-center text-emerald-600 font-bold w-full py-2 bg-white rounded-full shadow-sm text-xs">
                  <Check className="w-3 h-3 mr-1" /> 已通过
                </span>
              ) : micStatus === 'requesting' ? (
                <button
                  disabled
                  className="w-full py-2 bg-indigo-200 text-indigo-700 rounded-full font-bold text-xs flex items-center justify-center"
                >
                  <RefreshCw className="w-3 h-3 animate-spin mr-1" /> 请求中
                </button>
              ) : micStatus === 'listening' ? (
                <div className="flex flex-col items-center w-full">
                  <div className="flex space-x-0.5 h-4 items-end w-full justify-center">
                    {[1, 2, 3, 4, 5].map((index) => (
                      <div
                        key={index}
                        className="w-2 bg-indigo-400 rounded-t-sm transition-all duration-75"
                        style={{
                          height: `${Math.max(
                            20,
                            Math.min(
                              100,
                              micVolume * (Math.random() * 0.5 + 0.5)
                            )
                          )}%`
                        }}
                      ></div>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => void handleTestMic()}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-bold text-xs shadow-md transition-colors flex justify-center items-center"
                >
                  授权测试
                </button>
              )}
            </div>
          </div>

          {micStatus === 'error' && (
            <p className="text-[10px] text-red-500 font-medium px-4">
              麦克风访问被拒绝，请点击浏览器地址栏锁图标允许权限后重试。
            </p>
          )}
        </div>

        <button
          onClick={onComplete}
          disabled={!allPassed}
          className="w-full py-4 rounded-xl font-black text-lg transition-all shadow-lg flex items-center justify-center disabled:opacity-50 disabled:shadow-none disabled:bg-slate-300 disabled:text-slate-500 bg-slate-900 hover:bg-slate-800 text-white"
        >
          进入训练系统 <ArrowRight className="w-5 h-5 ml-2" />
        </button>
      </div>
    </div>
  );
}

export function MainMenuModule({
  onNavigate
}: {
  onNavigate: (mode: string) => void;
}) {
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-4xl w-full text-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h1 className="text-4xl font-black text-slate-800 tracking-tight mb-4">
          AI 新托福全科训练
        </h1>
        <p className="text-slate-500 text-lg">
          全真题库，多模态 AI 深度评测，从输入到输出全面提升。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full">
        <div
          onClick={() => onNavigate('listening_menu')}
          className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-emerald-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mb-5">
            <Ear className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">听力 (Listening)</h2>
          <p className="text-slate-500 text-sm leading-relaxed mb-6">
            全真讲座与对话听写，精听泛听结合，攻克生词与复杂长难句。
          </p>
          <span className="text-emerald-600 font-bold text-sm flex items-center">
            进入模块{' '}
            <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
          </span>
        </div>

        <div
          onClick={() => onNavigate('speaking_menu')}
          className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-blue-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
          <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-5">
            <MessageCircle className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">口语 (Speaking)</h2>
          <p className="text-slate-500 text-sm leading-relaxed mb-6">
            影子跟读与全真模拟面试。多维度流利度与发音诊断，重塑母语语感。
          </p>
          <span className="text-blue-600 font-bold text-sm flex items-center">
            进入模块{' '}
            <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
          </span>
        </div>

        <div className="bg-slate-50 p-8 rounded-3xl border border-slate-200 opacity-60 relative overflow-hidden cursor-not-allowed">
          <span className="absolute top-5 right-5 text-[10px] font-bold text-slate-500 bg-slate-200 px-2.5 py-1 rounded-full">
            Coming Soon
          </span>
          <div className="w-14 h-14 bg-slate-200 text-slate-400 rounded-2xl flex items-center justify-center mb-5">
            <BookOpen className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">阅读 (Reading)</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            长难句拆解与结构化阅读，快速定位核心考点，构建学术阅读逻辑。
          </p>
        </div>

        <div className="bg-slate-50 p-8 rounded-3xl border border-slate-200 opacity-60 relative overflow-hidden cursor-not-allowed">
          <span className="absolute top-5 right-5 text-[10px] font-bold text-slate-500 bg-slate-200 px-2.5 py-1 rounded-full">
            Coming Soon
          </span>
          <div className="w-14 h-14 bg-slate-200 text-slate-400 rounded-2xl flex items-center justify-center mb-5">
            <PenTool className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">写作 (Writing)</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            综合写作与独立写作批改。AI 逐句语法润色，高级替换与逻辑框架重构。
          </p>
        </div>
      </div>
    </div>
  );
}

export function SpeakingMenuModule({
  onNavigate,
  onBack
}: {
  onNavigate: (mode: string) => void;
  onBack: () => void;
  preloadStatus: PreloadStatus;
}) {
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-4xl w-full mb-8 flex items-center animate-in fade-in slide-in-from-top-4">
        <button
          onClick={onBack}
          className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-200 transition-all mr-4"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            口语训练
          </h1>
          <p className="text-slate-500 text-sm mt-1">Speaking Section</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
        <div
          onClick={() => onNavigate('shadow')}
          className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-indigo-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
          <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-6">
            <Headphones className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">
            Listen & Repeat
          </h2>
          <p className="text-slate-500 leading-relaxed mb-6">
            影子跟读模式。AI 自适应调节长短与词汇难度，托福词库加持，练就纯正口音与听力反射。
          </p>
          <span className="text-indigo-600 font-bold text-sm flex items-center">
            进入训练{' '}
            <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
          </span>
        </div>

        <div
          onClick={() => onNavigate('interview')}
          className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-blue-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-6">
            <UserCheck className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">
            Take an Interview
          </h2>
          <p className="text-slate-500 leading-relaxed mb-6">
            全真模拟面试。连续 4 题压迫式输出，精确计时监控，TOEFL 标准深度点评您的表达与时间把控。
          </p>
          <span className="text-blue-600 font-bold text-sm flex items-center">
            进入训练{' '}
            <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </div>
  );
}

export function ListeningMenuModule({
  onNavigate,
  onBack
}: {
  onNavigate: (mode: string) => void;
  onBack: () => void;
  preloadStatus: PreloadStatus;
}) {
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-4xl w-full mb-8 flex items-center animate-in fade-in slide-in-from-top-4">
        <button
          onClick={onBack}
          className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-200 text-slate-600 hover:text-emerald-600 hover:border-emerald-200 transition-all mr-4"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            听力训练
          </h1>
          <p className="text-slate-500 text-sm mt-1">Listening Section</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
        <div
          onClick={() => onNavigate('listening_practice')}
          className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-emerald-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mb-6">
            <Volume2 className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">
            听写快记 (Conversation)
          </h2>
          <p className="text-slate-500 leading-relaxed mb-6">
            运用黄金五维模板（人物/问题/原因/解决/下一步）进行高压盲听逻辑剥离训练。
          </p>
          <span className="text-emerald-600 font-bold text-sm flex items-center">
            进入训练{' '}
            <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
          </span>
        </div>

        <div
          onClick={() => onNavigate('listening_dictation')}
          className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-indigo-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
          <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-6">
            <PencilLine className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">
            文章听写 (Dictation)
          </h2>
          <p className="text-slate-500 leading-relaxed mb-6">
            全键盘丝滑盲听。针对词汇敏感度，除专有名词外全空缺填空，高效率纠正拼写与单复数错误。
          </p>
          <span className="text-indigo-600 font-bold text-sm flex items-center">
            进入训练{' '}
            <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </div>
  );
}
