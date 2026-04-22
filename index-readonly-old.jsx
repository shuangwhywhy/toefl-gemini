import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Square, Mic, Settings, Volume2, RotateCcw, ChevronRight, History, CheckCircle2, XCircle, RefreshCw, AlertCircle, Eye, EyeOff, Sparkles, Bot, BookOpen, Highlighter, MessageSquare, Headphones, UserCheck, ArrowLeft, Clock, Award, FileText, Check, ShieldCheck, Activity, ArrowRight, Image as ImageIcon, X, Send, Maximize2, Minimize2, Zap, Ear, PenTool, MessageCircle, PencilLine, Keyboard, Trash2, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';

// Gemini API Key (由运行环境提供)
const apiKey = "";

// ==========================================
// 全局模型与话题配置 
// ==========================================
const TEXT_MODEL = "gemini-2.5-flash-preview-09-2025";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

const TOEFL_TOPIC_POOL = [
    {
        level: "Beginner (Familiar/Daily Life/Campus - TOEFL Task 1 & Conversation Style)",
        themes: [
            "Study habits and time management", "Campus facilities and university policies", "Work-life balance",
            "Technology in daily communication", "Friendship and social activities", "Travel and cultural experiences",
            "Diet and healthy lifestyle", "Living on campus vs. off campus", "Online vs. In-person classes",
            "Extracurricular activities and clubs", "Part-time jobs and internships", "Public transportation",
            "Hobbies and stress relief", "Choosing a major or career path", "Dormitory life and roommates",
            "Peer pressure and academic competition", "Social media usage", "Learning a new language",
            "Local festivals and traditions", "Volunteering and community service"
        ]
    },
    {
        level: "Intermediate (Social/Abstract Concepts/Broad Issues)",
        themes: [
            "Environmental protection and daily choices", "Modern vs. traditional education methods", "The impact of remote work",
            "Consumerism and personal finance", "Art, culture, and government funding", "Media influence and critical thinking",
            "Global tourism and its effects", "The role of sports in communities", "Space exploration funding",
            "Automation and future jobs", "Urbanization and city development", "Fast fashion and sustainability",
            "Renewable energy adoption", "E-sports and modern entertainment", "Work ethic in different generations",
            "Changing family dynamics", "Artificial Intelligence in daily life", "Public health policies",
            "Preservation of historical buildings", "Privacy in the digital age"
        ]
    },
    {
        level: "Advanced (Academic/Scientific - TOEFL Task 3/4 & Lecture Style)",
        themes: [
            "Animal behavior and biological adaptation", "Cognitive biases and human psychology", "Business marketing strategies and consumer behavior",
            "Historical architectural techniques", "Ecological conservation and sustainability", "Evolution of transportation and urban planning",
            "Microbiology and daily applications", "Linguistics and language acquisition", "Astronomy and planetary science",
            "Geology and plate tectonics", "Oceanography and marine biology", "Botany and plant communication",
            "Behavioral economics", "Anthropology and ancient tools", "Neuroscience of memory and learning",
            "Genetics and hereditary traits", "Quantum physics basic concepts", "Art history movements (e.g. Impressionism)",
            "Industrial revolution impacts", "Climate change modeling"
        ]
    }
];

// === 全局音频缓存与 IndexedDB 封装 ===
const globalAudioCache = new Map();

const DBUtils = {
    dbName: 'ToeflAI_DB',
    storeName: 'app_state',
    db: null,
    init: async function () {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, 1);
            req.onupgradeneeded = e => {
                if (!e.target.result.objectStoreNames.contains(this.storeName)) {
                    e.target.result.createObjectStore(this.storeName);
                }
            };
            req.onsuccess = e => { this.db = e.target.result; resolve(this.db); };
            req.onerror = e => reject(e.target.error);
        });
    },
    get: async function (key, defaultVal) {
        try {
            await this.init();
            return new Promise(resolve => {
                const tx = this.db.transaction(this.storeName, 'readonly');
                const req = tx.objectStore(this.storeName).get(key);
                req.onsuccess = () => resolve(req.result !== undefined ? req.result : defaultVal);
                req.onerror = () => resolve(defaultVal);
            });
        } catch (e) { return defaultVal; }
    },
    set: async function (key, val) {
        try {
            await this.init();
            return new Promise(resolve => {
                const tx = this.db.transaction(this.storeName, 'readwrite');
                const req = tx.objectStore(this.storeName).put(val, key);
                req.onsuccess = () => resolve();
            });
        } catch (e) { }
    },
    remove: async function (key) {
        try {
            await this.init();
            return new Promise(resolve => {
                const tx = this.db.transaction(this.storeName, 'readwrite');
                const req = tx.objectStore(this.storeName).delete(key);
                req.onsuccess = () => resolve();
            });
        } catch (e) { }
    }
};

// ==========================================
// 终极原生 JSON 提取器
// ==========================================
const extractJSON = (rawText) => {
    if (!rawText) throw new Error("Empty API response");
    let text = rawText.trim();

    try { return JSON.parse(text); } catch (e) { }

    const backticks = String.fromCharCode(96, 96, 96);
    const blockRegex = new RegExp(backticks + '(?:json|javascript|js|html|md)?\\s*([\\s\\S]*?)\\s*' + backticks, 'ig');
    text = text.replace(blockRegex, '$1').trim();

    try { return JSON.parse(text); } catch (e) { }

    const startObj = text.indexOf('{');
    const endObj = text.lastIndexOf('}');
    const startArr = text.indexOf('[');
    const endArr = text.lastIndexOf(']');

    let objStr = startObj !== -1 && endObj > startObj ? text.substring(startObj, endObj + 1) : null;
    let arrStr = startArr !== -1 && endArr > startArr ? text.substring(startArr, endArr + 1) : null;

    if (objStr && arrStr) {
        if (startObj < startArr && endObj > endArr) arrStr = null;
        else if (startArr < startObj && endArr > endObj) objStr = null;
    }

    if (objStr) {
        try { return JSON.parse(objStr); } catch (e) {
            try { return JSON.parse(objStr.replace(/\n/g, '\\n').replace(/\r/g, '')); } catch (err) { }
        }
    }
    if (arrStr) {
        try { return JSON.parse(arrStr); } catch (e) {
            try { return JSON.parse(arrStr.replace(/\n/g, '\\n').replace(/\r/g, '')); } catch (err) { }
        }
    }

    throw new Error("JSON extraction algorithm failed");
};

// ==========================================
// 纯前端文本处理器：自动剥离普通单词并保留专有名词与标点
// ==========================================
const processDictationText = (rawText) => {
    const tokensRaw = rawText.match(/[a-zA-Z0-9'-]+|[^a-zA-Z0-9'\s-]/g) || [];
    let isStartOfSentence = true;

    return tokensRaw.map(token => {
        const isPunctuation = /^[^a-zA-Z0-9]+$/.test(token);
        const isNumber = /^\d+$/.test(token);
        const isCapitalized = /^[A-Z]/.test(token);

        let type = 'gap';

        if (isPunctuation) {
            type = 'shown';
            if (/^[.!?]+$/.test(token)) {
                isStartOfSentence = true;
            }
        } else if (isNumber) {
            type = 'shown';
            isStartOfSentence = false;
        } else {
            if (isCapitalized && !isStartOfSentence && token !== 'I') {
                type = 'shown';
            }
            isStartOfSentence = false;
        }

        return { word: token, type };
    });
};

// ==========================================
// 通用大模型调用与工具函数 (自愈容错流水线)
// ==========================================
const fetchGeminiText = async (promptOrParts, temperature = 0.9, maxOutputTokens = 1500, schema = null, signal = null, validator = null) => {
    let retries = 3;
    let delay = 1000;

    const parts = Array.isArray(promptOrParts) ? promptOrParts : [{ text: promptOrParts }];

    // 修复：系统级封口令，严禁将客套话填充到 JSON 值内
    const systemInstruction = {
        parts: [{ text: "You are a rigid backend API endpoint. You MUST output ONLY valid, raw JSON data. CRITICAL: NEVER include conversational filler (e.g., 'Here is the JSON', 'Sure') inside the JSON values. The JSON values must contain ONLY the requested content." }]
    };

    while (retries > 0) {
        try {
            const config = { temperature, maxOutputTokens, responseMimeType: "application/json" };
            if (schema) config.responseSchema = schema;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${apiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ systemInstruction, contents: [{ parts: parts }], generationConfig: config }),
                signal: signal
            });

            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            const result = await response.json();
            const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

            let parsedData;
            try {
                parsedData = extractJSON(rawText);
            } catch (parseError) {
                console.warn("High-temp JSON parsing failed, triggering zero-temp fixer...", parseError.message);
                const fixerPrompt = `Convert the following raw text into STRICT valid JSON. Do not change the core meaning, just fix formatting issues (trailing commas, unescaped quotes/newlines, etc).\n\nRAW TEXT:\n${rawText}`;

                const fixerConfig = { temperature: 0.0, maxOutputTokens, responseMimeType: "application/json" };
                if (schema) fixerConfig.responseSchema = schema;

                const fixerResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: fixerPrompt }] }], generationConfig: fixerConfig }),
                    signal: signal
                });

                if (!fixerResponse.ok) throw new Error(`Fixer API Error: ${fixerResponse.status}`);
                const fixerResult = await fixerResponse.json();
                const fixedText = fixerResult?.candidates?.[0]?.content?.parts?.[0]?.text;

                parsedData = extractJSON(fixedText);
            }

            if (validator) validator(parsedData);
            return parsedData;

        } catch (error) {
            if (signal && signal.aborted) throw error;

            retries--;
            if (retries === 0) throw error;
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
};

const pcmToWavUrl = (base64Data, sampleRate) => {
    const binaryString = atob(base64Data);
    const originalPcmBuffer = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) originalPcmBuffer[i] = binaryString.charCodeAt(i);
    const silenceDuration = 0.25; const numChannels = 1; const bitsPerSample = 16; const bytesPerSample = bitsPerSample / 8;
    const sampleRateInt = parseInt(sampleRate, 10);
    let silenceBytes = Math.floor(sampleRateInt * silenceDuration) * numChannels * bytesPerSample;
    if (silenceBytes % 2 !== 0) silenceBytes += 1;
    const pcmBuffer = new Uint8Array(silenceBytes + originalPcmBuffer.length);
    pcmBuffer.set(originalPcmBuffer, silenceBytes);
    const byteRate = sampleRateInt * numChannels * bytesPerSample;
    const blockAlign = numChannels * bytesPerSample; const dataSize = pcmBuffer.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize); const view = new DataView(buffer);
    const writeString = (offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };

    writeString(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeString(8, 'WAVE'); writeString(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRateInt, true); view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true); writeString(36, 'data'); view.setUint32(40, dataSize, true);
    new Uint8Array(buffer, 44).set(pcmBuffer);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
};

const fetchNeuralTTS = async (voiceName, textToSpeak, signal = null) => {
    const cacheKey = `tts_${voiceName}_${textToSpeak}`;
    if (globalAudioCache.has(cacheKey)) return globalAudioCache.get(cacheKey);

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: textToSpeak }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } } } } }),
            signal: signal
        });
        if (!response.ok) return null;
        const result = await response.json();
        const inlineData = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inlineData) {
            const mimeMatch = inlineData.mimeType.match(/rate=(\d+)/);
            const url = pcmToWavUrl(inlineData.data, mimeMatch ? parseInt(mimeMatch[1]) : 24000);
            globalAudioCache.set(cacheKey, url);
            return url;
        }
    } catch (error) { }
    return null;
};

// 支持多角色的对话语音生成引擎 (Native Multi-Speaker TTS)
const fetchConversationTTS = async (transcript, signal = null) => {
    const cacheKey = `tts_conversation_${transcript.substring(0, 50)}`;
    if (globalAudioCache.has(cacheKey)) return globalAudioCache.get(cacheKey);

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: transcript }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        multiSpeakerVoiceConfig: {
                            speakerVoiceConfigs: [
                                { speaker: "Student", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
                                { speaker: "Professor", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
                            ]
                        }
                    }
                }
            }),
            signal: signal
        });
        if (!response.ok) throw new Error(`TTS API Error: ${response.status}`);
        const result = await response.json();
        const inlineData = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inlineData) {
            const mimeMatch = inlineData.mimeType.match(/rate=(\d+)/);
            const url = pcmToWavUrl(inlineData.data, mimeMatch ? parseInt(mimeMatch[1]) : 24000);
            globalAudioCache.set(cacheKey, url);
            return url;
        }
        throw new Error("Empty audio data returned");
    } catch (error) {
        console.error("TTS Generator Error:", error);
        throw error;
    }
};

let sharedAudioCtx = null;
const playBeep = async (freq = 800, duration = 0.1) => {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!sharedAudioCtx) sharedAudioCtx = new AudioContext();
        if (sharedAudioCtx.state === 'suspended') await sharedAudioCtx.resume();

        const osc = sharedAudioCtx.createOscillator();
        const gain = sharedAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(sharedAudioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, sharedAudioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, sharedAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, sharedAudioCtx.currentTime + duration);
        osc.start(sharedAudioCtx.currentTime);
        osc.stop(sharedAudioCtx.currentTime + duration);
        return new Promise(resolve => setTimeout(resolve, duration * 1000));
    } catch (e) {
        console.warn("Beep error:", e);
        return Promise.resolve();
    }
};

// ==========================================
// 🚀 串行排队预载管线 (Sequential Preload)
// ==========================================
const PreloadPipeline = {
    queue: [],
    isProcessing: false,
    currentController: null,
    cache: { shadow: null, interview: null, listening: null, dictation: null },

    enqueue: function (taskName, executeFn) {
        this.queue = this.queue.filter(t => t.name !== taskName);
        this.queue.push({ name: taskName, fn: executeFn });
        this.process();
    },

    abortCurrent: function () {
        if (this.currentController) {
            this.currentController.abort();
            this.currentController = null;
        }
        this.queue = [];
    },

    process: async function () {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            this.currentController = new AbortController();
            try {
                console.log(`[Pipeline] 运行预载任务: ${task.name}`);
                await task.fn(this.currentController.signal);
            } catch (err) {
                if (err.name === 'AbortError') {
                    console.log(`[Pipeline] 任务被强行踢开 (Aborted): ${task.name}`);
                } else {
                    console.warn(`[Pipeline] 后台任务异常中断: ${task.name}`, err.message);
                }
            }
            this.currentController = null;
        }
        this.isProcessing = false;
    }
};

// === 修复：极小步长定性平滑难度映射表 ===
const getLengthDescription = (level) => {
    // 每个 Level 精确控制 2-3 个词的步长，绝对平滑，告别突变
    const descriptions = [
        "extremely short (around 5-7 words)",
        "very short (around 8-10 words)",
        "short (around 11-13 words)",
        "moderately short (around 14-16 words)",
        "medium length (around 17-19 words)",
        "average length (around 20-22 words)",
        "moderately long (around 23-26 words)",
        "long (around 27-30 words)",
        "very long (around 31-35 words)",
        "extremely long and complex (36+ words)"
    ];
    return descriptions[Math.max(0, Math.min(9, level - 1))];
};

const getDifficultyDescription = (level) => {
    const descriptions = [
        "extremely basic, beginner-level everyday words",
        "very simple, familiar daily vocabulary",
        "simple conversational words",
        "mostly simple words with one slightly less common term",
        "standard intermediate vocabulary typical of college students",
        "intermediate vocabulary with a touch of formal phrasing",
        "fairly advanced vocabulary including one academic word",
        "advanced, formal vocabulary with typical TOEFL-level academic terms",
        "highly advanced vocabulary with precise academic terminology",
        "expert-level, highly sophisticated and nuanced academic terminology"
    ];
    return descriptions[Math.max(0, Math.min(9, level - 1))];
};

