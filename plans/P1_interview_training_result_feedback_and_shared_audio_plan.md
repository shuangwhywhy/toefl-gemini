# P1 实施计划书：Interview Training 结果反馈卡片与共享音频组件化

## 0. 文档目的

本文档用于指导 `toefl-gemini` 项目在 `fix/p0-hardening` 之后进入下一阶段实现。

P0 已经完成并 harden 的核心能力是：

- Interview Training 题面默认隐藏文字，改为语音优先。
- 用户回答默认走录音。
- 当前回答提交给 Gemini 时使用原始 audio blob，而不是先转写再评估。
- `thinking_structure` 和 `final_practice` 启用 35 / 40 / 45 秒计时策略。
- 跨题文字上下文只在关键阶段启用。
- 失败 attempt 可以 retry evaluation。
- restored session 中 stale blob URL 已经处理。

P1 的目标不是继续重写提交流程，而是把 P0 评估链路产出的结构化结果，变成用户真正能理解、能复练、能推进下一步训练的产品体验。

一句话目标：

> **把“能评估”升级成“能训练”。**

---

# 1. 当前基础与问题判断

## 1.1 当前已经具备的基础

当前分支已经具备以下 P1 前置条件：

### 1.1.1 评估结果已经包含结构化字段

`evaluateInterviewTrainingStage` 会把模型返回的结构化字段合并进 `details`，包括：

- `displayTranscript`
- `displayTranscriptSegments`
- `timeAnalysis`
- `questionComprehensionAnalysis`
- `crossQuestionConsistency`

这意味着 P1 不需要重新设计评估主链路，只需要把这些字段稳定渲染成 UI。

### 1.1.2 当前 prompt 已要求 audio submission 必须返回 transcript

`buildTrainingEvaluationPrompt` 已经明确要求 audio answer 必须返回 `displayTranscript` 或 `displayTranscriptSegments`，用于 UI 展示和未来跨题上下文。

### 1.1.3 Cross-question context 已经收紧

当前 `interviewTrainingContext.ts` 已经只允许 `evaluating` / `evaluated` 状态的 attempt 进入跨题上下文，并且不再使用 12 小时过期规则。

### 1.1.4 题面音频恢复问题已经处理

restored session 中的 `blob:` prompt audio URL 会被清掉，避免刷新后引用失效 object URL。

## 1.2 当前仍然薄弱的地方

P0 的实现已经能跑通主链路，但结果体验仍然偏“工程原型”：

1. `LatestFeedbackPanel` 承载了太多职责：主反馈、transcript、timing、listening check、cross-question consistency、details JSON 都混在一个组件里。
2. 45 秒 cutoff 目前只是基础展示，没有形成稳定的独立训练视图。
3. `timeAnalysis`、`questionComprehensionAnalysis`、`crossQuestionConsistency` 没有独立卡片，用户不容易一眼看出该怎么改。
4. Shadowing 和 Interview Training 的音频 UI 虽然有 shared component 雏形，但 Shadowing 还没有正式迁移，后续会产生 UI 分叉和维护成本。
5. P1 级别 UI tests 还需要补齐，防止之后继续迭代时回退。

---

# 2. P1 总目标

P1 的目标分成两个层面。

## 2.1 产品目标

用户完成一次语音回答后，应当能清楚看到：

1. 自己是否控制在理想时间内。
2. 45 秒前讲了什么，45 秒后讲了什么。
3. 45 秒后的内容在真实考试中可能来不及被评分。
4. 自己是否真正通过听题理解题干，而不是依赖题面文字。
5. 当前回答和其他已回答题目之间是否有逻辑不一致。
6. 下一步应该练哪个阶段、为什么练。

## 2.2 工程目标

1. 将 `LatestFeedbackPanel` 从“大杂烩组件”拆成稳定的结果卡片系统。
2. 将 transcript cutoff 展示封装成独立组件。
3. 将 timing / listening / consistency 三类分析封装成独立卡片。
4. 保持 P0 提交流程不动，避免重新打开 raw audio evaluation 主链路。
5. 正式推进 Shadowing 与 Interview Training 的共享音频组件统一。
6. 补充 P1 结果 UI 测试。

---

# 3. P1 范围

## 3.1 本阶段包含

P1 包含以下 5 个模块：

