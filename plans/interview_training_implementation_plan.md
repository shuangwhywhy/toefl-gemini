# Implementation Plan: Interview Training Mode Voice-First Redesign

## 0. 背景与目标

基于 `feat/codex-interview-training-mode` 分支，本次改造的核心不是继续沿用“文本题面 + 文本输入框”的练习模式，而是把 Interview Training Mode 改成真正的口语训练体验：

- 题面默认由 AI 语音播报，文字默认隐藏。
- 题面顶部 UI/UX 完整复用 Shadowing 顶部的播放、暂停、重播、语速、显示/隐藏文字、播放计数等体验。
- 回答默认使用语音录入，文本输入只能作为非常弱的 fallback，不能是首选交互。
- 提交当前回答评估时以当前回答的原始音频文件为准，不把当前回答转写文本作为回答内容提交。
- 在关键训练阶段提交题面文字是否显示、题面音频播放次数、回答时长、跨题回答文字上下文，支持 AI 判断“是否真正听懂题干”和“四题之间是否逻辑一致”。
- 只在两个阶段做计时和跨题文字上下文评估：
  - `thinking_structure`: 母语/中文快速构思回答阶段。
  - `final_practice`: 最终英文整体回答阶段。
- 中间阶段，例如逐段翻译、英文单位练习、词汇提升，不需要提交跨题文字上下文，也不需要 35-45 秒计时压力。

---

## Pre-implementation Contract Decisions

1. Audio answer is the primary evaluation input.
   Voice-first submissions must pass raw audio Blob/File into Gemini multimodal parts.
   Transcription must not be used as the current answer input.

2. Evaluation must return display text.
   The model should return `displayTranscript` or `displayTranscriptSegments`.
   This text may be used for UI display and future cross-question context,
   but not as the current answer's evaluation input.

3. Prompt usage metadata is required.
   Each submitted attempt must include `textVisibleOnSubmit`,
   `textWasEverShown`, and `listenCount`.

4. Old sessions must be normalized.
   Missing `promptUsage`, `timingWindow`, and `answerLanguage` fields should receive defaults.

5. Recorder cancel creates no attempt.
   Only submitted recordings become `TrainingAttempt` records.

---

## 1. 当前分支现状

### 1.1 入口结构

当前分支已经把 `InterviewModule` 改成直接渲染新的 `InterviewTrainingMode`：

```tsx
export function InterviewModule({ onBack }: { onBack: () => void }) {
  return <InterviewTrainingMode onBack={onBack} />;
}
```

旧版全真模拟被保留为 `LegacyMockInterview`，新模式已经拆成 `src/features/interview/training/*` 结构。

### 1.2 当前新训练模式的问题

当前 `InterviewTrainingMode` 已经有 session、question、stage、attempt、evaluation 的基本结构，但体验和提交语义不对：

1. `CurrentQuestionPanel` 直接把题面文字 `Q{index}. {question.question}` 显示出来。
2. `StageAttemptPanel` 的首要交互是 textarea，语音录入在下方作为附属功能。
3. 语音录入后当前流程会先调用 `transcribeAudio`，再把 transcript 传给 `evaluateInterviewTrainingStage`。
4. `evaluateInterviewTrainingStage` 当前只接收 `transcript`、`durationSec` 等文本导向字段。
5. `TrainingAttempt` 类型虽然支持 `audioBlobId`，持久化层也能保存音频 blob，但评估链路没有把原始音频作为主要输入传给模型。
6. session factory 从生成的 interview questions 中只保留了文字 question，题面音频 URL / 播控状态 / 播放次数没有进入训练模式结构。

---

## 2. 目标用户体验

### 2.1 题面区域

题面区域应成为一个可复用的 “Prompt Audio Panel”，并尽量从 Shadowing 顶部 UI 抽取，而不是重新写一套：

- 默认进入每一题时自动或半自动播放 AI 题面语音。
- 文字默认隐藏。
- 用户可点按钮显示 / 隐藏题面文字。
- 用户可反复播放题面音频。
- 播放、暂停、重播、播放速度、加载状态、播放进度体验复用 Shadowing。
- 记录题面音频完整播放次数。
- 题面文字是否显示过 / 当前提交时是显示还是隐藏，都要进入评估 metadata。
- 题面支持英文题干；后续如有中文题干或双语题干，也应允许同一个组件传入 `lang` 和 TTS voice 配置。

