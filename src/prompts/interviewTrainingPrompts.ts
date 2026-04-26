import type {
  InterviewTrainingQuestion,
  InterviewTrainingStage,
  QuestionPromptUsage,
  TimingWindow
} from '../features/interview/types';
import type { CrossQuestionTextContext } from '../features/interview/training/interviewTrainingContext';

export const TRAINING_STAGE_LABELS: Record<InterviewTrainingStage, string> = {
  thinking_structure: 'Structure First',
  english_units: 'English Units',
  full_english_answer: 'Full Answer',
  vocabulary_upgrade: 'Vocabulary Upgrade',
  final_practice: 'Final Practice'
};

export const TRAINING_STAGE_DESCRIPTIONS: Record<InterviewTrainingStage, string> = {
  thinking_structure:
    'Use Chinese or your native language if useful. Build a fast answer structure before caring about English.',
  english_units:
    'Practice one idea unit, several units, or the whole answer in natural English.',
  full_english_answer:
    'Connect all idea units into one complete spoken English answer.',
  vocabulary_upgrade:
    'Upgrade your answer with question-specific spoken phrases and practical examples.',
  final_practice:
    'Answer the current question directly in English under exam-like pressure.'
};

export const STAGE_ORDER: InterviewTrainingStage[] = [
  'thinking_structure',
  'english_units',
  'full_english_answer',
  'vocabulary_upgrade',
  'final_practice'
];

const stageSpecificInstruction: Record<InterviewTrainingStage, string> = {
  thinking_structure: `Evaluate only the learner's thinking structure.
The learner may answer in Chinese or another native language.
Do not penalize English language quality.
Focus on speed of idea formation, clear position, logic, examples, and readiness to convert into English.
In details, include strengths, missingPoints, improvedStructure, and suggestedLogicalUnits.`,
  english_units: `The learner may practice one logical unit, multiple units, or a full answer.
Accept partial practice.
Do not require a complete answer and do not prioritize advanced vocabulary.
Focus on grammar, clarity, natural spoken English, fluency, and accurate conversion from idea to English.
In details, include unitFeedback, correctedVersion, and naturalVersion.`,
  full_english_answer: `Evaluate a complete English answer for this exact question.
Focus on completeness, coherence, timing, fluency, grammar, naturalness, and TOEFL-style answer quality.
In details, include completenessScore, coherenceScore, fluencyScore, grammarScore, timingScore, timeUsage, polishedAnswer, and bestImprovement.`,
  vocabulary_upgrade: `Generate a practical spoken vocabulary guide for this exact question and the learner's answer.
Do not provide a generic word list.
Every phrase must be useful for this question or a similar TOEFL speaking context.
Separate must-use phrases from optional advanced phrases, include avoid phrases, examples, replacements, usage notes, memory tips, and practice tasks.
In details, include mustUsePhrases, optionalAdvancedPhrases, avoidPhrases, upgradedAnswer, and practiceTasks.`,
  final_practice: `Evaluate whether the learner can answer this current question directly in English.
Identify the main bottleneck and recommend the next best training action.
Do not automatically advance the learner.
In details, include estimatedToeflSpeakingLevel, canSkipThinkingStageNextTime, mainWeakness, recommendedNextAction, and finalAdvice.`
};