```txt
P1-A: Result UI 组件拆分
P1-B: Timed Transcript / 45s cutoff 可视化
P1-C: Timing / Listening / Consistency 三张训练反馈卡
P1-D: Shadowing 迁移到 shared prompt audio component
P1-E: P1 UI tests
```

## 3.2 本阶段不包含

以下内容暂不进入 P1：

```txt
P2: 更细粒度逐词 timestamp transcript
P2: 移动端麦克风兼容 polish
P2: 长音频限流与压缩
P2: 多 voice / 多语言 TTS 配置
P2: session-level dashboard
P2: 自动跳转下一题
P2: 跨 session 历史趋势分析
```

原因很简单：P1 要先把单次练习结果做成可训练闭环，不要过早扩张到平台能力。

---

# 4. 推荐分支与 PR 拆分

## 4.1 推荐 base branch

```txt
fix/p0-hardening
```

P0 hardening 已经补齐主链路，P1 应基于它继续。

## 4.2 推荐拆成两个 PR

### PR 1：结果反馈卡片

```txt
feat/interview-training-result-feedback-cards
```

内容：

- 拆 `LatestFeedbackPanel`
- 新增 `TimedTranscriptView`
- 新增三张分析卡片
- 补 result UI tests

### PR 2：共享音频组件迁移

```txt
refactor/shared-prompt-audio-shadowing
```

内容：

- 扩展 shared audio props
- Shadowing 顶部音频 UI 迁移到 shared component
- 补 shared audio / Shadowing 回归测试

推荐先做 PR 1，再做 PR 2。

原因是 PR 1 用户价值最大，且风险较低；PR 2 涉及 Shadowing 回归，适合单独 review。

---

# 5. P1-A：Result UI 组件拆分

## 5.1 目标

将 `LatestFeedbackPanel` 从综合渲染组件拆成“容器 + 子卡片”的结构。

当前目标文件：

```txt
src/features/interview/training/components/LatestFeedbackPanel.tsx
```

新增文件：

```txt
src/features/interview/training/components/TimedTranscriptView.tsx
src/features/interview/training/components/TimeAnalysisCard.tsx
src/features/interview/training/components/QuestionComprehensionCard.tsx
src/features/interview/training/components/CrossQuestionConsistencyCard.tsx
src/features/interview/training/components/evaluationDetails.ts
```

其中 `evaluationDetails.ts` 用来放解析 helper，避免每个卡片都重复判断 unknown object。

## 5.2 建议组件结构

```tsx
<LatestFeedbackPanel>
  <MainFeedbackSummary />
  <AIRecommendationCard />
  <TimeAnalysisCard />
  <QuestionComprehensionCard />
  <CrossQuestionConsistencyCard />
  <TimedTranscriptView />
  <RawDetailsDisclosure />
</LatestFeedbackPanel>
```

`LatestFeedbackPanel` 只负责：

- 判断是否有 evaluation。
- 展示 score / mainIssue / feedbackSummary。
- 布局子卡片。
- 保留 raw details 折叠区，便于调试。

不要再在 `LatestFeedbackPanel` 里写大量字段解析逻辑。

## 5.3 evaluationDetails helper

新增：

```txt
src/features/interview/training/components/evaluationDetails.ts
```

建议导出：

```ts
export const isRecord = (value: unknown): value is Record<string, unknown>;

export function readEvaluationDetails(
  evaluation: StageEvaluation
): Record<string, unknown>;

export function readTranscriptDetails(details: Record<string, unknown>): {
  displayTranscript?: string;
  displayTranscriptSegments?: TranscriptSegment[];
};

export function readTimeAnalysis(details: Record<string, unknown>): TimeAnalysis | null;

export function readQuestionComprehensionAnalysis(
  details: Record<string, unknown>
): QuestionComprehensionAnalysis | null;

export function readCrossQuestionConsistency(
  details: Record<string, unknown>
): CrossQuestionConsistency | null;
```

这样各组件只依赖明确的数据读取函数。

---

# 6. P1-B：TimedTranscriptView

## 6.1 目标

为 voice-first 训练建立清晰的 45 秒边界反馈。

用户应该能一眼看到：

- 哪些内容在 45 秒前。
- 哪些内容在 45 秒后。
- 45 秒后内容不是无意义，但在真实 TOEFL 场景中可能无法计入评分。