### 2.2 回答区域

回答区域应成为一个 Voice-First Answer Panel：

- 默认只展示语音回答主 CTA。
- 文本输入框不作为主入口；可以：
  - 完全移除；或
  - 折叠到 “Use text fallback” / “键盘输入备用” 之类的次级入口。
- 用户点击开始录音后进入 recording 状态。
- 录音中可以取消：
  - 取消会停止 recorder、丢弃 chunks、停止计时、不生成 attempt、不触发评估。
- 用户结束录音后进入 recorded-preview 状态：
  - 可以试听自己的录音。
  - 可以提交。
  - 可以取消。
  - 可以重新录。
- 提交当前回答时必须提交原始音频 blob。
- 不把当前回答的转写文本作为回答内容提交给 AI。
- 如果需要 UI 回显当前回答文字，应由评估结果返回 `displayTranscript` / `transcriptSegments`，或者另开一个“仅用于显示”的后处理转写，但该文本不能作为当前回答的评估输入。
- 跨题文字上下文只提交其他题目的文字版本，并同时提交对应题目文本；其他题目的原始音频不随当前评估一起提交。

---

## 3. 数据模型改造

### 3.1 TrainingAttempt 扩展

在 `src/features/interview/types.ts` 中扩展 `TrainingAttempt`：

```ts
export type QuestionPromptUsage = {
  textVisibleOnSubmit: boolean;
  textWasEverShown: boolean;
  listenCount: number;
  playbackStartedCount?: number;
  playbackCompletedCount?: number;
};

export type TimingWindow = {
  enabled: boolean;
  idealStartSec: 35;
  idealEndSec: 40;
  softMaxSec: 45;
  category?: 'too_short' | 'good' | 'slightly_long' | 'overtime';
};

export type TrainingAttempt = {
  id: string;
  sessionId: string;
  questionId: string;
  stage: InterviewTrainingStage;
  createdAt: string;
  updatedAt: string;

  inputType: 'audio' | 'text';
  transcript?: string; // 仅兼容历史数据或 text fallback，不作为 voice-first 评估主输入
  audioBlobId?: string;
  durationSec?: number;

  answerLanguage?: 'zh' | 'en' | 'mixed' | 'unknown';
  promptUsage?: QuestionPromptUsage;
  timingWindow?: TimingWindow;

  selectedUnitIds?: string[];
  evaluationId?: string;
  status: 'recording' | 'recorded' | 'evaluating' | 'evaluated' | 'failed';
};
```

### 3.2 Question / Session 扩展

在 `InterviewTrainingQuestion` 中加入题面音频和题面使用状态：

```ts
export type InterviewTrainingQuestion = {
  id: string;
  index: number;
  role: InterviewQuestionRole;
  question: string;

  promptAudio?: {
    voice: string;
    audioUrl?: string; // object URL 只作为运行期缓存，不依赖持久化
    status?: 'idle' | 'loading' | 'ready' | 'failed';
  };

  promptUsage: {
    textVisible: boolean;
    textWasEverShown: boolean;
    listenCount: number;
    playbackStartedCount: number;
    playbackCompletedCount: number;
  };

  stages: Record<InterviewTrainingStage, StageState>;
  currentStage: InterviewTrainingStage;
  completedStages: InterviewTrainingStage[];
  recommendation?: TrainingRecommendation;
  createdAt: string;
  updatedAt: string;
};
```

注意：`audioUrl` 很可能是 `URL.createObjectURL`，刷新后不可靠。因此持久化层不应依赖它；恢复 session 后如果缺少可播放 URL，就按 `question.question` 重新请求 TTS。

### 3.3 Evaluation 扩展

在 `StageEvaluation` / `StageEvaluationResult` 中加入：