const queueShadowPreload = (lengthLevel, learningFocus, difficultyLevel, voice) => {
    PreloadPipeline.enqueue('shadow_preload', async (signal) => {
        if (PreloadPipeline.cache.shadow) {
            const c = PreloadPipeline.cache.shadow;
            if (c.lengthLevel === lengthLevel && c.learningFocus === learningFocus && c.difficultyLevel === difficultyLevel) return;
        }

        try {
            const safeLengthLvl = parseInt(lengthLevel) || 3;
            const safeDiffLvl = parseInt(difficultyLevel) || 5;

            const lengthDesc = getLengthDescription(safeLengthLvl);
            const diffDesc = getDifficultyDescription(safeDiffLvl);

            // 修复：精简 Prompt，明确要求不要包含任何闲聊
            const prompt = `Act as an expert English teacher. Generate ONE complete English sentence.
      
      STRICT REQUIREMENTS:
      1. Length & Structure: The sentence should be ${lengthDesc}. (Never output short fragments).
      2. Topic: "${learningFocus}". Choose a specific TOEFL-style context (e.g., campus life, biology, history, etc.).
      3. Vocabulary: Use ${diffDesc}.
      
      CRITICAL INSTRUCTION: Output ONLY the actual English sentence as the value for the "sentence" key. DO NOT include any conversational filler like "Here is the sentence:" inside the JSON.`;

            const schema = {
                type: "OBJECT",
                properties: { sentence: { type: "STRING" } },
                required: ["sentence"]
            };

            // 修复：加入硬性标点符号校验与 AI 废话拦截验证器
            const validator = (d) => {
                if (!d || typeof d.sentence !== 'string') throw new Error("Invalid format");
                let txt = d.sentence.trim();
                if (txt.split(/\s+/).length < Math.max(4, safeLengthLvl + 2)) throw new Error("Sentence too short fragment");

                // 智能容错：LLM 输出短 JSON 时常遗漏句末标点，直接自动补全而不是报错重试
                if (!/[.!?]["']?$/.test(txt)) {
                    d.sentence = txt + ".";
                    txt = d.sentence;
                }

                if (/^(here is|here's|sure|certainly|the json|json requested)/i.test(txt)) throw new Error("Contains AI filler");
            };

            const data = await fetchGeminiText(prompt, 0.7, 400, schema, signal, validator);
            const sentence = data.sentence.trim();
            const audioUrl = await fetchNeuralTTS(voice, sentence, signal);

            PreloadPipeline.cache.shadow = { text: sentence, audioUrl, lengthLevel: safeLengthLvl, difficultyLevel: safeDiffLvl, learningFocus };
            window.dispatchEvent(new CustomEvent('preload-ready', { detail: { type: 'shadow' } }));
        } catch (err) {
            window.dispatchEvent(new CustomEvent('preload-error', { detail: { type: 'shadow' } }));
            throw err;
        }
    });
};

const queueInterviewPreload = (voice) => {
    PreloadPipeline.enqueue('interview_preload', async (signal) => {
        if (PreloadPipeline.cache.interview) return;

        try {
            const prompt = `Generate a 4-question TOEFL mock interview on a random specific topic. 
      Progression: Q1(Personal experience), Q2(Opinion/Choice), Q3(Broader social/campus impact), Q4(Complex trade-offs/Future prediction). 
      Return JSON: {"topic": "...", "questions": ["...", "...", "...", "..."]}`;

            const schema = {
                type: "OBJECT",
                properties: {
                    topic: { type: "STRING" },
                    questions: { type: "ARRAY", items: { type: "STRING" } }
                },
                required: ["topic", "questions"]
            };

            const data = await fetchGeminiText(prompt, 0.9, 800, schema, signal);
            if (!data || !Array.isArray(data.questions) || data.questions.length === 0) throw new Error("Invalid output format");

            const qsWithAudio = data.questions.map(q => ({ text: q, audioUrl: null }));
            qsWithAudio[0].audioUrl = await fetchNeuralTTS(voice, qsWithAudio[0].text, signal);

            PreloadPipeline.cache.interview = { topic: data.topic, questions: qsWithAudio };
            window.dispatchEvent(new CustomEvent('preload-ready', { detail: { type: 'interview' } }));
        } catch (err) {
            window.dispatchEvent(new CustomEvent('preload-error', { detail: { type: 'interview' } }));
            throw err;
        }
    });
};

const queueListeningPreload = () => {
    PreloadPipeline.enqueue('listening_preload', async (signal) => {
        if (PreloadPipeline.cache.listening) return;
        try {
            const prompt = `Generate a 180-250 word TOEFL campus conversation. Format exactly with 'Student:' and 'Professor:'.
      Topic: A random specific campus issue.
      Return JSON: {"topic": "...", "transcript": "...", "truth": {"who": "...", "problem": "...", "reason": "...", "solution": "...", "nextStep": "..."}}`;

            const schema = {
                type: "OBJECT",
                properties: {
                    topic: { type: "STRING" },
                    transcript: { type: "STRING" },
                    truth: {
                        type: "OBJECT",
                        properties: {
                            who: { type: "STRING" }, problem: { type: "STRING" }, reason: { type: "STRING" }, solution: { type: "STRING" }, nextStep: { type: "STRING" }
                        },
                        required: ["who", "problem", "reason", "solution", "nextStep"]
                    }
                },
                required: ["topic", "transcript", "truth"]
            };

            const data = await fetchGeminiText(prompt, 0.9, 2000, schema, signal);
            if (!data || !data.transcript) throw new Error("Invalid output format");

            const audioUrl = await fetchConversationTTS(data.transcript, signal);
            if (!audioUrl) throw new Error("Audio generation format failed");

            PreloadPipeline.cache.listening = { ...data, audioUrl };
            window.dispatchEvent(new CustomEvent('preload-ready', { detail: { type: 'listening' } }));
        } catch (err) {
            window.dispatchEvent(new CustomEvent('preload-error', { detail: { type: 'listening' } }));
            throw err;
        }
    });
};

const queueDictationPreload = () => {
    PreloadPipeline.enqueue('dictation_preload', async (signal) => {
        if (PreloadPipeline.cache.dictation) return;
        try {
            const prompt = `Generate an 80-100 word academic lecture passage on a random advanced topic (e.g. biology, history, astronomy). 
      Return JSON: {"topic": "...", "text": "..."}`;

            const schema = {
                type: "OBJECT",
                properties: {
                    topic: { type: "STRING" },
                    text: { type: "STRING" }
                },
                required: ["topic", "text"]
            };

            const data = await fetchGeminiText(prompt, 0.9, 2000, schema, signal);
            const tokens = processDictationText(data.text);
            const audioUrl = await fetchNeuralTTS("Charon", data.text, signal);
            if (!audioUrl) throw new Error("Audio generation failed");

            PreloadPipeline.cache.dictation = { ...data, tokens, audioUrl };
            window.dispatchEvent(new CustomEvent('preload-ready', { detail: { type: 'dictation' } }));
        } catch (err) {
            window.dispatchEvent(new CustomEvent('preload-error', { detail: { type: 'dictation' } }));
            throw err;
        }
    });
};

// ==========================================
// AI 私教互动系统 (多模态对话与记忆管理)
// ==========================================
function AITutorChat({ chatId, initialAdvice, contextText, title = "私教陪练", audioParts = [], isPrimary = false, extraHeaderElements = null }) {
    const [messages, setMessages] = useState([]);
    const [inputText, setInputText] = useState('');
    const [selectedImage, setSelectedImage] = useState(null);
    const [isTyping, setIsTyping] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    // 记忆开关与弹窗状态
    const [rememberHistory, setRememberHistory] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [visibleCount, setVisibleCount] = useState(15);

    const messagesEndRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const fileInputRef = useRef(null);
    const recognitionRef = useRef(null);
    const isUserScrollingRef = useRef(false);

    // 优化：更换为看起来更具亲和力和专业感的英语私教（外教）真人头像
    const AI_AVATAR_URL = "https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=150&q=80";

    // 初始化加载 DB 记录
    useEffect(() => {
        if (!chatId) return;
        const loadDB = async () => {
            const isMemOn = await DBUtils.get(`remember_${chatId}`, false);
            setRememberHistory(isMemOn);
            if (isMemOn) {
                const hist = await DBUtils.get(`chat_${chatId}`, []);
                setMessages(hist);
            }
        };
        loadDB();
    }, [chatId]);

    // 处理 initialAdvice，追加进队列并按需存 DB
    useEffect(() => {
        if (initialAdvice) {
            setMessages(prev => {
                if (prev.length > 0 && prev[prev.length - 1].text === initialAdvice) return prev;
                const newMsg = { id: Date.now(), role: 'model', text: initialAdvice };
                const next = [...prev, newMsg];
                if (rememberHistory) DBUtils.set(`chat_${chatId}`, next);
                return next;
            });
        }
    }, [initialAdvice, rememberHistory, chatId]);

    // 滚动分页加载：如果向上滚动到顶，加载更多
    const handleScroll = (e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.target;
        isUserScrollingRef.current = scrollHeight - scrollTop - clientHeight > 50;

        if (scrollTop === 0 && visibleCount < messages.length) {
            setVisibleCount(prev => prev + 15);
        }
    };

    const scrollToBottom = () => {
        if (!isUserScrollingRef.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    };
    useEffect(() => { scrollToBottom(); }, [messages, isTyping]);

    const handleToggleMemory = async () => {
        if (rememberHistory) {
            setShowConfirmModal(true); // 开启转关闭时，触发二次确认
        } else {
            setRememberHistory(true);
            await DBUtils.set(`remember_${chatId}`, true);
            await DBUtils.set(`chat_${chatId}`, messages);
        }
    };

    const confirmClearMemory = async () => {
        setRememberHistory(false);
        await DBUtils.set(`remember_${chatId}`, false);
        await DBUtils.remove(`chat_${chatId}`);
        // 仅保留当前的 advice
        const keepMsg = initialAdvice ? [{ id: Date.now(), role: 'model', text: initialAdvice }] : [];
        setMessages(keepMsg);
        setShowConfirmModal(false);
    };

    const toggleListen = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
        } else {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                setMessages(prev => [...prev, { id: Date.now(), role: 'model', text: "抱歉，您的浏览器不支持语音输入功能。" }]);
                return;
            }
            const recognition = new SpeechRecognition();
            recognition.lang = 'zh-CN';
            recognition.interimResults = false;
            recognition.onresult = (e) => {
                setInputText(prev => prev + e.results[0][0].transcript);
                setIsListening(false);
            };
            recognition.onerror = () => setIsListening(false);
            recognition.onend = () => setIsListening(false);
            recognitionRef.current = recognition;
            recognition.start();
            setIsListening(true);
        }
    };

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setSelectedImage(reader.result);
            reader.readAsDataURL(file);
        }
    };

    const handleSend = async () => {
        if (!inputText.trim() && !selectedImage) return;

        const newUserMsg = { id: Date.now(), role: 'user', text: inputText, image: selectedImage };
        const updatedMessages = [...messages, newUserMsg];
        setMessages(updatedMessages);
        if (rememberHistory) DBUtils.set(`chat_${chatId}`, updatedMessages);

        setInputText('');
        setSelectedImage(null);
        setIsTyping(true);
        isUserScrollingRef.current = false; // 发送消息时强制滚动到底部

        try {
            const chatHistory = updatedMessages.map((msg, index) => {
                const parts = [];
                if (msg.text) parts.push({ text: msg.text });
                if (msg.image) {
                    const base64Data = msg.image.split(',')[1];
                    const mimeType = msg.image.split(';')[0].split(':')[1];
                    parts.push({ inlineData: { mimeType, data: base64Data } });
                }

                if (index === updatedMessages.length - 1 && audioParts.length > 0) {
                    audioParts.forEach(ap => {
                        parts.push({ inlineData: { mimeType: ap.mimeType, data: ap.data } });
                    });
                }

                return { role: msg.role === 'model' ? 'model' : 'user', parts };
            });

            const systemInstruction = {
                parts: [{
                    text: `你是一位专业的 TOEFL 英语口语/听力私教陪练。
请用中文回复。结合学生当前所有的数据维度进行高度个性化的点评和指导。
【核心指令】如果用户提问涉及到发音或语调，请解析附带的用户原始录音音频进行作答。
当前学生正在练习的上下文数据: "${contextText}"`
                }]
            };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction,
                    contents: chatHistory,
                    generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
                })
            });

            if (!response.ok) throw new Error("API Error");
            const result = await response.json();
            const replyText = result.candidates?.[0]?.content?.parts?.[0]?.text || "抱歉，我没太明白您的意思。";

            const newModelMsg = { id: Date.now(), role: 'model', text: replyText };
            const finalMessages = [...updatedMessages, newModelMsg];
            setMessages(finalMessages);
            if (rememberHistory) DBUtils.set(`chat_${chatId}`, finalMessages);

        } catch (error) {
            setMessages(prev => [...prev, { id: Date.now(), role: 'model', text: "网络异常，无法获取回复。" }]);
        } finally {
            setIsTyping(false);
        }
    };

    // 强化的富文本 Markdown 解析器，专门用于放大重点并增加背景高亮色
    const parseMarkdown = (text, isUser) => {
        if (!text) return { __html: '' };
        let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // 标题强化：带底边框
        html = html.replace(/^### (.*$)/gim, `<h3 class="font-bold text-base mt-3 mb-1 ${isUser ? 'text-white' : 'text-indigo-900'}">$1</h3>`);
        html = html.replace(/^## (.*$)/gim, `<h2 class="font-bold text-lg mt-4 mb-2 pb-1 border-b ${isUser ? 'border-white/30 text-white' : 'border-indigo-100 text-indigo-900'}">$1</h2>`);
        html = html.replace(/^# (.*$)/gim, `<h1 class="font-black text-xl mt-4 mb-2 pb-1 border-b ${isUser ? 'border-white/30 text-white' : 'border-indigo-100 text-indigo-900'}">$1</h1>`);

        // 重点加粗强化：浅色背景块包裹
        html = html.replace(/\*\*(.*?)\*\*/g, `<strong class="font-black ${isUser ? 'text-white' : 'text-indigo-800 bg-indigo-50 px-1 rounded shadow-sm'}">$1</strong>`);
        html = html.replace(/\*(.*?)\*/g, `<em class="italic font-medium ${isUser ? 'text-white/90' : 'text-indigo-700'}">$1</em>`);

        // 代码段
        html = html.replace(/`(.*?)`/g, `<code class="px-1.5 py-0.5 rounded font-mono text-[0.9em] shadow-sm border ${isUser ? 'bg-white/20 border-white/30 text-white' : 'bg-slate-50 border-slate-200 text-indigo-600'}">$1</code>`);

        // 列表项强化
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
                    {/* 渲染外部传入的额外头部元素（如历史收缩按钮） */}
                    {extraHeaderElements}

                    <div className="flex items-center space-x-1.5 cursor-pointer group" onClick={handleToggleMemory}>
                        <span className={`text-xs font-bold transition-colors ${rememberHistory ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`}>记忆对话</span>
                        {rememberHistory ? <ToggleRight className="w-5 h-5 text-indigo-600" /> : <ToggleLeft className="w-5 h-5 text-slate-400" />}
                    </div>
                    <div className="w-px h-4 bg-slate-200"></div>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="text-slate-400 hover:text-indigo-600 transition-colors"
                        title={isExpanded ? "缩小" : "全屏放大"}
                    >
                        {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={scrollContainerRef} onScroll={handleScroll}>
                {messages.length > visibleCount && <div className="text-center text-xs text-slate-400 py-2">上滑加载更多...</div>}

                {displayMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'model' && <img src={AI_AVATAR_URL} alt="Tutor" className="w-8 h-8 rounded-full object-cover mr-3 shrink-0 shadow-sm border border-indigo-100" />}
                        <div className={`max-w-[85%] rounded-2xl p-4 ${isPrimary ? 'text-[15px]' : 'text-sm'} leading-[1.6] shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-white border border-indigo-50 text-slate-700 rounded-tl-sm'}`}>
                            {msg.image && <img src={msg.image} alt="upload" className="w-full max-h-40 object-cover rounded-lg mb-3 shadow-sm border border-slate-100" />}
                            <div dangerouslySetInnerHTML={parseMarkdown(msg.text, msg.role === 'user')} className="break-words space-y-1.5" />
                        </div>
                    </div>
                ))}
                {isTyping && (
                    <div className="flex justify-start">
                        <img src={AI_AVATAR_URL} alt="Tutor" className="w-8 h-8 rounded-full object-cover mr-3 shrink-0 shadow-sm border border-indigo-100" />
                        <div className="bg-white border border-indigo-50 text-slate-500 rounded-2xl rounded-tl-sm p-4 flex items-center space-x-1.5 shadow-sm h-12">
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-slate-200 bg-white shrink-0">
                {selectedImage && (
                    <div className="relative inline-block mb-3 ml-2">
                        <img src={selectedImage} alt="preview" className="h-14 w-14 object-cover rounded-lg border border-slate-200 shadow-sm" />
                        <button onClick={() => setSelectedImage(null)} className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-1 shadow-md hover:scale-110 transition-transform"><X size={12} /></button>
                    </div>
                )}
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all shadow-sm">
                    <input
                        type="text"
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                        placeholder="随时向私教提问 (支持图文与语音)..."
                        className={`flex-1 bg-transparent ${isPrimary ? 'text-base' : 'text-sm'} outline-none min-w-0 text-slate-700 placeholder-slate-400 font-medium`}
                    />

                    <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleImageChange} />

                    <button onClick={() => fileInputRef.current?.click()} className="text-slate-400 hover:text-indigo-600 transition-colors p-1.5 rounded-full hover:bg-slate-100" title="上传截图">
                        <ImageIcon size={18} />
                    </button>

                    <button onClick={toggleListen} className={`${isListening ? 'text-rose-500 animate-pulse bg-rose-50' : 'text-slate-400 hover:text-indigo-600 hover:bg-slate-100'} transition-colors p-1.5 rounded-full`} title="语音输入">
                        <Mic size={18} />
                    </button>

                    <div className="w-px h-5 bg-slate-200 mx-1"></div>

                    <button onClick={handleSend} disabled={!inputText.trim() && !selectedImage} className="text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed p-2 rounded-full shadow-sm transition-transform active:scale-95">
                        <Send size={16} className="-ml-0.5" />
                    </button>
                </div>
            </div>

            {/* 自定义二次确认弹窗：关闭记忆 */}
            {showConfirmModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full text-center animate-in zoom-in-95 duration-200">
                        <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertTriangle className="w-6 h-6" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 mb-2">关闭对话记忆？</h3>
                        <p className="text-sm text-slate-500 leading-relaxed mb-6">关闭记忆功能将会立刻<strong className="text-rose-500">永久清空</strong>当前模块的所有历史提问和评价记录，且无法恢复。是否继续？</p>
                        <div className="flex space-x-3">
                            <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-2.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">取消</button>
                            <button onClick={confirmClearMemory} className="flex-1 py-2.5 rounded-xl font-bold text-white bg-rose-500 hover:bg-rose-600 shadow-md shadow-rose-200 transition-colors">确认清空</button>
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

    return (
        <div className="h-full w-full bg-transparent">
            {chatContent}
        </div>
    );
}

// ==========================================
// 模块：设备授权与检测前置页
// ==========================================
function DeviceSetupModule({ onComplete }) {
    const [speakerStatus, setSpeakerStatus] = useState('idle');
    const [micStatus, setMicStatus] = useState('idle');
    const [micVolume, setMicVolume] = useState(0);
    const audioContextRef = useRef(null);
    const animationFrameRef = useRef(null);
    const streamRef = useRef(null);

    useEffect(() => {
        const autoCheckMic = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const hasGrantedMic = devices.some(d => d.kind === 'audioinput' && !!d.label);
                if (hasGrantedMic) {
                    setMicStatus('passed');
                    return;
                }
                if (navigator.permissions && navigator.permissions.query) {
                    const perm = await navigator.permissions.query({ name: 'microphone' });
                    if (perm.state === 'granted') {
                        setMicStatus('passed');
                    }
                }
            } catch (err) {
                console.warn("自动检测麦克风权限失败", err);
            }
        };
        autoCheckMic();
    }, []);

    useEffect(() => {
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const handleTestSpeaker = () => {
        setSpeakerStatus('testing');
        const u = new SpeechSynthesisUtterance("Welcome to the AI TOEFL training system.");
        u.lang = 'en-US';
        u.onend = () => setSpeakerStatus('passed');
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        setTimeout(() => { if (speakerStatus !== 'passed') setSpeakerStatus('passed'); }, 3000);
    };

    const handleTestMic = async () => {
        setMicStatus('requesting');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContextRef.current = new AudioContext();
            const analyser = audioContextRef.current.createAnalyser();
            const microphone = audioContextRef.current.createMediaStreamSource(stream);
            microphone.connect(analyser);
            analyser.fftSize = 256;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            setMicStatus('listening');
            let soundDetectedCount = 0;
            let frameCount = 0;

            const updateVolume = () => {
                if (!audioContextRef.current) return;
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                const average = sum / dataArray.length;
                const volume = Math.min(100, Math.max(0, average * 2.5));
                setMicVolume(volume);

                frameCount++;
                if (frameCount > 30 && volume > 30) soundDetectedCount++;

                if (soundDetectedCount > 20) {
                    setMicStatus('passed');
                    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
                    if (streamRef.current) {
                        streamRef.current.getTracks().forEach(track => track.stop());
                        streamRef.current = null;
                    }
                } else {
                    animationFrameRef.current = requestAnimationFrame(updateVolume);
                }
            };
            updateVolume();
        } catch (err) {
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
                    <h1 className="text-3xl font-black text-slate-800 tracking-tight mb-2">环境准备与授权</h1>
                    <p className="text-slate-500">确保您的音响和麦克风正常可用</p>
                </div>

                <div className="space-y-4 mb-10">
                    <div className={`p-5 rounded-2xl border transition-all flex items-center justify-between ${speakerStatus === 'passed' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                        <div className="flex items-center space-x-4">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${speakerStatus === 'passed' ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-slate-500 shadow-sm border border-slate-200'}`}>
                                <Volume2 className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800">1. 播放设备</h3>
                                <p className="text-[10px] text-slate-400">点击按钮播放测试音</p>
                            </div>
                        </div>
                        <div className="w-28 shrink-0 flex justify-end">
                            {speakerStatus === 'passed' ? (
                                <span className="flex justify-center items-center text-emerald-600 font-bold w-full py-2 bg-white rounded-full shadow-sm text-xs"><Check className="w-3 h-3 mr-1" /> 已就绪</span>
                            ) : speakerStatus === 'testing' ? (
                                <button disabled className="w-full py-2 bg-indigo-200 text-indigo-700 rounded-full font-bold text-xs flex items-center justify-center"><RefreshCw className="w-3 h-3 animate-spin mr-1" /> 播放中</button>
                            ) : (
                                <button onClick={handleTestSpeaker} className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-bold text-xs shadow-md transition-colors flex justify-center items-center">测试声音</button>
                            )}
                        </div>
                    </div>

                    <div className={`p-5 rounded-2xl border transition-all flex items-center justify-between ${micStatus === 'passed' ? 'bg-emerald-50 border-emerald-200' : micStatus === 'error' ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                        <div className="flex items-center space-x-4">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${micStatus === 'passed' ? 'bg-emerald-100 text-emerald-600' : micStatus === 'error' ? 'bg-red-100 text-red-600' : 'bg-white text-slate-500 shadow-sm border border-slate-200'}`}>
                                <Mic className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800">2. 录音设备</h3>
                                <p className="text-[10px] text-slate-400">授权并大声说两句</p>
                            </div>
                        </div>
                        <div className="w-28 shrink-0 flex justify-end">
                            {micStatus === 'passed' ? (
                                <span className="flex justify-center items-center text-emerald-600 font-bold w-full py-2 bg-white rounded-full shadow-sm text-xs"><Check className="w-3 h-3 mr-1" /> 已通过</span>
                            ) : micStatus === 'requesting' ? (
                                <button disabled className="w-full py-2 bg-indigo-200 text-indigo-700 rounded-full font-bold text-xs flex items-center justify-center"><RefreshCw className="w-3 h-3 animate-spin mr-1" /> 请求中</button>
                            ) : micStatus === 'listening' ? (
                                <div className="flex flex-col items-center w-full">
                                    <div className="flex space-x-0.5 h-4 items-end w-full justify-center">
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <div key={i} className="w-2 bg-indigo-400 rounded-t-sm transition-all duration-75" style={{ height: `${Math.max(20, Math.min(100, micVolume * (Math.random() * 0.5 + 0.5)))}%` }}></div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <button onClick={handleTestMic} className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-bold text-xs shadow-md transition-colors flex justify-center items-center">授权测试</button>
                            )}
                        </div>
                    </div>
                    {micStatus === 'error' && <p className="text-[10px] text-red-500 font-medium px-4">麦克风访问被拒绝，请点击浏览器地址栏锁图标允许权限后重试。</p>}
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

// ==========================================
// 菜单导航模块 (Menus)
// ==========================================
function MainMenuModule({ onNavigate }) {
    return (
        <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 font-sans">
            <div className="max-w-4xl w-full text-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h1 className="text-4xl font-black text-slate-800 tracking-tight mb-4">AI 新托福全科训练</h1>
                <p className="text-slate-500 text-lg">全真题库，多模态 AI 深度评测，从输入到输出全面提升。</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full">
                <div
                    onClick={() => onNavigate('listening_menu')}
                    className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-emerald-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                    <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mb-5"><Ear className="w-7 h-7" /></div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">听力 (Listening)</h2>
                    <p className="text-slate-500 text-sm leading-relaxed mb-6">全真讲座与对话听写，精听泛听结合，攻克生词与复杂长难句。</p>
                    <span className="text-emerald-600 font-bold text-sm flex items-center">进入模块 <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" /></span>
                </div>

                <div
                    onClick={() => onNavigate('speaking_menu')}
                    className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-blue-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                    <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-5"><MessageCircle className="w-7 h-7" /></div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">口语 (Speaking)</h2>
                    <p className="text-slate-500 text-sm leading-relaxed mb-6">影子跟读与全真模拟面试。多维度流利度与发音诊断，重塑母语语感。</p>
                    <span className="text-blue-600 font-bold text-sm flex items-center">进入模块 <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" /></span>
                </div>

                <div className="bg-slate-50 p-8 rounded-3xl border border-slate-200 opacity-60 relative overflow-hidden cursor-not-allowed">
                    <span className="absolute top-5 right-5 text-[10px] font-bold text-slate-500 bg-slate-200 px-2.5 py-1 rounded-full">Coming Soon</span>
                    <div className="w-14 h-14 bg-slate-200 text-slate-400 rounded-2xl flex items-center justify-center mb-5"><BookOpen className="w-7 h-7" /></div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">阅读 (Reading)</h2>
                    <p className="text-slate-500 text-sm leading-relaxed">长难句拆解与结构化阅读，快速定位核心考点，构建学术阅读逻辑。</p>
                </div>

                <div className="bg-slate-50 p-8 rounded-3xl border border-slate-200 opacity-60 relative overflow-hidden cursor-not-allowed">
                    <span className="absolute top-5 right-5 text-[10px] font-bold text-slate-500 bg-slate-200 px-2.5 py-1 rounded-full">Coming Soon</span>
                    <div className="w-14 h-14 bg-slate-200 text-slate-400 rounded-2xl flex items-center justify-center mb-5"><PenTool className="w-7 h-7" /></div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">写作 (Writing)</h2>
                    <p className="text-slate-500 text-sm leading-relaxed">综合写作与独立写作批改。AI 逐句语法润色，高级替换与逻辑框架重构。</p>
                </div>
            </div>
        </div>
    );
}

function SpeakingMenuModule({ onNavigate, onBack, preloadStatus }) {
    return (
        <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 font-sans">
            <div className="max-w-4xl w-full mb-8 flex items-center animate-in fade-in slide-in-from-top-4">
                <button onClick={onBack} className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-200 transition-all mr-4">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                    <h1 className="text-3xl font-black text-slate-800 tracking-tight">口语训练</h1>
                    <p className="text-slate-500 text-sm mt-1">Speaking Section</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
                <div
                    onClick={() => onNavigate('shadow')}
                    className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-indigo-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
                >
                    {preloadStatus.shadow ? (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center">✨ 资源已就绪</span>
                    ) : preloadStatus.shadowError ? (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-rose-500 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full flex items-center"><XCircle className="w-3 h-3 mr-1" /> 预载失败，可随时点击</span>
                    ) : (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full flex items-center"><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> 预载中...</span>
                    )}

                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                    <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-6"><Headphones className="w-8 h-8" /></div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-3">Listen & Repeat</h2>
                    <p className="text-slate-500 leading-relaxed mb-6">影子跟读模式。AI 自适应调节长短与词汇难度，托福词库加持，练就纯正口音与听力反射。</p>
                    <span className="text-indigo-600 font-bold text-sm flex items-center">进入训练 <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" /></span>
                </div>

                <div
                    onClick={() => onNavigate('interview')}
                    className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-blue-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
                >
                    {preloadStatus.interview ? (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full flex items-center">✨ 考卷已就绪</span>
                    ) : preloadStatus.interviewError ? (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-rose-500 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full flex items-center"><XCircle className="w-3 h-3 mr-1" /> 预载失败，可随时点击</span>
                    ) : (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full flex items-center"><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> 预载中...</span>
                    )}

                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-6"><UserCheck className="w-8 h-8" /></div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-3">Take an Interview</h2>
                    <p className="text-slate-500 leading-relaxed mb-6">全真模拟面试。连续 4 题压迫式输出，精确计时监控，TOEFL 标准深度点评您的表达与时间把控。</p>
                    <span className="text-blue-600 font-bold text-sm flex items-center">进入训练 <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" /></span>
                </div>
            </div>
        </div>
    );
}

function ListeningMenuModule({ onNavigate, onBack, preloadStatus }) {
    return (
        <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 font-sans">
            <div className="max-w-4xl w-full mb-8 flex items-center animate-in fade-in slide-in-from-top-4">
                <button onClick={onBack} className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-200 text-slate-600 hover:text-emerald-600 hover:border-emerald-200 transition-all mr-4">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                    <h1 className="text-3xl font-black text-slate-800 tracking-tight">听力训练</h1>
                    <p className="text-slate-500 text-sm mt-1">Listening Section</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
                <div
                    onClick={() => onNavigate('listening_practice')}
                    className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-emerald-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
                >
                    {preloadStatus?.listening ? (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center">✨ 逻辑快记已就绪</span>
                    ) : preloadStatus?.listeningError ? (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-rose-500 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full flex items-center"><XCircle className="w-3 h-3 mr-1" /> 预载失败</span>
                    ) : (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full flex items-center"><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> 预载中...</span>
                    )}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mb-6"><Volume2 className="w-8 h-8" /></div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-3">听写快记 (Conversation)</h2>
                    <p className="text-slate-500 leading-relaxed mb-6">运用黄金五维模板（人物/问题/原因/解决/下一步）进行高压盲听逻辑剥离训练。</p>
                    <span className="text-emerald-600 font-bold text-sm flex items-center">进入训练 <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" /></span>
                </div>

                <div
                    onClick={() => onNavigate('listening_dictation')}
                    className="group bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl hover:border-indigo-300 transition-all cursor-pointer transform hover:-translate-y-1 relative overflow-hidden"
                >
                    {preloadStatus?.dictation ? (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full flex items-center">✨ 听写已就绪</span>
                    ) : preloadStatus?.dictationError ? (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-rose-500 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full flex items-center"><XCircle className="w-3 h-3 mr-1" /> 预载失败</span>
                    ) : (
                        <span className="absolute top-5 right-5 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full flex items-center"><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> 预载中...</span>
                    )}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                    <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-6"><PencilLine className="w-8 h-8" /></div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-3">文章听写 (Dictation)</h2>
                    <p className="text-slate-500 leading-relaxed mb-6">全键盘丝滑盲听。针对词汇敏感度，除专有名词外全空缺填空，高效率纠正拼写与单复数错误。</p>
                    <span className="text-indigo-600 font-bold text-sm flex items-center">进入训练 <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" /></span>
                </div>
            </div>
        </div>
    );
}

// ==========================================
// 核心模块：文章听写 (Article Dictation)
// ==========================================
function ListeningDictationModule({ onBack }) {
    const [status, setStatus] = useState('setup');
    const [data, setData] = useState(null);
    const [userInputs, setUserInputs] = useState([]);
    const [isEvaluated, setIsEvaluated] = useState(false);
    const [apiError, setApiError] = useState('');

    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const audioRef = useRef(null);
    const inputRefs = useRef([]);

    useEffect(() => {
        if (status === 'setup') {
            if (PreloadPipeline.cache.dictation) {
                initSession(PreloadPipeline.cache.dictation);
                PreloadPipeline.cache.dictation = null;
            } else {
                generateDictation();
            }
        }
    }, [status]);

    const initSession = (dictationData) => {
        setData(dictationData);
        const gaps = dictationData.tokens.filter(t => t.type === 'gap');
        setUserInputs(new Array(gaps.length).fill(''));
        setIsEvaluated(false);
        setStatus('practicing');
    };

    const generateDictation = async () => {
        PreloadPipeline.abortCurrent();
        setStatus('generating');
        setApiError('');
        try {
            const prompt = `Generate an 80-100 word academic lecture passage on a random advanced topic (e.g. biology, history, astronomy). 
      Return JSON: {"topic": "...", "text": "..."}`;

            const schema = {
                type: "OBJECT",
                properties: {
                    topic: { type: "STRING" },
                    text: { type: "STRING" }
                },
                required: ["topic", "text"]
            };

            const result = await fetchGeminiText(prompt, 0.9, 2000, schema);
            const tokens = processDictationText(result.text);
            const audio = await fetchNeuralTTS("Charon", result.text);
            initSession({ ...result, tokens, audioUrl: audio });
        } catch (e) {
            setApiError("生成内容失败，请检查网络后重试。");
            setStatus('setup');
        }
    };

    const handleInputChange = (val, gapIdx) => {
        const nextInputs = [...userInputs];
        nextInputs[gapIdx] = val;
        setUserInputs(nextInputs);
    };

    const focusNext = (currentGapIdx) => {
        if (currentGapIdx < userInputs.length - 1) {
            inputRefs.current[currentGapIdx + 1]?.focus();
        }
    };

    const focusPrev = (currentGapIdx) => {
        if (currentGapIdx > 0) {
            inputRefs.current[currentGapIdx - 1]?.focus();
        }
    };

    const handleKeyDown = (e, gapIdx) => {
        if (e.key === ' ' || e.key === 'Tab') {
            e.preventDefault();
            focusNext(gapIdx);
        } else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length) {
            focusNext(gapIdx);
        } else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) {
            focusPrev(gapIdx);
        }
    };

    const handleTimeUpdate = () => {
        if (audioRef.current && audioRef.current.duration) {
            setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
        }
    };

    const checkResults = () => {
        setIsEvaluated(true);
        if (audioRef.current) audioRef.current.pause();
        setIsPlaying(false);
    };

    const toggleAudio = () => {
        if (audioRef.current) {
            if (isPlaying) audioRef.current.pause();
            else audioRef.current.play();
            setIsPlaying(!isPlaying);
        }
    };

    let gapCounter = 0;
    const tokensWithGapIdx = data?.tokens.map(t => {
        if (t.type === 'gap') {
            return { ...t, gapIdx: gapCounter++ };
        }
        return t;
    });

    const getScore = () => {
        if (!data) return 0;
        const gaps = data.tokens.filter(t => t.type === 'gap');
        let correct = 0;
        gaps.forEach((g, i) => {
            if (userInputs[i].trim().toLowerCase() === g.word.toLowerCase()) correct++;
        });
        return Math.round((correct / gaps.length) * 100);
    };

    return (
        <div className="bg-slate-50 min-h-[calc(100vh-64px)] p-6 font-sans">
            {data && <audio ref={audioRef} src={data.audioUrl} onEnded={() => setIsPlaying(false)} onTimeUpdate={handleTimeUpdate} className="hidden" />}

            <div className="max-w-5xl mx-auto space-y-6">
                <header className="flex items-center justify-between pb-4 border-b">
                    <div className="flex items-center space-x-3 cursor-pointer" onClick={onBack}>
                        <div className="bg-white p-2 rounded-lg shadow-sm text-slate-600"><ArrowLeft className="w-5 h-5" /></div>
                        <div><h1 className="text-xl font-bold text-slate-800">文章听写 (Article Dictation)</h1><p className="text-slate-500 text-xs">专注拼写准确度与听力连贯性</p></div>
                    </div>
                    {status === 'practicing' && (
                        <div className="flex items-center space-x-4">
                            <div className="text-[10px] text-slate-400 flex items-center bg-white px-2 py-1 rounded-full border border-slate-100 shadow-sm">
                                <Keyboard className="w-3 h-3 mr-1" /> 空格/Tab: 下一格 | 方向键: 快速跳转
                            </div>
                            <button onClick={isEvaluated ? () => setStatus('setup') : checkResults} className={`px-5 py-2 rounded-full font-bold text-sm shadow-sm transition-all ${isEvaluated ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                                {isEvaluated ? "再练一篇" : "完成校验"}
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

                {status === 'practicing' && data && (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        <div className="lg:col-span-3 space-y-6">
                            <div className="bg-white rounded-2xl shadow-sm border p-6 flex items-center space-x-5">
                                <button onClick={toggleAudio} className="w-16 h-16 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shrink-0 transition-all shadow-lg hover:scale-105 active:scale-95">
                                    {isPlaying ? <Pause className="w-8 h-8 fill-white" /> : <Play className="w-8 h-8 fill-white ml-1" />}
                                </button>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-sm font-bold text-slate-700 flex items-center">
                                            <Volume2 className="w-4 h-4 mr-1 text-indigo-500" /> Dictation Audio
                                        </span>
                                        <span className="text-[10px] text-indigo-600 font-bold px-2 py-0.5 bg-indigo-50 rounded uppercase">{data.topic}</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden w-full relative">
                                        <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 min-h-[400px]">
                                <div className="leading-[3rem] text-justify">
                                    {tokensWithGapIdx.map((token, idx) => {
                                        const isPunctuation = /^[^a-zA-Z0-9]+$/.test(token.word);
                                        const spacing = isPunctuation ? "" : " ml-2";

                                        if (token.type === 'shown') {
                                            return <span key={idx} className={`text-lg font-medium text-slate-800 ${spacing}`}>{token.word}</span>;
                                        } else {
                                            const isCorrect = userInputs[token.gapIdx].trim().toLowerCase() === token.word.toLowerCase();

                                            return (
                                                <span key={idx} className={`relative inline-block ${spacing}`}>
                                                    <input
                                                        ref={el => inputRefs.current[token.gapIdx] = el}
                                                        type="text"
                                                        value={userInputs[token.gapIdx]}
                                                        onChange={(e) => handleInputChange(e.target.value, token.gapIdx)}
                                                        onKeyDown={(e) => handleKeyDown(e, token.gapIdx)}
                                                        disabled={isEvaluated}
                                                        style={{ width: `${Math.max(3, token.word.length * 1.15)}ch` }}
                                                        className={`h-8 px-1 text-center text-base font-bold border-b-2 bg-transparent outline-none transition-all
                              ${isEvaluated
                                                                ? (isCorrect ? 'border-emerald-500 text-emerald-600' : 'border-rose-500 text-rose-600 bg-rose-50/50')
                                                                : 'border-indigo-200 hover:border-indigo-400 focus:border-indigo-600 focus:bg-indigo-50/30'
                                                            }
                            `}
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
                                        }
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
                                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">完成得分</h3>
                                    <div className="text-4xl font-black text-slate-800 mb-4">{getScore()}<span className="text-lg">/100</span></div>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        学术词汇对于托福听写至关重要。拼写错误不仅影响听力，更会直接影响写作分数。
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-6">
                                    <h3 className="text-indigo-900 font-bold text-sm mb-4 flex items-center"><Sparkles className="w-4 h-4 mr-1" /> 训练要点</h3>
                                    <ul className="text-xs text-indigo-700 space-y-3">
                                        <li className="flex items-start"><Check className="w-3 h-3 mr-2 mt-0.5 shrink-0" /> 优先完整拼出核心动词。</li>
                                        <li className="flex items-start"><Check className="w-3 h-3 mr-2 mt-0.5 shrink-0" /> 注意名词单复数结尾 -s。</li>
                                        <li className="flex items-start"><Check className="w-3 h-3 mr-2 mt-0.5 shrink-0" /> 利用空格键快速进入下一词。</li>
                                    </ul>
                                </div>
                            )}

                            <div className="bg-white rounded-2xl shadow-sm border h-[400px] overflow-hidden relative">
                                <AITutorChat
                                    chatId="dictation_chat"
                                    key={data.text}
                                    title="词汇与拼写助教"
                                    initialAdvice={isEvaluated ? `这篇听力中有一些容易拼错的单词，比如：${data.tokens.filter(t => t.word.length > 7 && t.type === 'gap').slice(0, 2).map(t => t.word).join(', ')}。你对哪个单词的发音或拼写规则有疑问？` : "正在等待您开始听写。您可以随时向我提问关于听力细节的问题。"}
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

// ==========================================
// 核心练习模块
// ==========================================
function ListeningPracticeModule({ onBack }) {
    const [status, setStatus] = useState('setup');
    const [conversationData, setConversationData] = useState(null);
    const [notes, setNotes] = useState({ who: '', problem: '', reason: '', solution: '', nextStep: '' });
    const [evaluation, setEvaluation] = useState(null);
    const [apiError, setApiError] = useState('');

    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const audioRef = useRef(null);

    useEffect(() => {
        if (status === 'setup') {
            if (PreloadPipeline.cache.listening) {
                setConversationData(PreloadPipeline.cache.listening);
                PreloadPipeline.cache.listening = null;
                setNotes({ who: '', problem: '', reason: '', solution: '', nextStep: '' });
                setStatus('ready');
            } else {
                generateConversation();
            }
        }
    }, [status]);

    const generateConversation = async () => {
        PreloadPipeline.abortCurrent();
        setStatus('generating');
        setApiError('');
        try {
            const prompt = `Generate a 180-250 word TOEFL campus conversation. Format exactly with 'Student:' and 'Professor:'.
      Topic: A random specific campus issue.
      Return JSON: {"topic": "...", "transcript": "...", "truth": {"who": "...", "problem": "...", "reason": "...", "solution": "...", "nextStep": "..."}}`;

            const schema = {
                type: "OBJECT",
                properties: {
                    topic: { type: "STRING" },
                    transcript: { type: "STRING" },
                    truth: {
                        type: "OBJECT",
                        properties: {
                            who: { type: "STRING" }, problem: { type: "STRING" }, reason: { type: "STRING" }, solution: { type: "STRING" }, nextStep: { type: "STRING" }
                        },
                        required: ["who", "problem", "reason", "solution", "nextStep"]
                    }
                },
                required: ["topic", "transcript", "truth"]
            };

            const data = await fetchGeminiText(prompt, 0.9, 2000, schema);
            if (!data || !data.transcript) throw new Error("Invalid output format from LLM");

            const audioUrl = await fetchConversationTTS(data.transcript);
            if (!audioUrl) throw new Error("Audio generation format failed");

            setConversationData({ ...data, audioUrl });
            setNotes({ who: '', problem: '', reason: '', solution: '', nextStep: '' });
            setStatus('ready');
        } catch (e) {
            setApiError(`生成进阶听力材料失败 (${e.message})，请重试。`);
            setStatus('setup');
        }
    };

    const evaluateNotes = async () => {
        if (!notes.who && !notes.problem && !notes.reason && !notes.solution && !notes.nextStep) {
            setApiError("笔记为空，请先在下方输入您的盲听记录后再提交哦。");
            return;
        }

        setStatus('evaluating');
        setApiError('');
        try {
            const prompt = `Evaluate the user's notes against the ground truth for this conversation in Chinese.
      Topic: ${conversationData.topic}
      Truth: ${JSON.stringify(conversationData.truth)}
      User Notes: ${JSON.stringify(notes)}
      Return JSON: {"totalScore": 0-100, "overallFeedback": "...", "fieldEvaluations": [{"fieldId": "...", "fieldName": "...", "feedback": "...", "score": 0-20}]}`;

            const schema = {
                type: "OBJECT",
                properties: {
                    totalScore: { type: "INTEGER" },
                    overallFeedback: { type: "STRING" },
                    fieldEvaluations: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                fieldId: { type: "STRING" },
                                fieldName: { type: "STRING" },
                                feedback: { type: "STRING" },
                                score: { type: "INTEGER" }
                            }
                        }
                    }
                },
                required: ["totalScore", "overallFeedback", "fieldEvaluations"]
            };

            const validator = (d) => {
                if (!d || typeof d.totalScore !== 'number' || !Array.isArray(d.fieldEvaluations)) {
                    throw new Error("Invalid evaluation format from AI");
                }
            };

            const evalData = await fetchGeminiText(prompt, 0.4, 2000, schema, null, validator);
            setEvaluation(evalData);
            setStatus('result');
        } catch (e) {
            setApiError(`评分分析失败 (${e.message})，请重试。`);
            setStatus('practicing');
        }
    };

    const toggleAudio = () => {
        if (audioRef.current) {
            if (isPlaying) audioRef.current.pause();
            else audioRef.current.play();
            setIsPlaying(!isPlaying);
        }
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
                    <div className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition" onClick={onBack}>
                        <div className="bg-white p-2 rounded-lg shadow-sm text-slate-600"><ArrowLeft className="w-5 h-5" /></div>
                        <div><h1 className="text-xl font-bold text-slate-800">听写快记 (Conversation)</h1><p className="text-slate-500 text-xs">黄金五段逻辑剥离法</p></div>
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
                        <p className="text-slate-600 font-medium">考官正在为您准备进阶对话音频...</p>
                    </div>
                )}

                {status === 'ready' && (
                    <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
                        <div className="inline-block bg-emerald-100 text-emerald-800 px-4 py-1.5 rounded-full font-bold text-sm mb-6 uppercase tracking-widest">Topic: {conversationData?.topic}</div>
                        <h3 className="text-xl text-slate-700 mb-8">录音已就绪。请准备好做笔记，随时可以开始。</h3>
                        <button onClick={() => { setStatus('practicing'); toggleAudio(); }} className="px-8 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-full font-bold shadow-lg flex items-center mx-auto transition-transform hover:scale-105">
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
                        <p className="text-slate-400 text-xs mt-3">深度批改需要阅读大量上下文，请耐心等待 (可能需要20-40秒)</p>
                    </div>
                )}

                {(status === 'practicing' || status === 'result') && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                        <div className="lg:col-span-2 space-y-6">
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center space-x-4">
                                <button onClick={toggleAudio} className="w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full flex items-center justify-center shrink-0 transition-colors shadow-md">
                                    {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white ml-1" />}
                                </button>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-sm font-bold text-slate-700">Conversation Audio</span>
                                        <span className="text-xs text-emerald-600 font-bold px-2 py-0.5 bg-emerald-50 rounded">Advanced Level</span>
                                    </div>
                                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden w-full relative">
                                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="bg-slate-800 p-4 text-white flex justify-between items-center">
                                    <h2 className="text-sm font-bold uppercase tracking-wider flex items-center"><PenTool className="w-4 h-4 mr-2" /> 逻辑快记区 (Your Notes)</h2>
                                    {status === 'result' && <span className="bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-bold">Score: {evaluation?.totalScore}/100</span>}
                                </div>

                                <div className="p-6 space-y-5 bg-slate-50">
                                    {[
                                        { id: 'who', label: '1. 谁 (Who)', placeholder: '对话的双方是谁？是什么关系或身份？', icon: '👤' },
                                        { id: 'problem', label: '2. 问题 (Problem)', placeholder: '学生遇到了什么核心困难或诉求？', icon: '❓' },
                                        { id: 'reason', label: '3. 原因 (Reason)', placeholder: '导致这个问题的具体原因/背景是什么？', icon: '🔍' },
                                        { id: 'solution', label: '4. 解决办法 (Solution)', placeholder: '教授/职员提出了哪些建议或解决方案？', icon: '💡' },
                                        { id: 'nextStep', label: '5. 下一步 (Next Step)', placeholder: '学生接下来立刻要去做什么？', icon: '➡️' }
                                    ].map((field) => {
                                        const evalData = evaluation?.fieldEvaluations?.find(e => e.fieldId === field.id);
                                        return (
                                            <div key={field.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm group focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-400 transition-all">
                                                <div className="bg-slate-100/50 px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                                                    <label className="text-xs font-bold text-slate-700 flex items-center">{field.icon} {field.label}</label>
                                                    {status === 'result' && evalData && (
                                                        <span className={`text-xs font-bold ${evalData.score >= 15 ? 'text-emerald-600' : evalData.score >= 10 ? 'text-amber-500' : 'text-rose-500'}`}>
                                                            {evalData.score}/20
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="p-3">
                                                    <textarea
                                                        value={notes[field.id]}
                                                        onChange={(e) => setNotes({ ...notes, [field.id]: e.target.value })}
                                                        disabled={status === 'result'}
                                                        placeholder={field.placeholder}
                                                        className="w-full h-16 text-sm bg-transparent resize-none outline-none text-slate-800 placeholder-slate-300 disabled:opacity-70"
                                                    />
                                                </div>
                                                {status === 'result' && evalData && (
                                                    <div className="border-t border-slate-100 bg-slate-50 p-4 text-sm space-y-3">
                                                        <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100">
                                                            <p className="text-xs font-bold text-emerald-800 mb-1 flex items-center"><CheckCircle2 className="w-3 h-3 mr-1" /> 核心原文 (Ground Truth)</p>
                                                            <p className="text-slate-700 leading-relaxed">{conversationData.truth[field.id]}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-bold text-indigo-800 mb-1 flex items-center"><Sparkles className="w-3 h-3 mr-1" /> AI 批改反馈</p>
                                                            <p className="text-slate-600 leading-relaxed">{evalData.feedback}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {status === 'practicing' && (
                                        <button onClick={evaluateNotes} className="w-full py-4 mt-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-lg transition-colors flex items-center justify-center">
                                            <Check className="w-5 h-5 mr-2" /> 提交笔记并分析
                                        </button>
                                    )}
                                    {status === 'result' && (
                                        <button onClick={() => { setStatus('setup'); queueListeningPreload(); }} className="w-full py-4 mt-4 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold shadow-lg transition-colors">
                                            进入下一篇 (Next Conversation)
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-1 space-y-6">
                            {status === 'result' && evaluation && (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 shadow-sm">
                                    <h3 className="text-sm font-bold text-emerald-900 uppercase flex items-center mb-2"><Award className="w-4 h-4 mr-2" /> 听音策略点评</h3>
                                    <p className="text-slate-700 text-sm leading-relaxed">{evaluation.overallFeedback}</p>
                                </div>
                            )}

                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-[400px]">
                                <div className="p-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                                    <h2 className="text-xs font-bold text-slate-700 flex items-center"><FileText className="w-3 h-3 mr-1" /> 原文 (Transcript)</h2>
                                </div>
                                <div className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                                    {status === 'result' ? conversationData.transcript : <div className="h-full flex items-center justify-center text-slate-400 opacity-50 blur-[4px] select-none text-center">提交笔记后即可<br />解锁并查看对话原文</div>}
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

function ShadowingModule({ onBack }) {
    const [text, setText] = useState("Click 'Generate Next' to create your first practice sentence.");
    const [lengthLevel, setLengthLevel] = useState(3);
    const [difficultyLevel, setDifficultyLevel] = useState(5);
    const [learningFocus, setLearningFocus] = useState("general daily English");
    const [isGenerating, setIsGenerating] = useState(false);
    const [apiError, setApiError] = useState('');

    const [aiAdvice, setAiAdvice] = useState('你好！我是你的专属口语私教。开始录音练习后，我将聆听你的真实发音并进行多维度诊断。你可以随时在这里向我提问！');

    const neuralVoices = ['Aoede', 'Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'];
    const [selectedVoice, setSelectedVoice] = useState('Aoede');
    const [rate, setRate] = useState(1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isTtsLoading, setIsTtsLoading] = useState(false);
    const [ttsAudioUrl, setTtsAudioUrl] = useState('');
    const audioRef = useRef(null);

    const [highlightStart, setHighlightStart] = useState(0);
    const [highlightLength, setHighlightLength] = useState(0);
    const [showText, setShowText] = useState(false);

    const [isRecording, setIsRecording] = useState(false);
    const [transcribedText, setTranscribedText] = useState('');
    const [evaluationResult, setEvaluationResult] = useState(null);
    const [mediaError, setMediaError] = useState('');
    const [isEvaluating, setIsEvaluating] = useState(false);

    const [listenCount, setListenCount] = useState(0);
    const [readCount, setReadCount] = useState(0);
    const [history, setHistory] = useState([]);
    const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
    const [isDbLoaded, setIsDbLoaded] = useState(false);

    // 新增：用于控制学习历史面板收缩的独立状态 (默认收起)
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);

    const currentSentenceParams = useRef({ lengthLevel, difficultyLevel, learningFocus });
    const [currentAttempts, setCurrentAttempts] = useState([]);

    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recognitionRef = useRef(null);
    const currentTranscriptRef = useRef('');
    const fullTranscriptRef = useRef('');
    const audioCacheRef = useRef({});

    const hasRecordedThisSentenceRef = useRef(false);
    const [currentAudioPart, setCurrentAudioPart] = useState(null);
    const manualGenControllerRef = useRef(null);

    useEffect(() => {
        (async () => {
            setText(await DBUtils.get('shadow_text', "Click 'Generate Next' to create your first practice sentence."));

            let initLen = await DBUtils.get('shadow_lengthLevel', 3);
            if (initLen > 10) initLen = Math.max(1, Math.min(10, Math.ceil(initLen / 5)));
            setLengthLevel(initLen);

            setDifficultyLevel(await DBUtils.get('shadow_difficultyLevel', 5));
            setLearningFocus(await DBUtils.get('shadow_learningFocus', "general daily English"));
            setListenCount(await DBUtils.get('shadow_listenCount', 0));
            setReadCount(await DBUtils.get('shadow_readCount', 0));
            setHistory(await DBUtils.get('shadow_history', []));
            setIsDbLoaded(true);
        })();

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event) => {
                let interimTranscript = ''; let finalTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
                    else interimTranscript += event.results[i][0].transcript;
                }
                const currentFull = currentTranscriptRef.current + finalTranscript + interimTranscript;
                fullTranscriptRef.current = currentFull;
                setTranscribedText(currentFull);
                if (finalTranscript) currentTranscriptRef.current += finalTranscript + ' ';
            };
            recognition.onerror = (event) => { if (event.error !== 'no-speech') setMediaError(`识别出错: ${event.error}`); };
            recognitionRef.current = recognition;
        }

        return () => { if (recognitionRef.current) recognitionRef.current.abort(); };
    }, []);

    useEffect(() => {
        if (!isDbLoaded) return;
        const savedText = text;
        if (!savedText || savedText === "Click 'Generate Next' to create your first practice sentence.") {
            setIsGenerating(true);
            if (PreloadPipeline.cache.shadow &&
                PreloadPipeline.cache.shadow.lengthLevel === lengthLevel &&
                PreloadPipeline.cache.shadow.difficultyLevel === difficultyLevel &&
                PreloadPipeline.cache.shadow.learningFocus === learningFocus) {
                const preloaded = PreloadPipeline.cache.shadow;
                setText(preloaded.text);
                setTtsAudioUrl(preloaded.audioUrl);
                audioCacheRef.current[selectedVoice] = preloaded.audioUrl;
                currentSentenceParams.current = { lengthLevel, difficultyLevel, learningFocus };
                PreloadPipeline.cache.shadow = null;
                setIsGenerating(false);
            } else {
                generateNewText(lengthLevel, learningFocus, difficultyLevel);
            }
        } else {
            currentSentenceParams.current = { lengthLevel, difficultyLevel, learningFocus };
        }
    }, [isDbLoaded]);

    useEffect(() => {
        if (!isDbLoaded) return;
        DBUtils.set('shadow_text', text);
        DBUtils.set('shadow_lengthLevel', lengthLevel);
        DBUtils.set('shadow_difficultyLevel', difficultyLevel);
        DBUtils.set('shadow_learningFocus', learningFocus);
        DBUtils.set('shadow_listenCount', listenCount);
        DBUtils.set('shadow_readCount', readCount);
        DBUtils.set('shadow_history', history);
    }, [text, lengthLevel, difficultyLevel, learningFocus, listenCount, readCount, history, isDbLoaded]);

    useEffect(() => {
        hasRecordedThisSentenceRef.current = false;
        setCurrentAudioPart(null);
    }, [text]);

    useEffect(() => {
        if (isRecording) { hasRecordedThisSentenceRef.current = true; }
    }, [isRecording]);

    useEffect(() => {
        if (!isDbLoaded || !text || text === "Click 'Generate Next' to create your first practice sentence.") return;

        const cache = PreloadPipeline.cache.shadow;
        if (cache && cache.lengthLevel === lengthLevel && cache.learningFocus === learningFocus && cache.difficultyLevel === difficultyLevel) {
            return;
        }

        let idleTimer = null;
        if (!isRecording && !hasRecordedThisSentenceRef.current && !isGenerating && !isEvaluating) {
            idleTimer = setTimeout(() => {
                queueShadowPreload(lengthLevel, learningFocus, difficultyLevel, selectedVoice);
            }, 2000);
        }
        return () => { if (idleTimer) clearTimeout(idleTimer); };
    }, [text, isRecording, isGenerating, isEvaluating, lengthLevel, learningFocus, difficultyLevel, selectedVoice, isDbLoaded]);

    useEffect(() => {
        if (!text || text === "Click 'Generate Next' to create your first practice sentence.") return;
        let isCancelled = false;
        const fetchCurrentTTS = async () => {
            handleStop();
            if (!audioCacheRef.current[selectedVoice]) {
                setIsTtsLoading(true);
                const url = await fetchNeuralTTS(selectedVoice, text);
                if (!isCancelled && url) { audioCacheRef.current[selectedVoice] = url; setTtsAudioUrl(url); }
                setIsTtsLoading(false);
            } else { setTtsAudioUrl(audioCacheRef.current[selectedVoice]); }
        };
        fetchCurrentTTS();
        return () => { isCancelled = true; };
    }, [text, selectedVoice]);

    useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);

    const playSimpleSpeech = (t, onEndCb = null) => {
        const s = window.speechSynthesis; s.cancel();
        const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; u.rate = rate;
        u.onend = () => { if (onEndCb) onEndCb(); else { setIsPlaying(false); setIsPaused(false); setListenCount(prev => prev + 1); } };
        s.speak(u);
    };

    const generateNewText = async (targetLengthLevel = lengthLevel, currentFocus = learningFocus, currentDifficultyLevel = difficultyLevel) => {
        if (text && text !== "Click 'Generate Next' to create your first practice sentence." && (listenCount > 0 || readCount > 0)) {
            setHistory(prev => [{ id: Date.now(), text, listenCount, readCount, accuracy: evaluationResult?.accuracy ?? null, date: new Date().toLocaleString() }, ...prev]);
        }
        setApiError(''); setListenCount(0); setReadCount(0); setTranscribedText(''); setEvaluationResult(null); setShowText(false); handleStop();
        setCurrentAttempts([]);

        const safeLengthLevel = parseInt(targetLengthLevel) || 3;
        const safeDifficultyLevel = parseInt(currentDifficultyLevel) || 5;

        const cache = PreloadPipeline.cache.shadow;
        if (cache && cache.lengthLevel === safeLengthLevel && cache.learningFocus === currentFocus && cache.difficultyLevel === safeDifficultyLevel) {
            setIsGenerating(true);
            setTimeout(() => {
                setText(cache.text);
                audioCacheRef.current = {};
                if (cache.audioUrl) {
                    audioCacheRef.current[selectedVoice] = cache.audioUrl;
                    setTtsAudioUrl(cache.audioUrl);
                    setIsTtsLoading(false);
                } else {
                    setTtsAudioUrl('');
                }
                currentSentenceParams.current = { lengthLevel: safeLengthLevel, difficultyLevel: safeDifficultyLevel, learningFocus: currentFocus };
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

        setIsGenerating(true); audioCacheRef.current = {}; setTtsAudioUrl('');

        try {
            const lengthDesc = getLengthDescription(safeLengthLevel);
            const diffDesc = getDifficultyDescription(safeDifficultyLevel);

            // 修复：精简 Prompt，明确要求不要包含任何闲聊
            const prompt = `Act as an expert English teacher. Generate ONE complete English sentence.
      
      STRICT REQUIREMENTS:
      1. Length & Structure: The sentence should be ${lengthDesc}. (Never output short fragments).
      2. Topic: "${currentFocus}". Choose a specific TOEFL-style context (e.g., campus life, biology, history, etc.).
      3. Vocabulary: Use ${diffDesc}.
      
      CRITICAL INSTRUCTION: Output ONLY the actual English sentence as the value for the "sentence" key. DO NOT include any conversational filler like "Here is the sentence:" inside the JSON.`;

            const schema = {
                type: "OBJECT",
                properties: { sentence: { type: "STRING" } },
                required: ["sentence"]
            };

            // 修复：将错写的 safeLengthLvl 修正为 safeLengthLevel，消除 ReferenceError 宕机问题
            const validator = (d) => {
                if (!d || typeof d.sentence !== 'string') throw new Error("Invalid format");
                let txt = d.sentence.trim();
                if (txt.split(/\s+/).length < Math.max(4, safeLengthLevel + 2)) throw new Error("Sentence too short fragment");

                // 智能容错：LLM 输出短 JSON 时常遗漏句末标点，直接自动补全而不是报错重试
                if (!/[.!?]["']?$/.test(txt)) {
                    d.sentence = txt + ".";
                    txt = d.sentence;
                }

                if (/^(here is|here's|sure|certainly|the json|json requested)/i.test(txt)) throw new Error("Contains AI filler");
            };

            let data = await fetchGeminiText(prompt, 0.7, 400, schema, signal, validator);
            setText(data.sentence.trim());
            currentSentenceParams.current = { lengthLevel: safeLengthLevel, difficultyLevel: safeDifficultyLevel, learningFocus: currentFocus };
        } catch (err) {
            if (err.name === 'AbortError') return;
            setApiError("生成句子失败，可能是网络问题，请重试。");
        } finally {
            if (!signal.aborted) setIsGenerating(false);
        }
    };

    const handlePlay = async () => {
        if (isPaused && audioRef.current && ttsAudioUrl) {
            audioRef.current.play(); setIsPaused(false); setIsPlaying(true); return;
        } else if (isPaused) {
            window.speechSynthesis.resume(); setIsPaused(false); setIsPlaying(true); return;
        }

        if (ttsAudioUrl && audioRef.current) {
            audioRef.current.src = ttsAudioUrl;
            audioRef.current.playbackRate = rate;
            try {
                await audioRef.current.play();
                setIsPlaying(true); setIsPaused(false);
            } catch (e) {
                console.error("Audio block:", e);
                setApiError('浏览器自动播放拦截，已降级为系统本地机器语音。');
                setTimeout(() => setApiError(''), 4000);
                playSimpleSpeech(text); setIsPlaying(true); setIsPaused(false);
            }
        } else if (text) {
            setApiError('超清语音 API 请求受限，当前已自动降级为系统基础机器语音。');
            setTimeout(() => setApiError(''), 4000);
            playSimpleSpeech(text); setIsPlaying(true); setIsPaused(false);
        }
    };

    const handlePause = () => {
        if (audioRef.current && isPlaying && ttsAudioUrl) { audioRef.current.pause(); }
        else if (isPlaying) { window.speechSynthesis.pause(); }
        setIsPaused(true); setIsPlaying(false);
    };

    const handleStop = () => {
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
        window.speechSynthesis.cancel();
        setIsPlaying(false); setIsPaused(false); setHighlightStart(0); setHighlightLength(0);
    };

    const handleAudioEnded = () => { setIsPlaying(false); setIsPaused(false); setHighlightStart(0); setHighlightLength(0); setListenCount(prev => prev + 1); };
    const handleTimeUpdate = () => {
        if (!audioRef.current || !isPlaying) return;
        const { currentTime, duration } = audioRef.current;
        if (duration > 0.25 && text) {
            let adjTime = Math.max(0, currentTime - 0.25);
            const targetIndex = Math.floor((adjTime / (duration - 0.25)) * text.length);
            let start = targetIndex; while (start > 0 && !/\s/.test(text[start - 1])) start--;
            let end = targetIndex; while (end < text.length && !/\s/.test(text[end])) end++;
            setHighlightStart(Math.max(0, start)); setHighlightLength(Math.min(text.length, end) - start);
        }
    };

    const toggleRecording = async () => {
        setMediaError('');
        if (isRecording) {
            await playBeep(400, 0.15);
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
            if (recognitionRef.current) recognitionRef.current.stop();
            setIsRecording(false); setReadCount(prev => prev + 1);
        } else {
            handleStop();
            setTranscribedText(''); setEvaluationResult(null); currentTranscriptRef.current = ''; fullTranscriptRef.current = '';
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

                await playBeep(800, 0.1);

                mediaRecorderRef.current = new MediaRecorder(stream); audioChunksRef.current = [];
                mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
                mediaRecorderRef.current.onstop = () => {
                    stream.getTracks().forEach(track => track.stop());
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    evaluatePronunciation(text, fullTranscriptRef.current, audioBlob);
                };
                mediaRecorderRef.current.start();
                if (recognitionRef.current) { try { recognitionRef.current.start(); } catch (e) { } }
                setIsRecording(true);
            } catch (err) { setMediaError('无法访问麦克风。请确保授予权限。'); }
        }
    };

    const evaluatePronunciation = async (originalText, spokenText, audioBlob) => {
        const origWordsRaw = originalText.split(/\s+/).filter(w => w.length > 0);

        if ((!spokenText || !spokenText.trim()) && (!audioBlob || audioBlob.size === 0)) {
            setEvaluationResult({ words: origWordsRaw.map(w => ({ word: w, status: 'omitted', isCorrect: false })), accuracy: 0 });
            setAiAdvice("未检测到声音。请大声朗读。"); return;
        }

        setIsEvaluating(true);
        let nextLengthLevel = lengthLevel;
        let nextFocus = learningFocus;
        let currentFluency = 0; let currentIntonation = 0;

        try {
            let base64Audio = null;
            let mimeType = 'audio/webm';
            if (audioBlob && audioBlob.size > 0) {
                base64Audio = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(audioBlob);
                });
                mimeType = audioBlob.type || 'audio/webm';
                setCurrentAudioPart({ mimeType, data: base64Audio });
            }

            const historyAcc = history.slice(0, 3).map(h => h.accuracy).join('%, ') + (history.length > 0 ? '%' : '');
            const indexedOriginal = origWordsRaw.map((w, i) => `[${i}] ${w}`).join(" ");

            const promptText = `Evaluate pronunciation based strictly on the AUDIO. Ignore STT text errors.
      Original Text: ${indexedOriginal}
      Difficulty: Length Lv.${lengthLevel}, Vocab Lv.${difficultyLevel}.
      User Practice Stats: Listened ${listenCount} times, Read ${readCount + 1} times. Text was ${showText ? "VISIBLE" : "HIDDEN"}.
      History Context: [${historyAcc}]
      CRITICAL INSTRUCTION FOR 'advice' (in Chinese): 
      - Provide comprehensive, personalized feedback combining ALL user stats (e.g. mention their listen/read counts and text visibility).
      - If VISIBLE, explicitly encourage hiding text for blind listening. If HIDDEN, praise their blind effort.
      Return JSON: {"errors": [{"index": ..., "word": "...", "status": "omitted|wrong", "spoken": "...", "ipa": "..."}], "advice": "...", "fluencyScore": 0-100, "intonationScore": 0-100, "suggestedFocus": "..."}`;

            const parts = [{ text: promptText }];
            if (base64Audio) {
                parts.push({ inlineData: { mimeType, data: base64Audio } });
            }

            const schema = {
                type: "OBJECT",
                properties: {
                    errors: { type: "ARRAY", items: { type: "OBJECT", properties: { index: { type: "INTEGER" }, word: { type: "STRING" }, status: { type: "STRING" }, spoken: { type: "STRING" }, ipa: { type: "STRING" } }, required: ["index", "word", "status", "spoken", "ipa"] } },
                    advice: { type: "STRING" },
                    fluencyScore: { type: "INTEGER" },
                    intonationScore: { type: "INTEGER" },
                    suggestedFocus: { type: "STRING" }
                },
                required: ["errors", "advice", "fluencyScore", "intonationScore", "suggestedFocus"]
            };
            const validator = (d) => { if (!d || !Array.isArray(d.errors) || typeof d.fluencyScore !== 'number') throw new Error("Invalid format from API"); };

            let data = await fetchGeminiText(parts, 0.4, 1500, schema, null, validator);

            if (!data) data = {};
            const errorMap = {};
            (data.errors || []).forEach(err => { if (err.index !== undefined) errorMap[err.index] = err; });

            const resultWords = origWordsRaw.map((w, i) => {
                const err = errorMap[i];
                return err ? { word: w, isCorrect: false, status: err.status === 'wrong' ? 'wrong' : 'omitted', spoken: err.status === 'wrong' ? (err.spoken || '').substring(0, 15) : '', ipa: err.status === 'wrong' ? (err.ipa || '').substring(0, 20) : '' } : { word: w, isCorrect: true, status: 'correct', spoken: '', ipa: '' };
            });
            const realAcc = origWordsRaw.length ? Math.round((resultWords.filter(w => w.isCorrect).length / origWordsRaw.length) * 100) : 0;
            currentFluency = data.fluencyScore || 0;
            currentIntonation = data.intonationScore || 0;
            setEvaluationResult({ words: resultWords, accuracy: realAcc, fluency: currentFluency, intonation: currentIntonation });

            const finalAdvice = `### 🎯 跟读评测完成！\n\n- **综合准确度**：**${realAcc}%**\n- **发音流畅度**：**${currentFluency}%**\n- **自然语调**：**${currentIntonation}%**\n\n${data.advice || "继续努力！"}`;
            setAiAdvice(finalAdvice);

            const updatedAttempts = [...currentAttempts, { accuracy: realAcc, fluency: currentFluency, intonation: currentIntonation }];
            setCurrentAttempts(updatedAttempts);

            const triesCount = updatedAttempts.length;
            const getComprehensiveScore = (attempt) => (attempt.accuracy * 0.5) + (attempt.fluency * 0.3) + (attempt.intonation * 0.2);

            const latestScore = getComprehensiveScore(updatedAttempts[triesCount - 1]);
            const avgScore = updatedAttempts.reduce((sum, a) => sum + getComprehensiveScore(a), 0) / triesCount;

            const isFirstTryPerfect = triesCount === 1 && latestScore >= 85 && realAcc >= 85;
            const isConsistentlyGood = triesCount > 1 && latestScore >= 85 && avgScore >= 80;
            const isStruggling = triesCount >= 2 && latestScore < 75 && avgScore < 75;
            const isFirstTryTerrible = triesCount === 1 && latestScore < 60;

            let nLen = lengthLevel;
            if (isFirstTryPerfect || isConsistentlyGood) nLen = lengthLevel + 1;
            else if (isStruggling || isFirstTryTerrible) nLen = lengthLevel - 1;

            nextLengthLevel = Math.max(1, Math.min(10, nLen));
            nextFocus = data.suggestedFocus || learningFocus;
        } catch (err) {
            console.warn("AI 深度评测失败，已降级为本地评测模式。原因:", err.message);
            const cleanWord = (w) => w.toLowerCase().replace(/[^\w\s']/g, '');
            const spokWords = spokenText ? spokenText.split(/\s+/).map(cleanWord).filter(w => w.length > 0) : [];
            let correctCount = 0, spokIdx = 0;

            const resultWords = origWordsRaw.map((rawWord) => {
                const cleanTarget = cleanWord(rawWord);
                let isCorrect = false, spoken = '';
                for (let i = spokIdx; i < Math.min(spokIdx + 4, spokWords.length); i++) {
                    if (spokWords[i] === cleanTarget || spokWords[i].startsWith(cleanTarget.substring(0, cleanTarget.length - 1))) {
                        isCorrect = true; spokIdx = i + 1; correctCount++; break;
                    }
                }
                if (!isCorrect && spokIdx < spokWords.length) { spoken = spokWords[spokIdx]; spokIdx++; }
                return { word: rawWord, isCorrect, status: isCorrect ? 'correct' : (spoken ? 'wrong' : 'omitted'), spoken, ipa: spoken ? 'N/A' : '' };
            });
            const localAccuracy = origWordsRaw.length ? Math.round((correctCount / origWordsRaw.length) * 100) : 0;
            setEvaluationResult({ words: resultWords, accuracy: localAccuracy, fluency: localAccuracy, intonation: localAccuracy });

            const updatedAttempts = [...currentAttempts, { accuracy: localAccuracy, fluency: localAccuracy, intonation: localAccuracy }];
            setCurrentAttempts(updatedAttempts);

            const triesCount = updatedAttempts.length;
            const latestScore = localAccuracy;
            const avgScore = updatedAttempts.reduce((sum, a) => sum + a.accuracy, 0) / triesCount;

            let nLen = lengthLevel;
            if ((triesCount === 1 && latestScore >= 85) || (triesCount > 1 && latestScore >= 85 && avgScore >= 80)) nLen = lengthLevel + 1;
            else if ((triesCount >= 2 && latestScore < 75 && avgScore < 75) || (triesCount === 1 && latestScore < 60)) nLen = lengthLevel - 1;

            nextLengthLevel = Math.max(1, Math.min(10, nLen));

            setAiAdvice(`AI 深度录音评测暂时不可用，已自动启用本地备用打分。您可以继续向我提问。`);
        } finally {
            setIsEvaluating(false);
            if (nextLengthLevel !== lengthLevel) setLengthLevel(nextLengthLevel);
            if (nextFocus !== learningFocus) setLearningFocus(nextFocus);
            queueShadowPreload(nextLengthLevel, nextFocus, difficultyLevel, selectedVoice);
        }
    };

    const handleDiscardAttempt = () => {
        setCurrentAttempts(prev => prev.slice(0, -1));
        setEvaluationResult(null);
        setAiAdvice("已撤销上一次的异常录音成绩。本次将不计入难度评估，请重新点击“开始跟读”进行尝试。");
        setTranscribedText('');
        setReadCount(prev => Math.max(0, prev - 1));

        setLengthLevel(currentSentenceParams.current.lengthLevel);
        setDifficultyLevel(currentSentenceParams.current.difficultyLevel);
        setLearningFocus(currentSentenceParams.current.learningFocus);
    };

    const handleHistoryScroll = (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 10) {
            if (visibleHistoryCount < history.length) setVisibleHistoryCount(prev => prev + 10);
        }
    };

    const deleteHistoryItem = (id, e) => {
        e.stopPropagation();
        const newHistory = history.filter(item => item.id !== id);
        setHistory(newHistory);
        DBUtils.set('shadow_history', newHistory);
    };

    // 优化：减小生成文本在界面中的实际显示字号
    const renderHighlightedText = () => {
        if (!isPlaying && !isPaused) return <p className="text-base md:text-lg leading-relaxed text-slate-800 font-medium">{text}</p>;
        const before = text.substring(0, highlightStart);
        const highlighted = text.substring(highlightStart, highlightStart + highlightLength);
        const after = text.substring(highlightStart + highlightLength);

        return (
            <p className="text-base md:text-lg leading-relaxed text-slate-400 font-medium">
                <span>{before}</span>
                <span className="text-indigo-600 bg-indigo-50/50 rounded px-1 transition-colors duration-75">{highlighted}</span>
                <span className="text-slate-800">{after}</span>
            </p>
        );
    };

    const avgLevel = Math.round((lengthLevel + difficultyLevel) / 2);

    return (
        <div className="bg-slate-50 min-h-[calc(100vh-64px)] p-4 md:p-6 font-sans pb-20">
            <audio ref={audioRef} onEnded={handleAudioEnded} onTimeUpdate={handleTimeUpdate} className="hidden" />
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center space-y-3 md:space-y-0 pb-4 border-b border-slate-200">
                    <div className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition" onClick={onBack}>
                        <div className="bg-slate-200 p-2 rounded-lg text-slate-600"><ArrowLeft className="w-5 h-5" /></div>
                        <div><h1 className="text-xl font-bold text-slate-800">影子跟读</h1><p className="text-slate-500 text-xs">听懂、读准、掌握</p></div>
                    </div>
                </header>

                <div className="space-y-4">
                    {apiError && (
                        <div className="bg-amber-50 text-amber-700 p-3 rounded-lg border border-amber-200 flex items-center text-sm animate-in fade-in slide-in-from-top-2">
                            <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                            {apiError}
                        </div>
                    )}

                    <div className="flex flex-col gap-3">
                        {/* 全新重构：极简高级感控制带 */}
                        <div className="flex justify-center w-full relative z-30">
                            <div className="inline-flex items-center bg-white/90 backdrop-blur-md border border-slate-200/60 shadow-sm hover:shadow-md rounded-full px-5 py-2.5 text-xs font-medium text-slate-500 gap-5 transition-all">

                                {/* 发音选择 */}
                                <div className="flex items-center gap-1.5 hover:text-slate-800 transition-colors relative cursor-pointer group/voice">
                                    <Mic className="w-3.5 h-3.5 opacity-70" />
                                    <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer appearance-none pl-0.5 pr-3 relative z-10">
                                        <option value="Aoede">Aoede</option><option value="Zephyr">Zephyr</option><option value="Kore">Kore</option><option value="Puck">Puck</option><option value="Charon">Charon</option><option value="Fenrir">Fenrir</option>
                                    </select>
                                    <ChevronRight className="w-3 h-3 absolute right-0 top-1 text-slate-400 rotate-90 opacity-60 group-hover/voice:opacity-100 transition-opacity pointer-events-none" />
                                </div>

                                <div className="w-px h-3.5 bg-slate-200"></div>

                                {/* 聚合难度设置菜单 (Hover 展开) */}
                                <div className="relative group/settings flex items-center gap-1.5 cursor-pointer hover:text-slate-800 transition-colors py-1">
                                    <Settings className="w-3.5 h-3.5 opacity-70" />
                                    <span className="font-bold text-slate-700">Lv.{avgLevel}</span>

                                    {/* 弹出面板 */}
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-56 bg-white/95 backdrop-blur-xl border border-slate-200/80 shadow-xl rounded-2xl p-4 opacity-0 invisible group-hover/settings:opacity-100 group-hover/settings:visible transition-all duration-200 z-50 transform origin-top group-hover/settings:scale-100 scale-95">
                                        <div className="space-y-5 cursor-default" onClick={e => e.stopPropagation()}>
                                            <div className="flex flex-col gap-2">
                                                <div className="flex justify-between text-xs items-center">
                                                    <span className="text-slate-500 font-medium">句子长度 (Length)</span>
                                                    <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">L{lengthLevel}</span>
                                                </div>
                                                <input type="range" min="1" max="10" step="1" value={lengthLevel} onChange={(e) => setLengthLevel(parseInt(e.target.value))} className="w-full h-1.5 bg-slate-100 rounded-full outline-none accent-indigo-500 cursor-pointer transition-all hover:h-2" />
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <div className="flex justify-between text-xs items-center">
                                                    <span className="text-slate-500 font-medium">词汇难度 (Vocab)</span>
                                                    <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">L{difficultyLevel}</span>
                                                </div>
                                                <input type="range" min="1" max="10" step="1" value={difficultyLevel} onChange={(e) => setDifficultyLevel(parseInt(e.target.value))} className="w-full h-1.5 bg-slate-100 rounded-full outline-none accent-indigo-500 cursor-pointer transition-all hover:h-2" />
                                            </div>
                                        </div>
                                        {/* 顶角小箭头 */}
                                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-slate-200/80 rotate-45 rounded-tl-[2px]"></div>
                                    </div>
                                </div>

                                <div className="w-px h-3.5 bg-slate-200 hidden sm:block"></div>

                                {/* 听过次数 */}
                                <div className="hidden sm:flex items-center gap-1.5 hover:text-slate-800 transition-colors" title={`已听过 ${listenCount} 次`}>
                                    <Headphones className="w-3.5 h-3.5 opacity-70" />
                                    <span className="font-bold text-slate-700">{listenCount}</span>
                                </div>

                                <div className="w-px h-3.5 bg-slate-200"></div>

                                {/* 显隐文本 */}
                                <button onClick={() => setShowText(!showText)} className="flex items-center gap-1.5 hover:text-slate-800 transition-colors outline-none">
                                    {showText ? <EyeOff className="w-3.5 h-3.5 opacity-70" /> : <Eye className="w-3.5 h-3.5 opacity-70" />}
                                    <span className="font-bold text-slate-700">{showText ? '隐藏文本' : '显示文本'}</span>
                                </button>

                                {/* 就绪指示灯 */}
                                {PreloadPipeline.cache.shadow && (
                                    <div className="absolute -right-0.5 -top-0.5 animate-in fade-in zoom-in duration-300" title="下一句资源已就绪">
                                        <span className="relative flex h-2.5 w-2.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-white"></span>
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 极简无框文本展示区，高度进一步压缩 */}
                        <div className="min-h-[80px] flex flex-col relative justify-center items-center w-full my-1">
                            {isGenerating ? <div className="animate-pulse space-y-3 w-full max-w-lg"><div className="h-3 bg-slate-200 rounded w-3/4 mx-auto"></div><div className="h-3 bg-slate-200 rounded w-1/2 mx-auto"></div></div> :
                                showText ?
                                    <div key={text} className="animate-in fade-in slide-in-from-right-4 duration-500 w-full text-center px-4">
                                        {renderHighlightedText()}
                                    </div> :
                                    <div className="flex flex-col items-center py-2 text-slate-400 cursor-pointer transition-colors hover:text-indigo-500 group" onClick={() => setShowText(true)}>
                                        <Eye className="w-8 h-8 mb-1.5 opacity-40 group-hover:opacity-70 transition-opacity" />
                                        <p className="text-xs font-medium">点击显示文本内容</p>
                                    </div>}
                        </div>

                        {/* 全新重构的胶囊底座按钮组 (自带微阴影突显层级) */}
                        <div className="flex justify-center mb-2">
                            <div className="bg-white border border-slate-200 rounded-full p-1.5 flex items-center justify-center space-x-1.5 shadow-md mx-auto w-max">

                                {isPlaying ?
                                    <button onClick={handlePause} className="w-12 h-12 flex items-center justify-center bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-full transition-colors" title="暂停">
                                        <Pause className="w-5 h-5 fill-current" />
                                    </button>
                                    :
                                    <button onClick={handlePlay} disabled={isGenerating || isTtsLoading || !ttsAudioUrl} className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${isGenerating || isTtsLoading || !ttsAudioUrl ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:scale-105 active:scale-95'}`} title="播放神经语音">
                                        {isTtsLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current ml-1" />}
                                    </button>
                                }

                                <button onClick={handleStop} className="w-10 h-10 flex items-center justify-center bg-transparent hover:bg-slate-100 text-slate-500 rounded-full transition-colors" disabled={!isPlaying && !isPaused} title="停止">
                                    <Square className="w-4 h-4 fill-current" />
                                </button>

                                <div className="px-1">
                                    <select value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} className="text-sm border-none text-slate-600 font-bold bg-transparent outline-none cursor-pointer hover:text-indigo-600 transition-colors">
                                        <option value="0.8">0.8x</option><option value="1">1.0x</option><option value="1.2">1.2x</option>
                                    </select>
                                </div>

                                <div className="w-px h-6 bg-slate-200 mx-1"></div>

                                {/* 核心录音跟读键 */}
                                <button
                                    onClick={toggleRecording}
                                    disabled={isGenerating || !text || text.includes('Click')}
                                    className={`w-12 h-12 flex items-center justify-center rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed ${isRecording ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-200 animate-pulse' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm hover:scale-105 active:scale-95'}`}
                                    title={isRecording ? "结束录音并提交评分" : "开始您的跟读"}
                                >
                                    {isRecording ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" />}
                                </button>

                                <div className="w-px h-6 bg-slate-200 mx-1"></div>

                                {/* 生成下一题按钮 */}
                                <button
                                    onClick={() => generateNewText(lengthLevel, learningFocus, difficultyLevel)}
                                    disabled={isGenerating}
                                    className="w-12 h-12 flex items-center justify-center bg-transparent hover:bg-slate-100 text-slate-600 hover:text-indigo-600 rounded-full transition-all disabled:opacity-50"
                                    title="随机生成下一句"
                                >
                                    {isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-6 h-6" />}
                                </button>

                            </div>
                        </div>

                        {/* 状态与打分展示槽 */}
                        {(isRecording || isEvaluating || evaluationResult) && (
                            <div className="pt-1">
                                {isRecording && (
                                    <div className="text-center text-sm font-medium text-indigo-600 bg-indigo-50 p-4 rounded-xl border border-indigo-100 mx-auto max-w-2xl w-full shadow-sm animate-in zoom-in-95">
                                        <Mic className="w-4 h-4 inline mr-2 animate-bounce" /> 正在倾听您的发音: "{transcribedText || "..."}"
                                    </div>
                                )}
                                {isEvaluating && (
                                    <div className="text-center text-sm font-medium text-blue-600 bg-blue-50 p-4 rounded-xl border border-blue-100 mx-auto max-w-2xl w-full shadow-sm animate-in zoom-in-95">
                                        <RefreshCw className="w-4 h-4 animate-spin inline mr-2" /> AI 深度发音评测中，请稍候...
                                    </div>
                                )}
                                {!isRecording && !isEvaluating && evaluationResult && (
                                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 shadow-inner mx-auto max-w-4xl w-full animate-in slide-in-from-bottom-4">
                                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 pb-3 border-b border-slate-100 gap-3">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <span className="text-sm font-bold text-slate-700 flex items-center"><Sparkles className="w-4 h-4 mr-1 text-amber-500" /> 评测结果</span>
                                                <div className="flex space-x-2 text-xs font-bold">
                                                    <span className={`px-2.5 py-1 rounded-md shadow-sm border ${evaluationResult.accuracy >= 80 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>准确度 {evaluationResult.accuracy}%</span>
                                                    <span className={`px-2.5 py-1 rounded-md shadow-sm border ${evaluationResult.fluency >= 80 ? 'text-blue-700 bg-blue-50 border-blue-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>流畅度 {evaluationResult.fluency}%</span>
                                                    <span className={`px-2.5 py-1 rounded-md shadow-sm border ${evaluationResult.intonation >= 80 ? 'text-purple-700 bg-purple-50 border-purple-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>语调 {evaluationResult.intonation}%</span>
                                                </div>
                                            </div>
                                            <button onClick={handleDiscardAttempt} className="text-xs flex items-center text-rose-500 hover:text-rose-700 transition-colors font-medium bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-md shadow-sm border border-rose-100">
                                                <RotateCcw className="w-3 h-3 mr-1" /> 撤销成绩
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-y-8 gap-x-2 justify-center">
                                            {evaluationResult.words.map((item, idx) => (
                                                <div key={idx} className="flex flex-col items-center min-w-[2.5rem] relative">
                                                    <span className={`px-2 py-1 rounded-md font-medium shadow-sm border ${item.isCorrect ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200 underline decoration-wavy'}`}>{item.word}</span>
                                                    {!item.isCorrect && item.status === 'wrong' && item.spoken && <div className="absolute top-full mt-1.5 text-[10px] text-center bg-white px-1.5 py-0.5 rounded shadow border border-rose-200 z-10 w-max"><span className="text-rose-600 font-bold">{item.spoken}</span><br /><span className="text-indigo-600 font-mono text-[9px]">/{item.ipa}/</span></div>}
                                                    {!item.isCorrect && item.status === 'omitted' && <span className="absolute top-full mt-1.5 text-[10px] font-bold text-slate-400">(漏读)</span>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 优化：动态响应收展状态的 Grid 布局 */}
                    <div className={`grid grid-cols-1 ${isHistoryOpen ? 'lg:grid-cols-3' : 'lg:grid-cols-1'} gap-6 pt-4 transition-all duration-300 ease-in-out`}>

                        <div className={`${isHistoryOpen ? 'lg:col-span-2' : 'lg:col-span-1'} bg-blue-50/50 rounded-xl shadow-sm border border-blue-200 h-[500px] relative overflow-hidden transition-all duration-300`}>
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
                                        className={`flex items-center space-x-1.5 text-xs font-bold px-2 py-1 rounded-md transition-colors ${isHistoryOpen ? 'text-indigo-600 bg-indigo-50' : 'text-slate-500 hover:bg-slate-200'}`}
                                    >
                                        <History className="w-4 h-4" />
                                        <span className="hidden sm:inline">{isHistoryOpen ? '收起历史' : '展开历史'}</span>
                                    </button>
                                }
                            />
                        </div>

                        {/* 侧边学习历史面板：默认隐藏 */}
                        {isHistoryOpen && (
                            <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-[500px] animate-in slide-in-from-right-4 duration-300">
                                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                    <h2 className="text-sm font-bold text-slate-700 flex items-center"><History className="w-4 h-4 mr-2 text-indigo-500" /> 学习历史</h2>
                                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold shadow-sm">{history.length} 条</span>
                                </div>
                                <div className="flex-1 overflow-y-auto p-3 space-y-3" onScroll={handleHistoryScroll}>
                                    {history.slice(0, visibleHistoryCount).map((item) => (
                                        <div key={item.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-sm transition-all relative group">
                                            <div className="flex justify-between items-start mb-1.5">
                                                <p className="text-[10px] font-medium text-slate-400">{item.date}</p>
                                                <button onClick={(e) => deleteHistoryItem(item.id, e)} className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-rose-500 transition-all p-1 bg-white rounded-full shadow-sm"><Trash2 className="w-3 h-3" /></button>
                                            </div>
                                            <p className="text-sm text-slate-700 line-clamp-3 font-medium mb-3 pr-4 leading-relaxed" title={item.text}>{item.text}</p>
                                            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                                                <div className="flex space-x-3 text-slate-500">
                                                    <span title="听力次数" className="flex items-center"><Headphones className="w-3 h-3 mr-1" /> {item.listenCount}</span>
                                                    <span title="朗读次数" className="flex items-center"><Mic className="w-3 h-3 mr-1" /> {item.readCount}</span>
                                                </div>
                                                {item.accuracy !== null ? (
                                                    <span className={`font-black ${item.accuracy >= 80 ? 'text-emerald-600' : 'text-amber-500'}`}>准确率 {item.accuracy}%</span>
                                                ) : <span className="text-slate-400 font-medium">未评测</span>}
                                            </div>
                                        </div>
                                    ))}
                                    {history.length === 0 && <div className="text-center text-slate-400 text-xs py-10">暂无历史记录</div>}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ==========================================
// 模块 2: 模拟面试 (Take an Interview)
// ==========================================
function InterviewModule({ onBack }) {
    const [status, setStatus] = useState('setup');
    const [interviewData, setInterviewData] = useState(null);
    const [currentQIndex, setCurrentQIndex] = useState(0);
    const [showTextState, setShowTextState] = useState([false, false, false, false]);
    const [userAnswers, setUserAnswers] = useState([]);

    const [isRecording, setIsRecording] = useState(false);
    const [timer, setTimer] = useState(0);
    const [currentTranscript, setCurrentTranscript] = useState('');

    const [finalEvaluation, setFinalEvaluation] = useState(null);
    const [interviewHistory, setInterviewHistory] = useState([]);
    const [isDbLoaded, setIsDbLoaded] = useState(false);
    const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
    const [apiError, setApiError] = useState('');

    const [audioContextParts, setAudioContextParts] = useState([]);

    const audioRef = useRef(null);
    const recognitionRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const transcriptBufferRef = useRef('');
    const timerIntervalRef = useRef(null);

    const liveTranscriptRef = useRef('');
    const timerRef = useRef(0);

    const interviewerVoice = 'Puck';

    const playSimpleSpeech = (t, onEndCb) => {
        const s = window.speechSynthesis;
        s.cancel();
        const u = new SpeechSynthesisUtterance(t);
        u.lang = 'en-US';
        u.onend = onEndCb;
        s.speak(u);
    };

    useEffect(() => {
        (async () => {
            setInterviewHistory(await DBUtils.get('interview_history', []));
            setIsDbLoaded(true);
        })();

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';
            recognition.onresult = (e) => {
                let finalT = ''; let interT = '';
                for (let i = e.resultIndex; i < e.results.length; ++i) {
                    if (e.results[i].isFinal) finalT += e.results[i][0].transcript;
                    else interT += e.results[i][0].transcript;
                }
                const full = transcriptBufferRef.current + finalT + interT;
                liveTranscriptRef.current = full;
                setCurrentTranscript(full);
                if (finalT) transcriptBufferRef.current += finalT + ' ';
            };
            recognitionRef.current = recognition;
        }
        return () => { if (recognitionRef.current) recognitionRef.current.abort(); clearInterval(timerIntervalRef.current); };
    }, []);

    const generateInterview = async () => {
        PreloadPipeline.abortCurrent();
        setApiError('');

        if (PreloadPipeline.cache.interview) {
            setInterviewData(PreloadPipeline.cache.interview);
            PreloadPipeline.cache.interview = null;
            setUserAnswers([]); setCurrentQIndex(0); setShowTextState([false, false, false, false]); setStatus('ready');
            return;
        }

        setStatus('generating');
        try {
            const prompt = `Generate a 4-question TOEFL mock interview on a random specific topic. 
      Progression: Q1(Personal experience), Q2(Opinion/Choice), Q3(Broader social/campus impact), Q4(Complex trade-offs/Future prediction). 
      Return JSON: {"topic": "...", "questions": ["...", "...", "...", "..."]}`;

            const schema = {
                type: "OBJECT",
                properties: {
                    topic: { type: "STRING" },
                    questions: { type: "ARRAY", items: { type: "STRING" } }
                },
                required: ["topic", "questions"]
            };

            const data = await fetchGeminiText(prompt, 0.9, 800, schema);

            const qsWithAudio = data.questions.map(q => ({ text: q, audioUrl: null }));
            qsWithAudio[0].audioUrl = await fetchNeuralTTS(interviewerVoice, qsWithAudio[0].text);

            setInterviewData({ topic: data.topic, questions: qsWithAudio });
            setUserAnswers([]); setCurrentQIndex(0); setShowTextState([false, false, false, false]); setStatus('ready');
        } catch (e) {
            setApiError("生成考卷失败，可能是网络原因或频率受限，请稍后重试。");
            setStatus('setup');
        }
    };

    const startInterview = () => {
        setStatus('interviewing');
        playQuestionAudio(0);
    };

    const playQuestionAudio = async (index) => {
        let url = interviewData.questions[index].audioUrl;
        if (!url) {
            url = await fetchNeuralTTS(interviewerVoice, interviewData.questions[index].text);
            setInterviewData(prev => {
                const newQs = [...prev.questions];
                newQs[index] = { ...newQs[index], audioUrl: url };
                return { ...prev, questions: newQs };
            });
        }
        if (audioRef.current && url) {
            audioRef.current.src = url;
            try {
                await audioRef.current.play();
            } catch (e) {
                console.warn("Audio element blocked, fallback to SpeechSynthesis");
                playSimpleSpeech(interviewData.questions[index].text, handleInterviewerAudioEnded);
            }
        } else {
            playSimpleSpeech(interviewData.questions[index].text, handleInterviewerAudioEnded);
        }
    };

    const handleInterviewerAudioEnded = async () => {
        if (status !== 'interviewing') return;
        setTimer(0);
        timerRef.current = 0;
        setCurrentTranscript('');
        transcriptBufferRef.current = '';
        liveTranscriptRef.current = '';

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            await playBeep(800, 0.1);

            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
            mediaRecorderRef.current.onstop = () => {
                const finalBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const finalUrl = URL.createObjectURL(finalBlob);
                stream.getTracks().forEach(track => track.stop());

                setUserAnswers(prev => [...prev, {
                    qIndex: currentQIndex,
                    text: liveTranscriptRef.current || "(No response)",
                    timeTaken: timerRef.current,
                    audioUrl: finalUrl,
                    audioBlob: finalBlob
                }]);
                if (currentQIndex < 3) {
                    const nextIdx = currentQIndex + 1;
                    setCurrentQIndex(nextIdx);
                    setTimeout(() => playQuestionAudio(nextIdx), 1000);
                } else evaluateEntireInterview();
            };

            mediaRecorderRef.current.start();
            if (recognitionRef.current) recognitionRef.current.start();
            setIsRecording(true);
            timerIntervalRef.current = setInterval(() => {
                setTimer(prev => {
                    const next = prev + 1;
                    timerRef.current = next;
                    return next;
                });
            }, 1000);
        } catch (err) { setApiError('无法访问麦克风。请确保授予权限。'); }
    };

    const stopAnswering = () => {
        if (!isRecording) return;
        playBeep(400, 0.15);
        clearInterval(timerIntervalRef.current);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
        if (recognitionRef.current) recognitionRef.current.stop();
        window.speechSynthesis.cancel();
        setIsRecording(false);
    };

    const evaluateEntireInterview = async () => { setStatus('evaluating'); };

    useEffect(() => {
        if (status === 'evaluating' && userAnswers.length === 4) {
            runAIEvaluation();
        }
    }, [status, userAnswers]);

    const runAIEvaluation = async () => {
        const totalTime = userAnswers.reduce((acc, curr) => acc + curr.timeTaken, 0);
        const totalWords = userAnswers.reduce((acc, curr) => {
            const words = curr.text.match(/\b\w+\b/g);
            return acc + (words ? words.length : 0);
        }, 0);

        const wps = totalTime > 0 ? (totalWords / totalTime) : 0;
        const wordsPer45s = Math.round(wps * 45);

        const safeDuration = 38;
        let targetWords = Math.floor(wps * safeDuration);
        targetWords = Math.max(45, Math.min(120, targetWords));

        let qaLog = "";
        const parts = [];
        const audioPartsForChat = [];

        for (let i = 0; i < 4; i++) {
            qaLog += `Q${i + 1}: ${interviewData.questions[i].text}\nSTT Transcript A${i + 1} (For Semantic Reference ONLY): ${userAnswers[i].text}\nTime taken for A${i + 1}: ${userAnswers[i].timeTaken}s\n\n`;
            if (userAnswers[i].audioBlob) {
                const base64Audio = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(userAnswers[i].audioBlob);
                });
                const mimeType = userAnswers[i].audioBlob.type || 'audio/webm';
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
            type: "OBJECT",
            properties: {
                score: { type: "INTEGER" },
                timeAnalysis: { type: "STRING" },
                overallFeedback: { type: "STRING" },
                speedAnalysis: { type: "STRING" },
                detailedAnalysis: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            question: { type: "STRING" },
                            feedback: { type: "STRING" },
                            tailoredResponse: {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        strategy: { type: "STRING" },
                                        text: { type: "STRING" }
                                    },
                                    required: ["strategy", "text"]
                                }
                            }
                        },
                        required: ["question", "feedback", "tailoredResponse"]
                    }
                }
            },
            required: ["score", "timeAnalysis", "speedAnalysis", "overallFeedback", "detailedAnalysis"]
        };

        try {
            let data = await fetchGeminiText(parts, 0.4, 4000, schema);

            const finalData = { ...data, wordsPer45s, targetWords };
            setFinalEvaluation(finalData);

            const newHistoryItem = { id: Date.now(), type: 'interview', topic: interviewData.topic, score: finalData.score, totalTime, date: new Date().toLocaleString() };
            const updatedHistory = [newHistoryItem, ...interviewHistory];
            DBUtils.set('interview_history', updatedHistory);
            setInterviewHistory(updatedHistory);
            setStatus('result');
        } catch (e) {
            setApiError("打分生成失败，可能是网络问题或 AI 返回格式异常。请重试。");
            setStatus('setup');
        }
    };

    const getTimerColor = (sec) => {
        if (sec <= 30) return 'text-emerald-500 border-emerald-200 bg-emerald-50';
        if (sec <= 45) return 'text-amber-500 border-amber-200 bg-amber-50';
        return 'text-rose-500 border-rose-200 bg-rose-50';
    };

    const getBadgeColor = (sec) => {
        if (sec <= 30) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        if (sec <= 45) return 'bg-amber-100 text-amber-700 border-amber-200';
        return 'bg-rose-100 text-rose-700 border-rose-200';
    };

    const toggleShowText = (idx) => { const newArr = [...showTextState]; newArr[idx] = !newArr[idx]; setShowTextState(newArr); };

    const handleHistoryScroll = (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 10) {
            if (visibleHistoryCount < interviewHistory.length) setVisibleHistoryCount(prev => prev + 10);
        }
    };

    const deleteHistoryItem = (id, e) => {
        e.stopPropagation();
        const newHistory = interviewHistory.filter(item => item.id !== id);
        setInterviewHistory(newHistory);
        DBUtils.set('interview_history', newHistory);
    };

    const renderHistory = () => {
        if (!isDbLoaded || interviewHistory.length === 0) return null;
        return (
            <div className="bg-white rounded-2xl shadow-sm p-6 border border-slate-200 mt-6">
                <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center"><History className="w-5 h-5 mr-2 text-blue-500" /> 过往面试记录</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto p-1" onScroll={handleHistoryScroll}>
                    {interviewHistory.slice(0, visibleHistoryCount).map(item => (
                        <div key={item.id} className="relative p-4 border border-slate-100 bg-slate-50 rounded-xl hover:border-blue-200 transition-colors text-left group">
                            <button onClick={(e) => deleteHistoryItem(item.id, e)} className="absolute top-3 right-3 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all p-1 bg-white rounded-full shadow-sm"><Trash2 className="w-4 h-4" /></button>
                            <div className="flex justify-between items-start mb-2 pr-6">
                                <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded uppercase">{item.type}</span>
                                <span className="text-xs text-slate-400">{item.date}</span>
                            </div>
                            <h3 className="font-bold text-slate-700 mb-3 truncate" title={item.topic}>{item.topic}</h3>
                            <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-200">
                                <span className="text-slate-500 flex items-center"><Clock className="w-3 h-3 mr-1" /> {item.totalTime}s</span>
                                <span className={`font-black flex items-center ${item.score >= 25 ? 'text-green-500' : item.score >= 20 ? 'text-blue-500' : 'text-amber-500'}`}>
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
                <header className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition pb-4 border-b border-slate-300" onClick={onBack}>
                    <div className="bg-white p-2 rounded-lg shadow-sm text-slate-600"><ArrowLeft className="w-5 h-5" /></div>
                    <div><h1 className="text-xl font-bold text-slate-800">模拟面试 (Mock Interview)</h1><p className="text-slate-500 text-xs">全真模拟，压迫感训练</p></div>
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
                            <div className="w-24 h-24 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-6"><UserCheck className="w-12 h-12" /></div>
                            <h2 className="text-2xl font-bold text-slate-800 mb-4">准备好接受面试了吗？</h2>
                            <p className="text-slate-500 mb-8 max-w-lg">系统将随机生成一个常考话题，并由 AI 考官对您进行 4 轮连珠炮式的语音提问。请保证每一题的回答时长控制在合理范围（总目标 ~180秒）。</p>

                            <button onClick={generateInterview} disabled={status === 'generating'} className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold shadow-lg shadow-blue-200 transition-all transform hover:scale-105 flex items-center disabled:opacity-50 disabled:scale-100">
                                {status === 'generating' ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : null}
                                {status === 'generating' ? "考卷生成中..." : "生成考卷并入座"} <ChevronRight className="w-5 h-5 ml-2" />
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
                        <div className="inline-block bg-blue-100 text-blue-800 px-4 py-1.5 rounded-full font-bold text-sm mb-6 uppercase tracking-widest">Topic: {interviewData.topic}</div>
                        <h3 className="text-xl text-slate-700 mb-8">考官已就绪，请授权麦克风后开始面试。</h3>
                        <button onClick={startInterview} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-bold shadow-lg shadow-emerald-200 flex items-center mx-auto">
                            <Mic className="w-5 h-5 mr-2" /> 点击开始面试 (Start)
                        </button>
                    </div>
                )}

                {(status === 'interviewing' || status === 'evaluating' || status === 'result') && interviewData && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[700px]">

                        {status !== 'result' && (
                            <div className="bg-slate-800 p-4 text-white flex justify-between items-center shrink-0">
                                <div>
                                    <span className="text-slate-400 text-xs uppercase tracking-wider block mb-0.5">Current Topic</span>
                                    <strong className="text-sm md:text-base">{interviewData.topic}</strong>
                                </div>
                                <div className="bg-slate-700 px-3 py-1 rounded-full text-xs font-mono">Q: {Math.min(currentQIndex + 1, 4)} / 4</div>
                            </div>
                        )}

                        {status === 'interviewing' && (
                            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 bg-slate-50">
                                {interviewData.questions.map((q, idx) => {
                                    if (idx > currentQIndex) return null;

                                    const isCurrentAsking = idx === currentQIndex && !isRecording;
                                    const isCurrentAnswering = idx === currentQIndex && isRecording;
                                    const answer = userAnswers.find(a => a.qIndex === idx);

                                    return (
                                        <div key={idx} className="space-y-6">
                                            <div className="flex items-start max-w-[85%]">
                                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 mr-3"><Bot className="w-6 h-6" /></div>
                                                <div className="bg-white p-4 rounded-2xl rounded-tl-sm shadow-sm border border-slate-200">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="text-xs font-bold text-slate-400">Interviewer</span>
                                                        <button onClick={() => toggleShowText(idx)} className="text-slate-400 hover:text-blue-600"><Eye className="w-4 h-4" /></button>
                                                    </div>
                                                    {showTextState[idx] ? <p className="text-slate-800 text-sm md:text-base leading-relaxed">{q.text}</p> : <div className="flex flex-wrap gap-1 blur-[6px] select-none opacity-60">{q.text.split(' ').map((w, i) => <span key={i} className="bg-slate-300 text-transparent rounded px-1">{w}</span>)}</div>}
                                                    {isCurrentAsking && <div className="mt-3 flex items-center text-xs text-blue-500 font-bold animate-pulse"><Volume2 className="w-4 h-4 mr-1" /> 正在提问中...</div>}
                                                </div>
                                            </div>

                                            {isCurrentAnswering && (
                                                <div className="flex items-start flex-row-reverse max-w-[90%] ml-auto">
                                                    <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 ml-3"><Mic className="w-6 h-6" /></div>
                                                    <div className="flex flex-col items-end">
                                                        <div className={`mb-2 px-6 py-2 rounded-full border-2 font-mono text-2xl font-bold tracking-wider shadow-sm transition-colors ${getTimerColor(timer)}`}>
                                                            {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')}
                                                        </div>
                                                        <div className="bg-emerald-600 text-white p-4 rounded-2xl rounded-tr-sm shadow-md">
                                                            <div className="text-xs font-bold text-emerald-200 mb-1 flex items-center"><Mic className="w-3 h-3 mr-1" /> 你正在回答</div>
                                                            <p className="text-sm italic opacity-90">{currentTranscript || "Listening..."}</p>
                                                        </div>
                                                        <button onClick={stopAnswering} className="mt-3 px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-full text-sm font-bold shadow transition flex items-center">
                                                            结束回答 <Square className="w-3 h-3 ml-2 fill-current" />
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {answer && (
                                                <div className="flex items-start flex-row-reverse max-w-[85%] ml-auto">
                                                    <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0 ml-3"><CheckCircle2 className="w-6 h-6" /></div>
                                                    <div className="bg-slate-800 text-white p-4 rounded-2xl rounded-tr-sm shadow-md relative group">
                                                        <p className="text-sm md:text-base leading-relaxed">{answer.text}</p>
                                                        <div className={`absolute -bottom-3 -left-3 px-3 py-1 rounded-full text-[10px] font-bold border shadow-sm ${getBadgeColor(answer.timeTaken)}`}>
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
                                <p className="text-slate-500 text-sm mt-2">AI 考官正在分析您的语速并拆解策略逻辑...</p>
                            </div>
                        )}

                        {status === 'result' && finalEvaluation && (
                            <div className="flex-1 overflow-y-auto p-6 bg-white text-center">
                                <div className="mb-10 mt-6">
                                    <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-xl mb-4">
                                        <span className="text-4xl font-black">{finalEvaluation.score}</span><span className="text-lg mt-2">/30</span>
                                    </div>
                                    <h2 className="text-2xl font-bold text-slate-800">Mock Interview Result</h2>
                                    <div className="text-slate-500 text-sm mt-2">Topic: {interviewData.topic}</div>
                                </div>

                                <div className="space-y-6 text-left">
                                    <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-100 rounded-xl p-5 shadow-sm">
                                        <h3 className="text-sm font-bold text-violet-900 uppercase flex items-center mb-3">
                                            <Activity className="w-4 h-4 mr-2" /> 个人语速画像 (Speech Profile)
                                        </h3>
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                            <div>
                                                <div className="text-3xl font-black text-violet-700 font-mono tracking-tighter">
                                                    {finalEvaluation.targetWords} <span className="text-sm font-medium text-violet-500 tracking-normal">words / 题</span>
                                                </div>
                                                <p className="text-xs text-violet-600 mt-1 opacity-80">
                                                    基于您的真实语速 ({finalEvaluation.wordsPer45s}词/45s)<br />
                                                    已为您扣除 7 秒的思考与停顿安全时长
                                                </p>
                                            </div>
                                            <div className="md:text-right md:w-1/2">
                                                <div className="text-sm text-violet-800 font-bold mb-1">策略指导</div>
                                                <p className="text-xs text-violet-600 leading-relaxed">{finalEvaluation.speedAnalysis}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                                        <h3 className="text-sm font-bold text-amber-800 uppercase flex items-center mb-2"><Clock className="w-4 h-4 mr-2" /> 时间把控分析</h3>
                                        <p className="text-slate-700 text-sm leading-relaxed">{finalEvaluation.timeAnalysis}</p>
                                    </div>
                                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                                        <h3 className="text-sm font-bold text-blue-800 uppercase flex items-center mb-2"><Award className="w-4 h-4 mr-2" /> 综合评价</h3>
                                        <p className="text-slate-700 text-sm leading-relaxed">{finalEvaluation.overallFeedback}</p>
                                    </div>

                                    <div>
                                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 border-b pb-2">逐题深度解析</h3>
                                        <div className="space-y-8">
                                            {finalEvaluation.detailedAnalysis.map((item, i) => (
                                                <div key={i} className="bg-slate-50 border border-slate-200 p-5 rounded-xl">
                                                    <p className="font-bold text-slate-800 text-sm mb-3 pb-3 border-b border-slate-200">Q{i + 1}: {item.question}</p>
                                                    <p className="text-slate-600 text-sm leading-relaxed mb-4">{item.feedback}</p>

                                                    {item.tailoredResponse && item.tailoredResponse.length > 0 && (
                                                        <div className="mt-6 bg-white border border-indigo-100 rounded-lg p-5 shadow-sm">
                                                            <div className="flex items-center justify-between mb-4 pb-3 border-b border-indigo-50">
                                                                <h4 className="text-xs font-bold text-indigo-800 flex items-center">
                                                                    <Zap className="w-4 h-4 mr-1 text-amber-400 fill-amber-400" /> 专属 38s 安全容量实战拆解
                                                                </h4>
                                                                <span className="text-[10px] bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded-full font-mono font-bold border border-indigo-100">
                                                                    🎯 目标词数: ~{finalEvaluation.targetWords}
                                                                </span>
                                                            </div>
                                                            <div className="space-y-3">
                                                                {item.tailoredResponse.map((block, bIdx) => (
                                                                    <div key={bIdx} className="flex flex-col sm:flex-row gap-3 items-start group">
                                                                        <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold px-2.5 py-1 rounded shadow-sm shrink-0 mt-0.5 whitespace-nowrap group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                                                            {block.strategy}
                                                                        </span>
                                                                        <p className="text-slate-700 text-sm leading-relaxed flex-1">{block.text}</p>
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

                                <button onClick={() => setStatus('setup')} className="mt-8 w-full py-4 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold shadow-lg transition-colors">
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

export default function App() {
    const [mode, setMode] = useState('setup');
    const [preloadStatus, setPreloadStatus] = useState({ shadow: false, interview: false, listening: false, dictation: false, shadowError: false, interviewError: false, listeningError: false, dictationError: false });

    useEffect(() => {
        const handlePreloadReady = (e) => {
            if (e.detail.type === 'shadow') setPreloadStatus(s => ({ ...s, shadow: true, shadowError: false }));
            if (e.detail.type === 'interview') setPreloadStatus(s => ({ ...s, interview: true, interviewError: false }));
            if (e.detail.type === 'listening') setPreloadStatus(s => ({ ...s, listening: true, listeningError: false }));
            if (e.detail.type === 'dictation') setPreloadStatus(s => ({ ...s, dictation: true, dictationError: false }));
        };
        const handlePreloadError = (e) => {
            if (e.detail.type === 'shadow') setPreloadStatus(s => ({ ...s, shadowError: true }));
            if (e.detail.type === 'interview') setPreloadStatus(s => ({ ...s, interviewError: true }));
            if (e.detail.type === 'listening') setPreloadStatus(s => ({ ...s, listeningError: true }));
            if (e.detail.type === 'dictation') setPreloadStatus(s => ({ ...s, dictationError: true }));
        };

        window.addEventListener('preload-ready', handlePreloadReady);
        window.addEventListener('preload-error', handlePreloadError);
        return () => {
            window.removeEventListener('preload-ready', handlePreloadReady);
            window.removeEventListener('preload-error', handlePreloadError);
        };
    }, []);

    useEffect(() => {
        if (mode !== 'setup') {
            const timer = setTimeout(() => {
                // 修复：将旧版默认的字数 10 改为现在的长度级别 L3，防止首次进入因缓存参数不匹配导致强制重新生成
                try { queueShadowPreload(3, "general daily English", 5, 'Aoede'); } catch (e) { }
                try { queueInterviewPreload('Puck'); } catch (e) { }
                try { queueListeningPreload(); } catch (e) { }
                try { queueDictationPreload(); } catch (e) { }
            }, 800);
            return () => clearTimeout(timer);
        }
    }, [mode]);

    if (mode === 'setup') return <DeviceSetupModule onComplete={() => setMode('main_menu')} />;
    if (mode === 'main_menu') return <MainMenuModule onNavigate={setMode} />;

    if (mode === 'speaking_menu') return <SpeakingMenuModule onNavigate={setMode} onBack={() => setMode('main_menu')} preloadStatus={preloadStatus} />;
    if (mode === 'listening_menu') return <ListeningMenuModule onNavigate={setMode} onBack={() => setMode('main_menu')} preloadStatus={preloadStatus} />;

    if (mode === 'shadow') return <ShadowingModule onBack={() => setMode('speaking_menu')} />;
    if (mode === 'interview') return <InterviewModule onBack={() => setMode('speaking_menu')} />;
    if (mode === 'listening_practice') return <ListeningPracticeModule onBack={() => setMode('listening_menu')} />;
    if (mode === 'listening_dictation') return <ListeningDictationModule onBack={() => setMode('listening_menu')} />;

    return null;
}