export function buildTrainingEvaluationPrompt(input: {
  topic: string;
  question: InterviewTrainingQuestion;
  stage: InterviewTrainingStage;
  inputType: 'audio' | 'text';
  transcript?: string;
  durationSec?: number;
  promptUsage?: QuestionPromptUsage;
  timingWindow?: TimingWindow;
  hasRawAudio: boolean;
  crossQuestionTextContext?: CrossQuestionTextContext | null;
}) {
  const promptUsage = input.promptUsage;
  const timingWindow = input.timingWindow;
  const hasCrossQuestionContext = Boolean(input.crossQuestionTextContext?.entries.length);
  const currentAnswerInstruction = input.hasRawAudio
    ? `Current answer input:
- The learner's CURRENT answer is attached as an AUDIO part after this prompt.
- Evaluate the current answer based on that raw audio.
- Do not require or rely on a current-answer transcript as the evaluation input.
- You MUST return displayTranscript for UI display. For audio input, you should strongly prefer returning displayTranscriptSegments to enable precise timing feedback, but displayTranscript remains the mandatory base fallback.`
    : `Current answer input:
- The learner used the text fallback, so the CURRENT answer is the text below.
- Mark this as text fallback in your analysis where relevant.

Text fallback answer:
${input.transcript || '(empty response)'}`;

  return `Return strict JSON only.
Do not wrap JSON in markdown.
Do not include commentary outside JSON.
Use concise, actionable feedback.
The learner is training for TOEFL-style spoken responses.

Topic: ${input.topic}
Current question id: ${input.question.id}
Current question: ${input.question.question}
Current stage: ${input.stage} (${TRAINING_STAGE_LABELS[input.stage]})
Duration seconds: ${input.durationSec ?? 'not provided'}
Current answer has raw audio: ${input.hasRawAudio ? 'yes' : 'no'}
Prompt text visible on submit: ${promptUsage?.textVisibleOnSubmit ?? 'unknown'}
Prompt text was ever shown: ${promptUsage?.textWasEverShown ?? 'unknown'}
Prompt completed listen count: ${promptUsage?.listenCount ?? 'unknown'}
Prompt playback started count: ${promptUsage?.playbackStartedCount ?? 'unknown'}
Prompt playback completed count: ${promptUsage?.playbackCompletedCount ?? 'unknown'}
Timed answer policy enabled: ${timingWindow?.enabled ?? false}
Ideal answer window: ${
    timingWindow?.enabled
      ? `${timingWindow.idealStartSec}-${timingWindow.idealEndSec}s, soft max ${timingWindow.softMaxSec}s`
      : 'not enabled for this stage'
  }
Cross-question text context provided: ${hasCrossQuestionContext ? 'yes' : 'no'}

Stage instructions:
${stageSpecificInstruction[input.stage]}

${currentAnswerInstruction}

Additional evaluation rules:
- For audio submissions, treat the AUDIO part as the source of truth for the current answer.
- Do not use a generated display transcript as the current-answer evaluation input.
- If cross-question context is provided in a separate text part, use it only to judge whether this answer is logically consistent with other answers in the same interview set. Only populate crossQuestionConsistency if there are previous answers to compare to. Do not evaluate consistency against the current answer itself.
- Other questions' raw audio is intentionally not provided.
- If timing policy is enabled, analyze content before and after 45 seconds. In real scoring, content after 45 seconds may be too late, but training feedback should still explain its value. If timing policy is NOT enabled for the current stage, keep timingAdvice very brief or general.
- Judge whether the learner likely answered from listening by using prompt visibility, listen count, and whether the answer fits the spoken prompt naturally.
- For thinking_structure, Chinese or native-language structure is acceptable.
- For final_practice, expect a complete English answer.

Return this JSON shape:
{
  "score": 0-100,
  "readiness": "not_ready" | "almost_ready" | "ready",
  "mainIssue": "one short sentence",
  "feedbackSummary": "2-4 short actionable sentences",
  "displayTranscript": "best-effort transcript for UI display",
  "displayTranscriptSegments": [
    {
      "startSec": 0,
      "endSec": 4.2,
      "text": "segment text",
      "afterCutoff": false
    }
  ],
  "timeAnalysis": {
    "durationSec": ${input.durationSec ?? 0},
    "cutoffSec": 45,
    "category": "too_short | good | slightly_long | overtime",
    "beforeCutoffSummary": "what was communicated before 45s",
    "afterCutoffSummary": "what was added after 45s, if any",
    "pacingAdvice": "specific pacing advice"
  },
  "questionComprehensionAnalysis": {
    "promptTextVisibleOnSubmit": ${promptUsage?.textVisibleOnSubmit ?? false},
    "promptTextWasEverShown": ${promptUsage?.textWasEverShown ?? false},
    "promptListenCount": ${promptUsage?.listenCount ?? 0},
    "likelyAnsweredFromListening": true,
    "evidence": "brief evidence"
  },
  "crossQuestionConsistency": {
    "includedQuestionIds": [],
    "contradictions": [],
    "consistencySummary": "if no context provided, return empty arrays for includedQuestionIds and contradictions",
    "suggestedFix": "how to make the interview set more coherent"
  },
  "suggestedNextAction": {
    "questionId": "${input.question.id}",
    "stage": "one of thinking_structure, english_units, full_english_answer, vocabulary_upgrade, final_practice",
    "priority": "high" | "medium" | "low",
    "reason": "why this is the best next practice",
    "actionLabel": "short button label"
  },
  "details": { "stageSpecificData": "use the requested detail fields" }
}`;
}