```ts
type TimeAnalysis = {
  durationSec: number;
  cutoffSec: 45;
  category: 'too_short' | 'good' | 'slightly_long' | 'overtime';
  beforeCutoffSummary: string;
  afterCutoffSummary?: string;
  pacingAdvice: string;
};

type QuestionComprehensionAnalysis = {
  promptTextVisibleOnSubmit: boolean;
  promptTextWasEverShown: boolean;
  promptListenCount: number;
  likelyAnsweredFromListening: boolean;
  evidence: string;
};

type CrossQuestionConsistency = {
  includedQuestionIds: string[];
  contradictions: string[];
  consistencySummary: string;
  suggestedFix: string;
};

type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
  afterCutoff: boolean;
};
```

这些字段进入 `details` 或提升为一等字段均可。建议先进入 `details`，避免大规模类型破坏。

---

## 4. 组件拆分与复用

### 4.1 从 Shadowing 抽取通用题面播控组件

新增：

```txt
src/features/shared/audio/PromptAudioPanel.tsx
src/features/shared/audio/usePromptAudioPlayer.ts
src/features/shared/audio/HighlightedPromptText.tsx
```

能力：

- `text`
- `audioUrl`
- `voice`
- `rate`
- `showText`
- `isPlaying`
- `isPaused`
- `isTtsLoading`
- `listenCount`
- `onShowTextChange`
- `onListenCompleted`
- `onEnsureAudio`
- `onPlaybackStarted`

Interview 和 Shadowing 都使用这套组件，避免 UI 分叉。

### 4.2 替换 CurrentQuestionPanel

把 `CurrentQuestionPanel` 从文本展示组件改成语音题面组件：

```tsx
<CurrentQuestionPanel
  topic={state.session.topic}
  question={activeQuestion}
  stage={state.session.activeStage}
  onPromptUsageChange={updatePromptUsage}
  onEnsurePromptAudio={ensureQuestionPromptAudio}
/>
```

内部使用 `PromptAudioPanel`：

- 默认 `showText=false`。
- 题面文字隐藏时不要渲染完整可读文本；可使用 blur / skeleton / hidden text chips。
- 用户点击显示后，`textWasEverShown=true`。
- 提交时读 `textVisibleOnSubmit`。

### 4.3 重写 StageAttemptPanel

将 `StageAttemptPanel` 改造成 voice-first：

```txt
StageAttemptPanel
  ├─ VoiceAnswerRecorder
  │   ├─ idle
  │   ├─ recording
  │   ├─ recorded-preview
  │   ├─ submitting/evaluating
  │   └─ error
  └─ TextFallbackPanel (collapsed, optional)
```

主路径：

- `Start Recording`
- `Cancel`
- `Finish`
- `Preview`
- `Submit`
- `Retake`
- `Discard`

中间阶段也默认使用语音，但不启用 35-45 秒计时和跨题文字上下文。

---

## 5. 录音 Hook 改造

### 5.1 useAudioRecorder 增强

当前 hook 支持 start / stop / reset，但需要补齐语义：

```ts
const {
  isRecording,
  durationSec,
  audioBlob,
  startRecording,
  stopRecording,
  cancelRecording,
  resetRecording,
  error
} = useAudioRecorder({
  enableTimer,
  onThresholdCrossed
});
```

要求：

- `cancelRecording()`：
  - 停止 recorder。
  - 停止 media tracks。
  - 清空 chunks。
  - 清空 audioBlob。
  - 重置 duration。
  - 不触发 attempt。
- `stopRecording()`：
  - 正常生成 blob。
  - 保留 duration。
- `resetRecording()`：
  - 丢弃已录完的 blob，回到 idle。
- 支持 `mimeType` 检测：
  - 优先 `audio/webm;codecs=opus`
  - fallback 到浏览器支持的格式。

### 5.2 计时器颜色与低音提示

只在以下阶段启用：

```ts
const TIMED_STAGES = new Set<InterviewTrainingStage>([
  'thinking_structure',
  'final_practice'
]);
```

颜色规则：

| 时间 | 状态 | UI 色彩 |
|---:|---|---|
| `<35s` | 太短 / warning | 黄绿色 |
| `35-40s` | 理想 | 绿色 |
| `40-45s` | 偏长但可接受 | 黄色逐渐过渡到橙色 |
| `>45s` | 超时 | 红色 |

