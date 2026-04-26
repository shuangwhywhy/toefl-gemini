import {
  generateInterviewSession,
  INTERVIEW_PROMPT_VERSION,
  type InterviewSessionData
} from '../features/interview/interviewGeneration';
import {
  INTERVIEW_TRAINING_STAGES,
  type InterviewTrainingSession,
  type InterviewTrainingStage,
  type StageState
} from '../features/interview/types';
import { InterviewTrainingSessionSchema } from '../features/interview/training/schema';
import { PreloadPipeline } from './preload/orchestrator';
import {
  createInterviewTrainingSession,
  loadActiveInterviewTrainingSession
} from './interviewTrainingPersistence';

type SessionSource = 'preload_cache' | 'fresh_generation';

export type LoadOrCreateTrainingSessionResult =
  | {
      kind: 'restored';
      session: InterviewTrainingSession;
    }
  | {
      kind: 'created_from_preload';
      session: InterviewTrainingSession;
    }
  | {
      kind: 'created_fresh';
      session: InterviewTrainingSession;
    }
  | {
      kind: 'corrupted';
      error: unknown;
      session: InterviewTrainingSession | null;
    };

export const createEmptyStage = (now: string): StageState => ({
  status: 'not_started',
  attemptIds: [],
  updatedAt: now
});

export function createEmptyStageMap(
  now: string
): Record<InterviewTrainingStage, StageState> {
  return INTERVIEW_TRAINING_STAGES.reduce(
    (stages, stage) => ({
      ...stages,
      [stage]: createEmptyStage(now)
    }),
    {} as Record<InterviewTrainingStage, StageState>
  );
}

export function createSessionFromGeneratedInterview(
  generated: InterviewSessionData,
  options: {
    source: SessionSource;
  }
): InterviewTrainingSession {
  if (!generated?.topic || !Array.isArray(generated.questions)) {
    throw new Error('Invalid generated interview payload.');
  }

  const now = new Date().toISOString();
  const questions = generated.questions.slice(0, 4).map((question, index) => ({
    id: crypto.randomUUID(),
    index,
    role: question.role,
    question: question.text,
    stages: createEmptyStageMap(now),
    currentStage: 'thinking_structure' as const,
    completedStages: [],
    createdAt: now,
    updatedAt: now
  }));

  if (questions.length !== 4 || questions.some((question) => !question.question)) {
    throw new Error('Interview training session requires four durable questions.');
  }

  return {
    id: crypto.randomUUID(),
    version: 1,
    createdAt: now,
    updatedAt: now,
    topic: generated.topic,
    questions,
    activeQuestionId: questions[0].id,
    activeStage: 'thinking_structure',
    status: 'active',
    metadata: {
      source: options.source,
      generationPromptVersion: INTERVIEW_PROMPT_VERSION
    }
  };
}

export function consumeInterviewPreloadCacheIfAvailable(): InterviewSessionData | null {
  const cached = PreloadPipeline.cache.interview as InterviewSessionData | null;
  if (!cached) {
    return null;
  }

  PreloadPipeline.cache.interview = null;
  window.dispatchEvent(
    new CustomEvent('preload-consumed', { detail: { type: 'interview' } })
  );

  return cached;
}

const hasValidActivePosition = (session: InterviewTrainingSession) =>
  session.questions.some((question) => question.id === session.activeQuestionId);

export async function loadOrCreateTrainingSession(options: {
  voice: string;
  scopeId: string;
  signal?: AbortSignal | null;
  supersedeKey?: string;
  firstTtsSupersedeKey?: string;
}): Promise<LoadOrCreateTrainingSessionResult> {
  const activeSession = await loadActiveInterviewTrainingSession();

  if (activeSession) {
    const parsed = InterviewTrainingSessionSchema.safeParse(activeSession);
    if (parsed.success && hasValidActivePosition(parsed.data)) {
      return {
        kind: 'restored',
        session: parsed.data as InterviewTrainingSession
      };
    }

    return {
      kind: 'corrupted',
      error: parsed.success
        ? new Error('Active question no longer exists in the session.')
        : parsed.error,
      session: activeSession
    };
  }

  const cachedInterview = consumeInterviewPreloadCacheIfAvailable();
  if (cachedInterview) {
    try {
      const session = createSessionFromGeneratedInterview(cachedInterview, {
        source: 'preload_cache'
      });
      await createInterviewTrainingSession(session);
      return {
        kind: 'created_from_preload',
        session
      };
    } catch (error) {
      console.warn('Interview preload cache was malformed; generating fresh session.', error);
    }
  }

  const generated = await generateInterviewSession({
    voice: options.voice,
    scopeId: options.scopeId,
    signal: options.signal ?? null,
    supersedeKey: options.supersedeKey ?? 'interview-training:generate',
    firstTtsSupersedeKey:
      options.firstTtsSupersedeKey ?? 'interview-training:first-tts',
    mode: 'manual'
  });
  const session = createSessionFromGeneratedInterview(generated, {
    source: 'fresh_generation'
  });
  await createInterviewTrainingSession(session);

  return {
    kind: 'created_fresh',
    session
  };
}

export async function createNewTrainingSession(options: {
  voice: string;
  scopeId: string;
  signal?: AbortSignal | null;
  supersedeKey?: string;
  firstTtsSupersedeKey?: string;
}): Promise<Extract<LoadOrCreateTrainingSessionResult, { kind: 'created_from_preload' | 'created_fresh' }>> {
  const cachedInterview = consumeInterviewPreloadCacheIfAvailable();
  if (cachedInterview) {
    try {
      const session = createSessionFromGeneratedInterview(cachedInterview, {
        source: 'preload_cache'
      });
      await createInterviewTrainingSession(session);
      return {
        kind: 'created_from_preload',
        session
      };
    } catch (error) {
      console.warn('Interview preload cache was malformed; generating fresh session.', error);
    }
  }

  const generated = await generateInterviewSession({
    voice: options.voice,
    scopeId: options.scopeId,
    signal: options.signal ?? null,
    supersedeKey: options.supersedeKey ?? 'interview-training:new-generate',
    firstTtsSupersedeKey:
      options.firstTtsSupersedeKey ?? 'interview-training:new-first-tts',
    mode: 'manual'
  });
  const session = createSessionFromGeneratedInterview(generated, {
    source: 'fresh_generation'
  });
  await createInterviewTrainingSession(session);

  return {
    kind: 'created_fresh',
    session
  };
}