export const TRAINING_EVALUATION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'NUMBER' },
    readiness: {
      type: 'STRING',
      enum: ['not_ready', 'almost_ready', 'ready']
    },
    mainIssue: { type: 'STRING' },
    feedbackSummary: { type: 'STRING' },
    displayTranscript: { type: 'STRING' },
    displayTranscriptSegments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          startSec: { type: 'NUMBER' },
          endSec: { type: 'NUMBER' },
          text: { type: 'STRING' },
          afterCutoff: { type: 'BOOLEAN' }
        },
        required: ['startSec', 'endSec', 'text', 'afterCutoff']
      }
    },
    timeAnalysis: {
      type: 'OBJECT',
      properties: {
        durationSec: { type: 'NUMBER' },
        cutoffSec: { type: 'NUMBER' },
        category: {
          type: 'STRING',
          enum: ['too_short', 'good', 'slightly_long', 'overtime']
        },
        beforeCutoffSummary: { type: 'STRING' },
        afterCutoffSummary: { type: 'STRING' },
        pacingAdvice: { type: 'STRING' }
      },
      required: [
        'durationSec',
        'cutoffSec',
        'category',
        'beforeCutoffSummary',
        'pacingAdvice'
      ]
    },
    questionComprehensionAnalysis: {
      type: 'OBJECT',
      properties: {
        promptTextVisibleOnSubmit: { type: 'BOOLEAN' },
        promptTextWasEverShown: { type: 'BOOLEAN' },
        promptListenCount: { type: 'NUMBER' },
        likelyAnsweredFromListening: { type: 'BOOLEAN' },
        evidence: { type: 'STRING' }
      },
      required: [
        'promptTextVisibleOnSubmit',
        'promptTextWasEverShown',
        'promptListenCount',
        'likelyAnsweredFromListening',
        'evidence'
      ]
    },
    crossQuestionConsistency: {
      type: 'OBJECT',
      properties: {
        includedQuestionIds: { type: 'ARRAY', items: { type: 'STRING' } },
        contradictions: { type: 'ARRAY', items: { type: 'STRING' } },
        consistencySummary: { type: 'STRING' },
        suggestedFix: { type: 'STRING' }
      },
      required: [
        'includedQuestionIds',
        'contradictions',
        'consistencySummary',
        'suggestedFix'
      ]
    },
    suggestedNextAction: {
      type: 'OBJECT',
      properties: {
        questionId: { type: 'STRING' },
        stage: {
          type: 'STRING',
          enum: [
            'thinking_structure',
            'english_units',
            'full_english_answer',
            'vocabulary_upgrade',
            'final_practice'
          ]
        },
        priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        reason: { type: 'STRING' },
        actionLabel: { type: 'STRING' },
        createdAt: { type: 'STRING' }
      },
      required: ['questionId', 'stage', 'priority', 'reason', 'actionLabel']
    },
    details: { type: 'OBJECT' }
  },
  required: ['score', 'mainIssue', 'feedbackSummary', 'displayTranscript', 'details']
};