实现：

```ts
function getTimedAnswerColor(seconds: number) {
  if (seconds < 35) return 'lime-warning';
  if (seconds < 40) return 'green-good';
  if (seconds <= 45) return 'orange-gradient';
  return 'red-overtime';
}
```

在第一次跨过 45 秒时播放低音：

```ts
playBeep(220, 0.18);
```

必须保证每次录音只响一次，不自动截断录音。

---

## 6. 提交流程改造

### 6.1 当前流程要删除的关键行为

语音提交时不要再做：

```ts
const transcribed = await transcribeAudio(...)
transcriptForEvaluation = transcribed
evaluateInterviewTrainingStage({ transcript: transcriptForEvaluation })
```

这个链路要改成：

```ts
evaluateInterviewTrainingStage({
  session,
  question,
  stage,
  audioBlob,
  durationSec,
  promptUsage,
  crossQuestionTextContext,
  attemptId,
  scopeId
})
```

### 6.2 保留音频持久化

当前 `saveTrainingAttempt(attempt, audioBlob)` 已经支持把原始音频 blob 存入 IndexedDB。继续保留，并确保：

- 提交前先保存当前 attempt + 当前回答 audio blob。
- 评估失败也保留当前录音，用户可以重试评估，不必重新录。
- `audioBlobId` 必须写回当前 attempt。
- `cleanupOldAudioBlobs` 仍可保留，但要避免删掉仍可能重试评估或生成展示转写的最新完整答案。

### 6.3 构建多模态 parts

当前回答音频使用与 Shadowing 评测一致的多模态音频 part 构建逻辑，并保持 Interview 评估层的输入契约为 `Blob` / `File` 级别的音频对象。

不要在 Interview 评估链路里新增手动 `blobToBase64` / base64 字符串转换 helper。音频 part 的封装应从 Shadowing 已有逻辑中抽取或复用，并由底层模型调用适配层处理实际请求格式。

`callStructuredGemini` 已经支持 `promptOrParts: string | Array<Record<string, unknown>>`，所以可以传：

```ts
const currentAnswerAudioPart = await buildMultimodalAudioPartFromBlob(audioBlob);

const parts = [
  { text: promptText },
  currentAnswerAudioPart,
  { text: crossQuestionTextContext }
];
```

其中：

- `currentAnswerAudioPart` 只代表当前提交的回答原始音频。
- `crossQuestionTextContext` 只包含其他题目的 `questionText` + `answerText` 文字上下文。
- 其他题目的原始音频不进入本次 `parts`。

---

## 7. 跨题文字上下文提交策略

### 7.1 仅两个阶段启用

只在以下阶段构建并提交跨题文字上下文：

```ts
const CROSS_QUESTION_CONTEXT_STAGES = new Set([
  'thinking_structure',
  'final_practice'
]);
```

其他阶段不带跨题文字上下文：

- `english_units`
- `full_english_answer`
- `vocabulary_upgrade`

### 7.2 上下文内容

提交当前回答时，payload 包含：

```ts
{
  current: {
    topic,
    questionId,
    questionIndex,
    questionText,
    stage,
    answerAudioBlob,
    durationSec,
    promptUsage: {
      textVisibleOnSubmit,
      textWasEverShown,
      listenCount
    }
  },
  previousAnsweredQuestions: [
    {
      questionId,
      questionIndex,
      questionText,
      selectedStage,
      selectedAttemptId,
      answerLanguage,
      durationSec,
      promptUsage,
      answerText,
      answerTextSource: 'display_transcript' | 'transcript_segments' | 'text_fallback'
    }
  ]
}
```

提交给模型时：

- 当前题回答以 `answerAudioBlob` 的多模态音频 part 进入请求。
- 其他题回答以 `questionText + answerText` 的文字上下文进入 prompt。
- 其他题不提交原始音频。

### 7.3 只选每题一份答案

同一道题如果中英文都有，或多个阶段都有完整回答，只提交一份文字上下文。

建议选择规则：

- 当前是 `thinking_structure`：
  - 优先选择该题最新的 `thinking_structure` 完整回答文字。
  - 如果没有，再选择该题最新完整 `final_practice` 回答文字。