## 6.2 输入设计

```ts
type TimedTranscriptViewProps = {
  displayTranscript?: string;
  displayTranscriptSegments?: TranscriptSegment[];
  durationSec?: number;
};
```

也可以直接传 `details`：

```ts
type TimedTranscriptViewProps = {
  details: Record<string, unknown>;
  durationSec?: number;
};
```

推荐第一种，组件更纯。

## 6.3 渲染规则

### 情况 A：有 `displayTranscriptSegments`

按 segments 渲染。

规则：

1. segment 正常显示：
   - `afterCutoff === false`：正常文本。
   - `afterCutoff === true`：弱化文本，例如灰色、低透明度、可删除线。

2. 插入 cutoff marker：
   - 在第一个 `afterCutoff === true` 的 segment 前插入。
   - 如果没有 `afterCutoff`，但 `startSec >= 45`，也插入。
   - marker 文案：

```txt
45s cutoff
Content below may be too late for real scoring.
```

3. 时间标签：
   - 每个 segment 可显示轻量时间，例如 `[0–8s]`。
   - 不要让时间标签喧宾夺主。

### 情况 B：只有 `displayTranscript`

显示完整 transcript。

如果 `durationSec > 45`：

- 显示 approximate notice：

```txt
45s cutoff marker unavailable because segment timestamps were not returned.
Review pacing using the timing card above.
```

不要硬按字符切割，P1 阶段可以先不做伪精确切分。

原因：按字数估算 45 秒位置容易误导用户。

### 情况 C：没有 transcript

不渲染组件，或者显示轻量 fallback：

```txt
Transcript unavailable. Retry evaluation if needed.
```

但在 P0 hardening 后，audio evaluation 缺 transcript 会 throw，因此正常情况下不会出现。

## 6.4 样式建议

- 容器：白底、浅边框、圆角。
- cutoff marker：红/橙色虚线分割。
- after cutoff 内容：`text-slate-400` + `line-through decoration-rose-300`。
- 不要大面积红色，避免给用户过度挫败感。

---

# 7. P1-C：三张训练反馈卡

## 7.1 TimeAnalysisCard

### 输入

```ts
type TimeAnalysisCardProps = {
  analysis: TimeAnalysis | null;
  timingEnabled?: boolean;
};
```

### 展示字段

来自 `details.timeAnalysis`：

```ts
durationSec
cutoffSec
category
beforeCutoffSummary
afterCutoffSummary
pacingAdvice
```

### UI 信息层级

第一层：状态结论

```txt
Timing: Good window · 38s
```

第二层：45 秒前内容

```txt
Before 45s: ...
```

第三层：45 秒后内容，如果存在

```txt
After 45s: ...
```

第四层：下一步建议

```txt
Pacing advice: ...
```

### category 映射

```ts
too_short -> Build toward 35s
good -> Ideal window
slightly_long -> Wrap it up
overtime -> Over 45s
```

### 注意

如果当前 stage 不是 timed stage，但模型返回了 `timeAnalysis`，组件应通过 `timingEnabled?: boolean` 进入简化展示模式，避免在 `english_units` / `full_english_answer` / `vocabulary_upgrade` 里过度强调 45 秒压力。

简化展示模式建议只显示：

- durationSec
- 简短 pacingAdvice
- 非考试限时阶段提示

不要突出 45 秒 cutoff，也不要使用强警示色。Prompt 层也应继续约束：非 timed stage 不要过度做 45 秒分析。

---

## 7.2 QuestionComprehensionCard

### 目标

让用户知道自己这次回答是否更像“听题后回答”，还是“看题面文字后回答”。

### 输入

```ts
type QuestionComprehensionCardProps = {
  analysis: QuestionComprehensionAnalysis | null;
};
```

### 展示字段

```ts
promptTextVisibleOnSubmit
promptTextWasEverShown
promptListenCount
likelyAnsweredFromListening
evidence
```

### 展示文案

如果 `likelyAnsweredFromListening = true`：

```txt
Listening check: likely answered from listening
```

如果为 false：

```txt
Listening check: may have relied on visible text
```

附加 metadata：

```txt
Prompt text visible on submit: Yes / No
Prompt was ever shown: Yes / No
Completed listens: N
```

### 产品意义

