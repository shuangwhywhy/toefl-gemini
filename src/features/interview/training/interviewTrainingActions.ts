import type {
  InterviewTrainingSession,
  StageEvaluation,
  TrainingAttempt
} from '../types';

export type InterviewTrainingStatus =
  | 'initializing'
  | 'ready'
  | 'corrupted'
  | 'error';

export type InterviewTrainingState = {
  status: InterviewTrainingStatus;
  source?: 'restored' | 'created_from_preload' | 'created_fresh';
  session: InterviewTrainingSession | null;
  attempts: TrainingAttempt[];
  evaluations: StageEvaluation[];
  isSubmitting: boolean;
  error?: string;
};

export type InterviewTrainingAction =
  | {
      type: 'SESSION_LOADED';
      session: InterviewTrainingSession;
      attempts: TrainingAttempt[];
      evaluations: StageEvaluation[];
      source: NonNullable<InterviewTrainingState['source']>;
    }
  | { type: 'SESSION_UPDATED'; session: InterviewTrainingSession }
  | {
      type: 'SESSION_CORRUPTED';
      error: string;
      session: InterviewTrainingSession | null;
    }
  | { type: 'ATTEMPT_ADDED'; attempt: TrainingAttempt; session: InterviewTrainingSession }
  | { type: 'ATTEMPT_UPDATED'; attempt: TrainingAttempt }
  | {
      type: 'EVALUATION_ADDED';
      evaluation: StageEvaluation;
      attempt: TrainingAttempt;
      session?: InterviewTrainingSession;
    }
  | { type: 'SUBMITTING_SET'; isSubmitting: boolean }
  | { type: 'ERROR_SET'; error?: string };