- 当前是 `final_practice`：
  - 优先选择该题最新的 `final_practice` 完整回答文字。
  - 如果没有，再选择该题最新完整 `thinking_structure` 回答文字。
- 不要同时提交同一题的中文和英文两份。
- 其他题只提交“完整回答文字”的 attempt：
  - 有可用 `answerText`，来源可以是评估返回的 `displayTranscript`、`displayTranscriptSegments` 拼接结果，或 text fallback 的 `transcript`。
  - `durationSec > 0`，或 `inputType === 'text'` 且文本非空。
  - status 至少是 `evaluating` / `evaluated`，或 text fallback 已完成提交。
  - 不是被 cancel / discard 的录音。
  - 如果只有音频但还没有可用文字版本，不作为其他题跨题文字上下文提交。

### 7.4 当前题与其他题

用户提交当前题时：

- 当前题回答一定以原始音频提交。
- 其他题只提交已经有完整回答文字的题。
- 其他题的 `questionText` 必须和 `answerText` 一起提交。
- 如果其他题未答、只有草稿、或只有音频但没有可用文字版本，不提交。
- AI 要分析：
  - 当前音频回答是否和其他题文字回答前后一致。
  - 有没有价值观、事实、例子、立场上的矛盾。
  - 四题是否像同一个人在同一套 interview 中连贯作答。

---

## 8. Prompt 与 Response Schema 改造

### 8.1 buildTrainingEvaluationPrompt 新参数

```ts
buildTrainingEvaluationPrompt({
  topic,
  question,
  stage,
  durationSec,
  promptUsage,
  hasRawAudio: true,
  crossQuestionTextContext,
  timingPolicy
})
```

不要传当前回答的 `transcript` 作为主要回答内容。

### 8.2 Prompt 关键要求

对模型明确说明：

- 当前回答以 AUDIO 为准。
- 不要依赖当前回答的转写文本。
- 其他题上下文以 `questionText + answerText` 为准，不要求也不接收其他题原始音频。
- 如果提供了 display transcript，也只是模型自己生成给 UI 使用。
- 45 秒后内容在真实考试中会被忽略，但训练模式要完整分析。
- 对 45 秒后内容：
  - 可以指出其价值。
  - 也要指出真实场景中它来不及被评分。
- 判断用户是否是在看题文字回答：
  - 根据 `textVisibleOnSubmit`
  - `textWasEverShown`
  - `listenCount`
  - 回答内容与题干关键词的贴合方式
- 对 `thinking_structure` 支持中文/母语回答。
- 对 `final_practice` 要求英文整体回答。
- 只在收到跨题文字上下文时分析跨题一致性。

### 8.3 Response Schema 新增字段

```ts
{
  "score": 0-100,
  "readiness": "not_ready|almost_ready|ready",
  "mainIssue": "...",
  "feedbackSummary": "...",

  "timeAnalysis": {
    "durationSec": 0,
    "cutoffSec": 45,
    "category": "too_short|good|slightly_long|overtime",
    "beforeCutoffSummary": "...",
    "afterCutoffSummary": "...",
    "pacingAdvice": "..."
  },

  "questionComprehensionAnalysis": {
    "promptTextVisibleOnSubmit": false,
    "promptTextWasEverShown": false,
    "promptListenCount": 0,
    "likelyAnsweredFromListening": true,
    "evidence": "..."
  },

  "crossQuestionConsistency": {
    "includedQuestionIds": [],
    "contradictions": [],
    "consistencySummary": "...",
    "suggestedFix": "..."
  },

  "displayTranscriptSegments": [
    {
      "startSec": 0,
      "endSec": 4.2,
      "text": "...",
      "afterCutoff": false
    }
  ],

  "suggestedNextAction": {...},
  "details": {...}
}
```

---

## 9. 45 秒分界线 UI

### 9.1 录音中

- 明显显示递增计时器。
- 颜色按时间段变化。
- 45 秒时播放低音。
- 不自动 stop。

### 9.2 结果回显

如果 AI 返回 `displayTranscriptSegments`：