这张卡是 Interview Training 和普通口语练习最大的区别之一。

它强化的是“听懂 interviewer prompt”能力，而不是单纯背答案。

---

## 7.3 CrossQuestionConsistencyCard

### 目标

让用户知道四题回答是否像同一个人在同一场 interview 中连续作答。

### 输入

```ts
type CrossQuestionConsistencyCardProps = {
  consistency: CrossQuestionConsistency | null;
};
```

### 展示字段

```ts
includedQuestionIds
contradictions
consistencySummary
suggestedFix
```

### 渲染规则

不要只根据 `crossQuestionConsistency` 对象是否存在来判断是否有上下文，因为 prompt schema 可能总是返回这个对象。应以 `includedQuestionIds` 作为真实 context 判断依据。

如果 `includedQuestionIds.length === 0`，当作无 context / 无可分析对象：

```txt
Cross-question consistency will appear after other answered questions are available.
```

如果 `includedQuestionIds.length > 0 && contradictions.length === 0`，当作有 context 且无明显矛盾：

```txt
No obvious contradictions across answered questions.
```

如果 `contradictions.length > 0`，展示矛盾列表和 suggestedFix：

```txt
Contradictions found:
1. ...
2. ...
Suggested fix: ...
```

这样可以避免 UI 把“没有上下文”误展示成“一致性分析通过”。

### 注意

这张卡只在 `thinking_structure` 和 `final_practice` 的结果里最有意义。

中间阶段如果没有 consistency，不要强行显示空卡。

---

# 8. P1-D：Shadowing 迁移到 Shared PromptAudioPanel

## 8.1 目标

正式统一 Interview Training 与 Shadowing 的题面/文本音频播控体验。

当前 shared files：

```txt
src/features/shared/audio/PromptAudioPanel.tsx
src/features/shared/audio/usePromptAudioPlayer.ts
src/features/shared/audio/HighlightedPromptText.tsx
```

需要迁移：

```txt
src/features/shadowing/ShadowingModule.tsx
```

## 8.2 为什么 P1 要做

总计划要求 Interview 的题面顶部 UI/UX 复用 Shadowing 的播放、暂停、重播、语速、显示/隐藏文字、播放计数等体验。P0 为了快速落地，可以先让 Interview 使用 shared component；P1 就应该反过来把 Shadowing 正式迁过去，避免长期两套 UI。

## 8.3 PromptAudioPanel props 扩展

当前 `PromptAudioPanel` 偏 Interview prompt 语境。P1 可以扩展为更通用：

```ts
type PromptAudioPanelProps = {
  text: string;
  showText: boolean;
  listenCount: number;
  audioUrl?: string;
  audioStatus?: 'idle' | 'loading' | 'ready' | 'failed';

  title?: string;
  label?: string;
  hiddenTextLabel?: string;
  playButtonLabel?: string;
  resumeButtonLabel?: string;
  replayButtonLabel?: string;
  listenCountLabel?: string;

  showListenCount?: boolean;
  showSpeedControl?: boolean;
  showTextToggle?: boolean;
  highlightText?: boolean;

  onShowTextChange: (showText: boolean) => void;
  onEnsureAudio: () => Promise<string | null>;
  onPlaybackStarted: () => void;
  onListenCompleted: () => void;
};
```

Interview 使用：

```tsx
<PromptAudioPanel
  title="Audio prompt"
  hiddenTextLabel="Prompt text hidden"
  playButtonLabel="Play prompt"
  ...
/>
```

Shadowing 使用：

```tsx
<PromptAudioPanel
  title="Listen and shadow"
  hiddenTextLabel="Text hidden"
  playButtonLabel="Play audio"
  ...
/>
```

## 8.4 迁移原则

1. 不重写 Shadowing 业务逻辑。
2. 不改变 Shadowing 的核心训练行为。
3. 只替换音频播放 / 文本显示 / 语速控制 UI。
4. 如果 Shadowing 有特殊需求，通过 props 扩展 shared component。
5. 不要在 Shadowing 内复制一份新的 player。

## 8.5 风险

- Shadowing 原有播放状态可能和 shared hook 状态不完全一致。
- 如果 Shadowing 有录音/评估与播放耦合，需要谨慎拆开。
- 自动播放限制在浏览器中仍然存在，不能引入更激进 autoplay。

