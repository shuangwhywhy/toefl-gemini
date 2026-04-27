import Dexie, { type Table } from 'dexie';
import type {
  InterviewTrainingSession,
  StageEvaluation,
  TrainingAttempt,
  TrainingAudioBlob
} from '../features/interview/types';

class InterviewTrainingDB extends Dexie {
  sessions!: Table<InterviewTrainingSession, string>;
  attempts!: Table<TrainingAttempt, string>;
  evaluations!: Table<StageEvaluation, string>;
  audioBlobs!: Table<TrainingAudioBlob, string>;

  constructor() {
    super('toefl_interview_training_db');

    this.version(1).stores({
      sessions: 'id, status, updatedAt',
      attempts: 'id, sessionId, questionId, stage, createdAt, updatedAt',
      evaluations: 'id, sessionId, questionId, stage, attemptId, createdAt',
      audioBlobs: 'id, sessionId, attemptId, createdAt'
    });
  }
}

export const interviewTrainingDB = new InterviewTrainingDB();

const nowIso = () => new Date().toISOString();

const normalizeTrainingAttempt = (attempt: TrainingAttempt): TrainingAttempt => ({
  ...attempt,
  answerLanguage: attempt.answerLanguage ?? 'unknown',
  promptUsage: attempt.promptUsage ?? {
    textVisibleOnSubmit: false,
    textWasEverShown: false,
    listenCount: 0,
    playbackStartedCount: 0,
    playbackCompletedCount: 0
  },
  timingWindow: attempt.timingWindow ?? {
    enabled: false,
    idealStartSec: 35,
    idealEndSec: 40,
    softMaxSec: 45
  }
});

export async function loadActiveInterviewTrainingSession(): Promise<InterviewTrainingSession | null> {
  return interviewTrainingDB.transaction(
    'rw',
    interviewTrainingDB.sessions,
    async () => {
      const activeSessions = await interviewTrainingDB.sessions
        .where('status')
        .equals('active')
        .toArray();

      if (activeSessions.length === 0) {
        return null;
      }

      const [latest, ...duplicates] = activeSessions.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      );

      if (duplicates.length > 0) {
        const archivedAt = nowIso();
        await Promise.all(
          duplicates.map((session) =>
            interviewTrainingDB.sessions.update(session.id, {
              status: 'archived',
              updatedAt: archivedAt
            })
          )
        );
      }

      return latest;
    }
  );
}

export async function saveInterviewTrainingSession(
  session: InterviewTrainingSession
): Promise<void> {
  await interviewTrainingDB.sessions.put(session);
}

export async function createInterviewTrainingSession(
  session: InterviewTrainingSession
): Promise<void> {
  await interviewTrainingDB.transaction(
    'rw',
    interviewTrainingDB.sessions,
    async () => {
      const archivedAt = nowIso();
      await interviewTrainingDB.sessions
        .where('status')
        .equals('active')
        .modify((existing) => {
          existing.status = 'archived';
          existing.updatedAt = archivedAt;
        });

      await interviewTrainingDB.sessions.put(session);
    }
  );
}

export async function archiveCurrentSession(): Promise<void> {
  await interviewTrainingDB.sessions
    .where('status')
    .equals('active')
    .modify((existing) => {
      existing.status = 'archived';
      existing.updatedAt = nowIso();
    });
}

export async function saveTrainingAttempt(
  attempt: TrainingAttempt,
  audioBlob?: Blob
): Promise<TrainingAttempt> {
  return await interviewTrainingDB.transaction(
    'rw',
    interviewTrainingDB.attempts,
    interviewTrainingDB.audioBlobs,
    async () => {
      let attemptToSave = attempt;
      if (audioBlob) {
        const audioBlobId = attempt.audioBlobId ?? crypto.randomUUID();
        attemptToSave = {
          ...attempt,
          audioBlobId,
          updatedAt: nowIso()
        };
        await interviewTrainingDB.audioBlobs.put({
          id: audioBlobId,
          sessionId: attempt.sessionId,
          attemptId: attempt.id,
          createdAt: attempt.createdAt,
          mimeType: audioBlob.type || 'audio/webm',
          blob: audioBlob
        });
      }

      await interviewTrainingDB.attempts.put(attemptToSave);
      return attemptToSave;
    }
  );
}