- 按时间段渲染文本。
- 在 `45s` 处插入明显视觉分界线。
- 45 秒之后的 segment：
  - 灰色或红色弱化。
  - 可加删除线。
  - 不写大段解释文字。
- 分析仍然完整覆盖 45 秒前后所有音频内容。

如果模型无法稳定返回时间戳，fallback：

- 使用完整 transcript 文本。
- 用回答总时长按字符或词数比例估算 45 秒位置。
- 同时在 audio timeline 上显示 45 秒 marker。
- 标记为 approximate，不在 UI 上给用户过多文字解释。

---

## 10. 文件级实施计划

### Phase 1: Shared audio UI extraction

修改 / 新增：

```txt
src/features/shared/audio/PromptAudioPanel.tsx
src/features/shared/audio/usePromptAudioPlayer.ts
src/features/shared/audio/HighlightedPromptText.tsx
src/features/shadowing/ShadowingModule.tsx
```

任务：

- 从 Shadowing 抽取播放、暂停、停止、重播、语速、文本显示、播放计数逻辑。
- Shadowing 自己迁移到新 shared component，确保行为不回退。
- Interview 使用同一组件渲染题面。

### Phase 2: Data model and persistence

修改：

```txt
src/features/interview/types.ts
src/features/interview/training/schema.ts
src/services/interviewTrainingPersistence.ts
src/services/interviewTrainingSessionFactory.ts
```

任务：

- 扩展 attempt metadata。
- 扩展 question prompt usage。
- session factory 保留并初始化 prompt usage。
- 对已有 IndexedDB 数据做兼容：缺字段时使用默认值。
- 不强制清库。

### Phase 3: Question prompt panel

修改：

```txt
src/features/interview/training/components/CurrentQuestionPanel.tsx
src/features/interview/training/InterviewTrainingMode.tsx
```

任务：

- 题面文字默认隐藏。
- 接入 TTS ensure/retry。
- 播放完成后增加 listenCount。
- show/hide 状态更新到 session。
- 提交时读取当前 prompt usage。

### Phase 4: Voice-first answer panel

修改：

```txt
src/features/interview/training/components/StageAttemptPanel.tsx
src/hooks/useAudioRecorder.ts
```

新增：

```txt
src/features/interview/training/components/VoiceAnswerRecorder.tsx
src/features/interview/training/components/TextFallbackPanel.tsx
src/features/interview/training/useTimedAnswer.ts
```

任务：

- 主交互改成语音。
- textarea 改成折叠 fallback，或者先隐藏。
- 支持录音中取消。
- 支持录完试听、提交、取消、重录。
- 只在 `thinking_structure` / `final_practice` 展示计时压力 UI。
- 45 秒低音只响一次。

### Phase 5: Raw audio evaluation pipeline

修改：

```txt
src/features/interview/training/InterviewTrainingMode.tsx
src/services/interviewTrainingEvaluation.ts
src/prompts/interviewTrainingPrompts.ts
src/services/callStructuredGemini.ts
```

任务：

- 删除语音提交前强制 transcription 的主路径。
- `submitAudioAttempt` 传当前回答 raw `audioBlob`。
- `evaluateInterviewTrainingStage` 接收当前回答 audio blob + metadata + cross-question text context。
- 使用 `promptOrParts` 传当前回答多模态音频 part，并复用 / 抽取 Shadowing 已有音频 part 封装逻辑。
- response schema 增加 time / comprehension / consistency / transcript segments。
- 保留 text fallback 的评估路径，但标注 inputType=text，且不作为主路径。

### Phase 6: Cross-question context

新增：

```txt
src/features/interview/training/interviewTrainingContext.ts
```

任务：

- `shouldIncludeCrossQuestionContext(stage)`。
- `selectOneCompleteAnswerPerOtherQuestion(...)`。
- 从 evaluation / attempt 中读取或拼接其他题对应 `answerText`。
- 当前题以音频 part 提交，其他已完整回答题以 `questionText + answerText` 组装文字 context。
- 中间阶段返回空 context。

### Phase 7: Result UI

修改：

```txt
src/features/interview/training/components/LatestFeedbackPanel.tsx
```

新增：