---

# 9. P1-E：测试计划

正式进入 P1 后，建议补测试。否则 UI 拆分和 shared audio 迁移很容易回退。

## 9.1 新增测试文件

```txt
src/test/interview-training-result-ui.test.tsx
src/test/prompt-audio-panel.test.tsx
```

## 9.2 扩展已有测试

```txt
src/test/interview-training-context.test.ts
src/test/interview-training-ui.test.tsx
```

## 9.3 测试用例

### TimedTranscriptView

覆盖：

1. 有 `displayTranscriptSegments` 时正常渲染。
2. `afterCutoff=true` 内容被弱化。
3. 第一个 cutoff segment 前出现 `45s cutoff`。
4. 只有 `displayTranscript` 时 fallback 正常。
5. 无 transcript 时不崩溃。

### TimeAnalysisCard

覆盖：

1. `good` 显示 ideal window。
2. `too_short` 显示 build toward 35s。
3. `slightly_long` 显示 wrap it up。
4. `overtime` 显示 over 45s。
5. `beforeCutoffSummary` / `afterCutoffSummary` / `pacingAdvice` 正确显示。
6. `timingEnabled=false` 时进入简化展示模式，不突出 45 秒 cutoff。

### QuestionComprehensionCard

覆盖：

1. likely answered from listening。
2. may have relied on visible text。
3. prompt visible metadata 正确显示。
4. listen count 正确显示。

### CrossQuestionConsistencyCard

覆盖：

1. `includedQuestionIds.length === 0` 时按无 context 处理。
2. `includedQuestionIds.length > 0 && contradictions.length === 0` 时显示无明显矛盾。
3. `contradictions.length > 0` 时列出矛盾和 suggested fix。

### Shared PromptAudioPanel

覆盖：

1. 默认隐藏文字。
2. 点击 show text 后显示文字。
3. play 调用 `onEnsureAudio`。
4. ended 后调用 `onListenCompleted`。
5. 语速切换存在。
6. labels 可被 props 定制。

---

# 10. 文件级实施计划

## 10.1 新增文件

```txt
src/features/interview/training/components/evaluationDetails.ts
src/features/interview/training/components/TimedTranscriptView.tsx
src/features/interview/training/components/TimeAnalysisCard.tsx
src/features/interview/training/components/QuestionComprehensionCard.tsx
src/features/interview/training/components/CrossQuestionConsistencyCard.tsx
src/test/interview-training-result-ui.test.tsx
src/test/prompt-audio-panel.test.tsx
```

## 10.2 修改文件

```txt
src/features/interview/training/components/LatestFeedbackPanel.tsx
src/features/shared/audio/PromptAudioPanel.tsx
src/features/shared/audio/usePromptAudioPlayer.ts
src/features/shadowing/ShadowingModule.tsx
src/prompts/interviewTrainingPrompts.ts
```

`interviewTrainingPrompts.ts` 只做小幅提示优化，不改主链路。

## 10.3 不应修改或谨慎修改

```txt
src/features/interview/training/InterviewTrainingMode.tsx
src/services/interviewTrainingEvaluation.ts
src/services/interviewTrainingPersistence.ts
src/features/interview/training/interviewTrainingContext.ts
```

这些属于 P0 主链路，当前已经稳定。P1 不应随意重开。

---

# 11. Prompt 小幅优化计划

P1 不需要大改 prompt，但可以让 UI 字段更稳定。

## 11.1 displayTranscriptSegments 约束

补充：

```txt
If you return displayTranscriptSegments:
- Use 3 to 8 segments when possible.
- Set afterCutoff=true for any segment mostly after 45 seconds.
- Do not create word-by-word tiny segments.
```

## 11.2 timeAnalysis 约束

补充：

```txt
Only provide detailed 45-second cutoff analysis when timing policy is enabled.
For non-timed stages, keep timing advice brief.
```

## 11.3 crossQuestionConsistency 约束

补充：

```txt
If no cross-question context is provided:
- includedQuestionIds must be []
- contradictions must be []
- consistencySummary should say no context was available
```

这可以减少 UI 里出现“假分析”的概率。

---

# 12. 验收标准

P1 完成后，应满足以下标准。

## 12.1 用户体验验收

