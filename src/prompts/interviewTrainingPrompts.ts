import type {
  InterviewTrainingQuestion,
  InterviewTrainingStage
} from '../features/interview/types';

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
  transcript: string;
  durationSec?: number;
}) {
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

Stage instructions:
${stageSpecificInstruction[input.stage]}

Learner transcript:
${input.transcript || '(empty response)'}

Return this JSON shape:
{
  "score": 0-100,
  "readiness": "not_ready" | "almost_ready" | "ready",
  "mainIssue": "one short sentence",
  "feedbackSummary": "2-4 short actionable sentences",
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
  required: ['score', 'mainIssue', 'feedbackSummary', 'details']
};