```txt
src/features/interview/training/components/TimedTranscriptView.tsx
src/features/interview/training/components/TimeAnalysisCard.tsx
src/features/interview/training/components/QuestionComprehensionCard.tsx
src/features/interview/training/components/CrossQuestionConsistencyCard.tsx
```

任务：

- 显示时间分析。
- 显示是否可能依赖题面文字。
- 显示跨题一致性。
- 显示 45 秒分界线和后半段弱化/删除线。

---

## 11. 测试计划

### 11.1 Unit tests

新增或修改：

```txt
src/test/interview-training-context.test.ts
src/test/use-audio-recorder.test.tsx
src/test/interview-training-evaluation.test.ts
src/test/interview-training-ui.test.tsx
```

覆盖：

- `thinking_structure` / `final_practice` 才构建 cross-question text context。
- 中间阶段不构建 context。
- 每个其他问题最多选一份完整回答文字。
- 同题中英文都有时只选一份。
- 取消录音不保存 attempt。
- stop 后 preview 状态可 submit / retake / discard。
- 45 秒只触发一次低音。
- `<35`、`35-40`、`40-45`、`>45` 的 timer color 正确。
- 语音提交时不调用 `requestTranscription` 作为评估输入。
- `evaluateInterviewTrainingStage` 的 parts 包含 current audio part + eligible previous questionText/answerText text context，且不包含其他题 audio part。
- 题面文字默认 hidden。
- 点击显示题面后，提交 metadata 里 `textVisibleOnSubmit` / `textWasEverShown` 正确。

### 11.2 Manual QA

- Chrome / Safari / Tauri 桌面端分别测试麦克风权限。
- 测试浏览器自动播放拦截后的降级逻辑。
- 测试刷新页面后恢复 session，题面音频可重新生成。
- 测试 4 题都回答后，final practice 能带上其他题文字上下文和对应题目文本。
- 测试中文母语回答能被识别和评估。
- 测试英文 final answer 的 45 秒 UI 分界线。

---

## 12. Acceptance Criteria

完成后应满足：

1. Interview Training 的题面默认不是文本阅读，而是 AI 语音播报。
2. 题面文字默认隐藏，用户可切换显示/隐藏。
3. 题面播控 UI/UX 与 Shadowing 顶部一致。
4. 播放次数被记录，并随关键阶段提交。
5. 回答默认是语音录入。
6. 文本输入不再是主交互。
7. 录音中可取消。
8. 录完后可试听、提交、取消、重录。
9. 语音提交给 AI 的当前回答主输入是原始音频 blob / 多模态音频 part，不是 transcription。
10. 中文母语阶段和英文最终阶段都支持语音回答。
11. `thinking_structure` 和 `final_practice` 有明显计时器。
12. `<35s` 黄绿色警告，`35-40s` 绿色，`40-45s` 黄/橙渐变，`>45s` 红色。
13. 45 秒时播放一次低音提示，但不截断录音。
14. AI 对超时/未超时部分做结构化分析。
15. UI 回显中有 45 秒视觉分界线。
16. 45 秒之后内容 UI 弱化/删除线，但 AI 完整分析。
17. 只在 `thinking_structure` 和 `final_practice` 提交跨题文字上下文。
18. 每个其他已回答问题只提交一份完整文字答案，并同时提交对应题目文本。
19. AI 能分析跨题逻辑一致性。
20. 旧 session 数据不崩溃，旧 Legacy Mock Mode 保留可用。

---

## 13. 推荐优先级

### P0

- StageAttemptPanel voice-first。
- 当前回答原始音频直接评估，移除语音主路径 transcription。
- 题面文字默认隐藏 + 题面音频播控。
- prompt usage metadata。
- 35/40/45 秒 timer + 45 秒低音。
- 仅两个阶段 cross-question text context。

### P1

- 从 Shadowing 正式抽取 shared UI，而不是复制。
- TimedTranscriptView。
- CrossQuestionConsistencyCard。
- 完整 schema / tests。

### P2

- 更细的 timestamp transcript。
- 不同 voice / language 的 TTS 配置。
- 当前回答音频 Blob 兼容性与长回答限流。
- 更精细的移动端适配。