1. 用户完成语音回答后，结果区域不再只是 JSON 或混合文本。
2. 用户能看到独立的 timing card。
3. 用户能看到独立的 listening comprehension card。
4. 用户能看到独立的 cross-question consistency card。
5. 用户能看到 transcript 中 45 秒 cutoff 分界线。
6. 45 秒后内容视觉弱化。
7. 没有跨题上下文时，UI 不误导用户说“已完成一致性分析”。
8. 有矛盾时，UI 清楚列出 contradictions。
9. 无矛盾时，UI 给出正向但不过度夸张的反馈。
10. Raw details 仍可折叠查看，方便调试。

## 12.2 工程验收

1. `LatestFeedbackPanel` 不再直接解析所有 details 字段。
2. 四个新卡片组件职责清晰。
3. `TimedTranscriptView` 可独立测试。
4. `PromptAudioPanel` 支持 Interview 和 Shadowing 复用。
5. Shadowing 播放、暂停、重播、语速、显示文字不回退。
6. P0 raw audio evaluation 主链路未被改坏。
7. P1 UI tests 覆盖核心渲染路径。

---

# 13. 推荐执行顺序

## Step 1：新增 evaluationDetails helper

先写数据读取层，避免组件重复处理 unknown。

产物：

```txt
evaluationDetails.ts
```

## Step 2：实现 TimeAnalysisCard 并同步补测试

先实现 timing 展示，并覆盖 timed / non-timed 两种模式。

产物：

```txt
TimeAnalysisCard
TimeAnalysisCard tests
```

## Step 3：实现 QuestionComprehensionCard 并同步补测试

实现听题理解检查展示，并覆盖 prompt visibility / listen count / likely answered from listening。

产物：

```txt
QuestionComprehensionCard
QuestionComprehensionCard tests
```

## Step 4：实现 CrossQuestionConsistencyCard 并同步补测试

实现跨题一致性展示，并覆盖无 context、有 context 无矛盾、有矛盾三种状态。

产物：

```txt
CrossQuestionConsistencyCard
CrossQuestionConsistencyCard tests
```

## Step 5：实现 TimedTranscriptView 并同步补测试

完成 45 秒 cutoff 可视化。

优先支持 segments，再支持 displayTranscript fallback。

产物：

```txt
TimedTranscriptView
TimedTranscriptView tests
```

## Step 6：重构 LatestFeedbackPanel

把旧的 inline render 函数替换成新组件。`LatestFeedbackPanel` 只做组合、布局和 raw details 折叠。

## Step 7：PR1 收口

确认 result feedback cards 的用户体验和组件边界稳定。

## Step 8：扩展 PromptAudioPanel props

让 shared audio panel 更通用。

## Step 9：迁移 ShadowingModule

替换 Shadowing 顶部音频 UI。

## Step 10：补 shared audio tests

确保 Interview 和 Shadowing 都不会回退。

---

# 14. 风险与应对

## 风险 1：模型返回字段不稳定

应对：

- P0 已经对 audio transcript 做 hard check。
- P1 UI 对 optional fields 做 graceful fallback。
- Prompt 增加更明确字段约束。

## 风险 2：45 秒 segment 不准确

应对：

- P1 不做逐词精确承诺。
- 有 segments 就按模型返回展示。
- 没 segments 就只提示无法定位精确 cutoff，不做伪精确切分。

## 风险 3：Shadowing 迁移引入回归

应对：

- 单独 PR。
- 保留原行为验收 checklist。
- shared component 通过 props 定制，不把 Shadowing 特殊逻辑硬塞进 Interview。

## 风险 4：结果 UI 过重，用户压力大

应对：

- 卡片默认简洁。
- contradictions 只有存在时突出。
- 45 秒后内容弱化但不羞辱用户。
- 建议文案保持可操作，不做大段批评。

---

# 15. 最终建议

下一步就按这个顺序做：

```txt
1. feat/interview-training-result-feedback-cards
2. refactor/shared-prompt-audio-shadowing
```

第一步完成后，Interview Training 会从“能录音评估”变成“用户知道怎么改”。

第二步完成后，Interview 和 Shadowing 的音频体验会统一，后续维护成本会明显下降。

最关键的一点：**P1 不要重开 P0 主链路。**

现在的重点是消费评估结果、呈现训练反馈、统一音频 UI，而不是继续改 raw audio submission。