export async function saveStageEvaluation(
  evaluation: StageEvaluation
): Promise<void> {
  await interviewTrainingDB.evaluations.put(evaluation);
}

export async function completeAttemptEvaluation(options: {
  attemptId: string;
  evaluation: StageEvaluation;
}): Promise<{ saved: true; promotedToLatest: boolean }> {
  return interviewTrainingDB.transaction(
    'rw',
    interviewTrainingDB.sessions,
    interviewTrainingDB.attempts,
    interviewTrainingDB.evaluations,
    async () => {
      const attempt = await interviewTrainingDB.attempts.get(options.attemptId);
      if (!attempt) {
        throw new Error('Attempt not found');
      }

      const updatedAt = nowIso();
      await interviewTrainingDB.evaluations.put(options.evaluation);
      await interviewTrainingDB.attempts.update(options.attemptId, {
        evaluationId: options.evaluation.id,
        status: 'evaluated',
        updatedAt
      });

      const session = await interviewTrainingDB.sessions.get(attempt.sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const question = session.questions.find(
        (entry) => entry.id === attempt.questionId
      );
      const stageState = question?.stages[attempt.stage];

      if (!question || !stageState || stageState.latestAttemptId !== attempt.id) {
        return { saved: true as const, promotedToLatest: false };
      }

      question.stages[attempt.stage] = {
        ...stageState,
        latestEvaluationId: options.evaluation.id,
        status: 'reviewed',
        updatedAt
      };
      
      if (!question.completedStages.includes(attempt.stage)) {
        question.completedStages = [...question.completedStages, attempt.stage];
      }

      question.recommendation = options.evaluation.suggestedNextAction;
      question.updatedAt = updatedAt;
      session.globalRecommendation = options.evaluation.suggestedNextAction;
      session.updatedAt = updatedAt;

      await interviewTrainingDB.sessions.put(session);

      return { saved: true as const, promotedToLatest: true };
    }
  );
}

export async function getAttemptsForStage(
  sessionId: string,
  questionId: string,
  stage: string
): Promise<TrainingAttempt[]> {
  const attempts = await interviewTrainingDB.attempts
    .where('sessionId')
    .equals(sessionId)
    .toArray();

  return attempts
    .filter((attempt) => attempt.questionId === questionId && attempt.stage === stage)
    .map(normalizeTrainingAttempt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getAttemptsForSession(
  sessionId: string
): Promise<TrainingAttempt[]> {
  const attempts = await interviewTrainingDB.attempts
    .where('sessionId')
    .equals(sessionId)
    .toArray();

  return attempts
    .map(normalizeTrainingAttempt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getLatestEvaluation(
  attemptId: string
): Promise<StageEvaluation | null> {
  const evaluation = await interviewTrainingDB.evaluations
    .where('attemptId')
    .equals(attemptId)
    .last();

  return evaluation ?? null;
}

export async function getEvaluationsForSession(
  sessionId: string
): Promise<StageEvaluation[]> {
  const evaluations = await interviewTrainingDB.evaluations
    .where('sessionId')
    .equals(sessionId)
    .toArray();

  return evaluations.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
}

export async function cleanupOldAudioBlobs(options: {
  sessionId: string;
  keepLatest: number;
}): Promise<void> {
  const blobs = await interviewTrainingDB.audioBlobs
    .where('sessionId')
    .equals(options.sessionId)
    .toArray();

  const staleIds = blobs
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(options.keepLatest)
    .map((blob) => blob.id);

  if (staleIds.length > 0) {
    await interviewTrainingDB.audioBlobs.bulkDelete(staleIds);
  }
}

export async function getAudioBlob(
  blobId: string
): Promise<Blob | null> {
  const record = await interviewTrainingDB.audioBlobs.get(blobId);
  return record?.blob ?? null;
}

export async function clearInterviewTrainingData(): Promise<void> {
  await interviewTrainingDB.transaction(
    'rw',
    interviewTrainingDB.sessions,
    interviewTrainingDB.attempts,
    interviewTrainingDB.evaluations,
    interviewTrainingDB.audioBlobs,
    async () => {
      await Promise.all([
        interviewTrainingDB.sessions.clear(),
        interviewTrainingDB.attempts.clear(),
        interviewTrainingDB.evaluations.clear(),
        interviewTrainingDB.audioBlobs.clear()
      ]);
    }
  );
}
