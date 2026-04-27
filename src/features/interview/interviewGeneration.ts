import {
  fetchGeminiText,
  fetchNeuralTTS
} from '../../services/llm/helpers';

export const INTERVIEW_PROMPT_VERSION = '2026-take-an-interview-v1';

export const INTERVIEW_QUESTION_ROLES = [
  'personal_anchor',
  'personal_choice',
  'broad_opinion',
  'future_or_tradeoff'
] as const;

export type InterviewQuestionRole = (typeof INTERVIEW_QUESTION_ROLES)[number];

export interface InterviewPromptPayload {
  topic: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
}

export interface InterviewQuestion {
  role: InterviewQuestionRole;
  text: string;
  audioUrl: string | null;
}

export interface InterviewSessionData {
  topic: string;
  questions: InterviewQuestion[];
}

interface GenerateInterviewSessionOptions {
  voice: string;
  scopeId: string;
  signal?: AbortSignal | null;
  supersedeKey: string;
  firstTtsSupersedeKey: string;
  isBackground?: boolean;
  seed?: string;
  mode?: string;
}

export const INTERVIEW_GENERATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    topic: { type: 'STRING' },
    q1: { type: 'STRING' },
    q2: { type: 'STRING' },
    q3: { type: 'STRING' },
    q4: { type: 'STRING' }
  },
  required: ['topic', 'q1', 'q2', 'q3', 'q4']
};

export const createInterviewRandomSeed = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const buildInterviewPrompt = (seed: string) => `You are generating one complete 2026 TOEFL iBT Speaking "Take an Interview" task.

Task identity:
- This is the updated 2026 TOEFL iBT interview task.
- It is not the old independent speaking task.
- It is not an integrated speaking task.
- It is not a generic conversation exercise.

Topic selection:
- Choose exactly one topic from the full legitimate range of natural situations that can appear in this task.
- Expand your choice across that full range and let the seed push you away from default high-frequency safe picks.
- Select the topic directly.
- The topic must be concrete, singular, and immediately imaginable as one real situation.
- Do not use an abstract umbrella name or a broad subject name.

Question order:
- Q1 must anchor the interview in the test taker's personal reality. Ask about a current situation, a recent experience, a usual practice, or a personal method related to the topic.
- Q2 must stay on the personal level but move into a personal choice, preference, comparison, reaction, or personal trade-off related to the same topic.
- Q3 must widen the lens. Ask for a position on a related practice, change, or phenomenon, and require supporting reasons.
- Q4 must raise the level again. Ask about future effects, a policy judgment, an advantages-versus-disadvantages decision, or a higher-level consequence. It must not fall back to a pure personal-experience question.

Writing style:
- Every question must sound like a natural interviewer speaking.
- Each question must be concise, spoken-style English that can be answered immediately.
- Do not include numbering in the output.
- Do not include role labels in the output.
- Do not include explanations or meta instructions.
- Do not use old TOEFL template wording.
- The four questions must feel like progressive follow-up questions on the same topic, not four loosely connected questions.

Randomness:
- Use this randomness seed only to diversify the topic choice across the full task range: "${seed}".
- Do not mention the seed in the output.

One-pass requirement:
- There will be no downstream semantic correction step.
- Produce the final topic and all four questions carefully in one pass.

Return JSON exactly as {"topic":"...","q1":"...","q2":"...","q3":"...","q4":"..."}`;

const readTextField = (payload: Record<string, unknown>, key: keyof InterviewPromptPayload) => {
  const value = payload[key];
  if (typeof value !== 'string') {
    throw new Error(`Interview payload field "${key}" must be a string.`);
  }
  return value.trim();
};

export const mapInterviewPayloadToSession = (
  payload: Record<string, unknown>
): InterviewSessionData => {
  const topic = readTextField(payload, 'topic');
  const q1 = readTextField(payload, 'q1');
  const q2 = readTextField(payload, 'q2');
  const q3 = readTextField(payload, 'q3');
  const q4 = readTextField(payload, 'q4');

  return {
    topic,
    questions: [
      { role: 'personal_anchor', text: q1, audioUrl: null },
      { role: 'personal_choice', text: q2, audioUrl: null },
      { role: 'broad_opinion', text: q3, audioUrl: null },
      { role: 'future_or_tradeoff', text: q4, audioUrl: null }
    ]
  };
};

export const generateInterviewSession = async ({
  voice,
  scopeId,
  signal = null,
  supersedeKey,
  firstTtsSupersedeKey,
  isBackground = false,
  seed = createInterviewRandomSeed()
}: GenerateInterviewSessionOptions): Promise<InterviewSessionData> => {
  const prompt = buildInterviewPrompt(seed);
  const payload = await fetchGeminiText<InterviewPromptPayload>(
    prompt,
    0.9,
    900,
    INTERVIEW_GENERATION_SCHEMA,
    signal,
    null,
    {
      scopeId,
      supersedeKey,
      isBackground,
      origin: isBackground ? 'preload' : 'ui',
      sceneKey: 'interview:generate',
      disableJsonFixer: true,
      businessContext: {
        task: 'interview',
        promptVersion: INTERVIEW_PROMPT_VERSION
      }
    }
  );

  const sessionData = mapInterviewPayloadToSession(payload as unknown as Record<string, unknown>);
  sessionData.questions[0].audioUrl = await fetchNeuralTTS(
    voice,
    sessionData.questions[0].text,
    signal,
    {
      scopeId,
      supersedeKey: firstTtsSupersedeKey,
      origin: isBackground ? 'preload' : 'ui',
      sceneKey: 'interview:first-tts',
      isBackground
    }
  );

  return sessionData;
};
