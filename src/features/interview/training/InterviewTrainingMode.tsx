import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  GraduationCap,
  Loader2,
  Shuffle
} from 'lucide-react';
import { LegacyMockInterview } from '../LegacyMockInterview';
import type {
  InterviewTrainingSession,
  InterviewTrainingStage,
  QuestionPromptUsage,
  StageEvaluation,
  TrainingAttempt,
  TrainingRecommendation
} from '../types';
import { useRequestScope } from '../../../services/requestScope';
import {
  createNewTrainingSession,
  loadOrCreateTrainingSession
} from '../../../services/interviewTrainingSessionFactory';
import { fetchNeuralTTS } from '../../../services/llm/helpers';
import {
  cleanupOldAudioBlobs,
  completeAttemptEvaluation,
  getAttemptsForSession,
  getEvaluationsForSession,
  loadActiveInterviewTrainingSession,
  saveInterviewTrainingSession,
  saveTrainingAttempt
} from '../../../services/interviewTrainingPersistence';
import { evaluateInterviewTrainingStage } from '../../../services/interviewTrainingEvaluation';
import { buildRetryAwareMessage } from '../../shared/trainingUtils';
import { CurrentQuestionPanel } from './components/CurrentQuestionPanel';
import { QuestionSwitcher } from './components/QuestionSwitcher';
import { StageSwitcher } from './components/StageSwitcher';
import { StageAttemptPanel } from './components/StageAttemptPanel';
import { LatestFeedbackPanel } from './components/LatestFeedbackPanel';
import { NewTrainingSetButton } from './components/NewTrainingSetButton';
import { AttemptHistory } from './components/AttemptHistory';
import {
  getActiveQuestion,
  getAttemptsForActiveStage,
  getLatestEvaluationForActiveStage
} from './interviewTrainingSelectors';
import { buildCrossQuestionTextContext } from './interviewTrainingContext';
import {
  initialInterviewTrainingState,
  interviewTrainingReducer
} from './interviewTrainingReducer';
import { createTimingWindow, isTimedInterviewStage } from './useTimedAnswer';

const INTERVIEWER_VOICE = 'Puck';

const formatLoadSource = (source?: string) => {
  if (source === 'restored') {
    return 'Restored';
  }
  if (source === 'created_from_preload') {
    return 'From Preload';
  }
  if (source === 'created_fresh') {
    return 'Fresh Set';
  }
  return 'Training';
};

const replaceQuestion = (
  session: InterviewTrainingSession,
  questionId: string,
  update: (question: InterviewTrainingSession['questions'][number]) => InterviewTrainingSession['questions'][number]
) => ({
  ...session,
  questions: session.questions.map((question) =>
    question.id === questionId ? update(question) : question
  )
});

const createAttempt = (input: {
  sessionId: string;
  questionId: string;
  stage: InterviewTrainingStage;
  inputType: 'audio' | 'text';
  transcript?: string;
  durationSec?: number;
  promptUsage?: QuestionPromptUsage;
  timingWindow?: TrainingAttempt['timingWindow'];
  answerLanguage?: TrainingAttempt['answerLanguage'];
}): TrainingAttempt => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    questionId: input.questionId,
    stage: input.stage,
    inputType: input.inputType,
    transcript: input.transcript,
    durationSec: input.durationSec,
    promptUsage: input.promptUsage,
    timingWindow: input.timingWindow,
    answerLanguage: input.answerLanguage,
    status: input.inputType === 'text' ? 'evaluating' : 'recorded',
    createdAt: now,
    updatedAt: now
  };
};

const createEvaluation = (input: {
  attempt: TrainingAttempt;
  result: Awaited<ReturnType<typeof evaluateInterviewTrainingStage>>;
}): StageEvaluation => ({
  id: crypto.randomUUID(),
  sessionId: input.attempt.sessionId,
  questionId: input.attempt.questionId,
  stage: input.attempt.stage,
  attemptId: input.attempt.id,
  createdAt: new Date().toISOString(),
  score: input.result.score,
  readiness: input.result.readiness,
  mainIssue: input.result.mainIssue,
  feedbackSummary: input.result.feedbackSummary,
  suggestedNextAction: input.result.suggestedNextAction,
  details: input.result.details
});

const createPromptUsageSnapshot = (
  question: InterviewTrainingSession['questions'][number]
): QuestionPromptUsage => ({
  textVisibleOnSubmit: question.promptUsage.textVisible,
  textWasEverShown: question.promptUsage.textWasEverShown,
  listenCount: question.promptUsage.listenCount,
  playbackStartedCount: question.promptUsage.playbackStartedCount,
  playbackCompletedCount: question.promptUsage.playbackCompletedCount
});

const inferAnswerLanguage = (
  stage: InterviewTrainingStage,
  inputType: 'audio' | 'text'
): TrainingAttempt['answerLanguage'] => {
  if (inputType === 'text') {
    return 'unknown';
  }
  if (stage === 'thinking_structure') {
    return 'mixed';
  }
  if (
    stage === 'english_units' ||
    stage === 'full_english_answer' ||
    stage === 'final_practice'
  ) {
    return 'en';
  }
  return 'unknown';
};

export function InterviewTrainingMode({ onBack }: { onBack: () => void }) {
  const [state, dispatch] = useReducer(
    interviewTrainingReducer,
    initialInterviewTrainingState
  );
  const [showLegacyMock, setShowLegacyMock] = useState(false);

  const {
    scopeId,
    beginSession,
    isSessionCurrent,
    invalidateSession
  } = useRequestScope('interview-training');

  const hydrateSession = useCallback(
    async (
      session: InterviewTrainingSession,
      source: 'restored' | 'created_from_preload' | 'created_fresh'
    ) => {
      const [attempts, evaluations] = await Promise.all([
        getAttemptsForSession(session.id),
        getEvaluationsForSession(session.id)
      ]);
      dispatch({
        type: 'SESSION_LOADED',
        session,
        attempts,
        evaluations,
        source
      });
    },
    []
  );

  const initialize = useCallback(async () => {
    const token = beginSession();
    const controller = new AbortController();

    try {
      const result = await loadOrCreateTrainingSession({
        voice: INTERVIEWER_VOICE,
        scopeId,
        signal: controller.signal,
        supersedeKey: 'interview-training:generate',
        firstTtsSupersedeKey: 'interview-training:first-tts'
      });

      if (!isSessionCurrent(token)) {
        return;
      }

      if (result.kind === 'corrupted') {
        dispatch({
          type: 'SESSION_CORRUPTED',
          session: result.session,
          error: 'Your saved interview training session could not be restored.'
        });
        return;
      }

      await hydrateSession(result.session, result.kind);
    } catch (error) {
      if (!isSessionCurrent(token)) {
        return;
      }
      dispatch({
        type: 'ERROR_SET',
        error: buildRetryAwareMessage(
          'Interview training could not be loaded. Please try again.',
          error
        )
      });
    }

    return () => controller.abort();
  }, [beginSession, hydrateSession, isSessionCurrent, scopeId]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const activeQuestion = useMemo(
    () => getActiveQuestion(state.session),
    [state.session]
  );
  const activeAttempts = useMemo(
    () => getAttemptsForActiveStage(state.session, state.attempts),
    [state.attempts, state.session]
  );
  const latestEvaluation = useMemo(
    () => getLatestEvaluationForActiveStage(state.session, state.evaluations),
    [state.evaluations, state.session]
  );

  const persistSessionUpdate = async (session: InterviewTrainingSession) => {
    dispatch({ type: 'SESSION_UPDATED', session });
    await saveInterviewTrainingSession(session);
  };

  const updateQuestionPromptUsage = (
    questionId: string,
    update: Partial<InterviewTrainingSession['questions'][number]['promptUsage']>
  ) => {
    if (!state.session) {
      return;
    }

    const now = new Date().toISOString();
    const nextSession = replaceQuestion(
      {
        ...state.session,
        updatedAt: now
      },
      questionId,
      (question) => ({
        ...question,
        promptUsage: {
          ...question.promptUsage,
          ...update
        },
        updatedAt: now
      })
    );
    void persistSessionUpdate(nextSession);
  };

  const updateQuestionPromptAudio = async (
    questionId: string,
    update: Partial<NonNullable<InterviewTrainingSession['questions'][number]['promptAudio']>>
  ) => {
    if (!state.session) {
      return;
    }

    const now = new Date().toISOString();
    const nextSession = replaceQuestion(
      {
        ...state.session,
        updatedAt: now
      },
      questionId,
      (question) => ({
        ...question,
        promptAudio: {
          voice: question.promptAudio?.voice ?? INTERVIEWER_VOICE,
          ...question.promptAudio,
          ...update
        },
        updatedAt: now
      })
    );
    await persistSessionUpdate(nextSession);
  };

  const ensureQuestionPromptAudio = async (questionId: string) => {
    const question = state.session?.questions.find((entry) => entry.id === questionId);
    if (!state.session || !question) {
      return null;
    }

    if (question.promptAudio?.audioUrl) {
      const url = question.promptAudio.audioUrl;
      if (url.startsWith('blob:')) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            return url;
          }
        } catch {
          // Stale blob, fall through to re-fetch
        }
      } else {
        return url;
      }
    }

    await updateQuestionPromptAudio(questionId, { status: 'loading' });
    try {
      const audioUrl = await fetchNeuralTTS(
        question.promptAudio?.voice ?? INTERVIEWER_VOICE,
        question.question,
        null,
        {
          scopeId,
          supersedeKey: `interview-training:prompt-tts:${questionId}`,
          origin: 'ui',
          sceneKey: 'interview-training:prompt-tts'
        }
      );

      if (audioUrl) {
        await updateQuestionPromptAudio(questionId, {
          audioUrl,
          status: 'ready'
        });
        return audioUrl;
      }

      await updateQuestionPromptAudio(questionId, { status: 'failed' });
      return null;
    } catch (error) {
      await updateQuestionPromptAudio(questionId, { status: 'failed' });
      throw error;
    }
  };

  const selectQuestion = async (questionId: string) => {
    if (!state.session) {
      return;
    }

    const targetQuestion = state.session.questions.find(
      (question) => question.id === questionId
    );
    if (!targetQuestion) {
      return;
    }

    const now = new Date().toISOString();
    const nextSession = {
      ...state.session,
      activeQuestionId: questionId,
      activeStage: targetQuestion.currentStage,
      updatedAt: now
    };
    await persistSessionUpdate(nextSession);
  };

  const selectStage = async (stage: InterviewTrainingStage) => {
    if (!state.session || !activeQuestion) {
      return;
    }

    const now = new Date().toISOString();
    const nextSession = replaceQuestion(
      {
        ...state.session,
        activeStage: stage,
        updatedAt: now
      },
      activeQuestion.id,
      (question) => ({
        ...question,
        currentStage: stage,
        updatedAt: now
      })
    );
    await persistSessionUpdate(nextSession);
  };

  const goToRecommendation = async (recommendation: TrainingRecommendation) => {
    if (!state.session) {
      return;
    }

    const questionExists = state.session.questions.some(
      (question) => question.id === recommendation.questionId
    );
    if (!questionExists) {
      return;
    }

    const now = new Date().toISOString();
    const nextSession = replaceQuestion(
      {
        ...state.session,
        activeQuestionId: recommendation.questionId,
        activeStage: recommendation.stage,
        updatedAt: now
      },
      recommendation.questionId,
      (question) => ({
        ...question,
        currentStage: recommendation.stage,
        updatedAt: now
      })
    );
    await persistSessionUpdate(nextSession);
  };

  const submitAttempt = async (input: {
    inputType: 'audio' | 'text';
    transcript?: string;
    audioBlob?: Blob;
    durationSec?: number;
  }) => {
    if (!state.session || !activeQuestion) {
      return;
    }

    const stage = state.session.activeStage;
    const promptUsage = createPromptUsageSnapshot(activeQuestion);
    const timingWindow = createTimingWindow(stage, input.durationSec);
    const attempt = createAttempt({
      sessionId: state.session.id,
      questionId: activeQuestion.id,
      stage,
      inputType: input.inputType,
      transcript: input.transcript,
      durationSec: input.durationSec,
      promptUsage,
      timingWindow,
      answerLanguage: inferAnswerLanguage(stage, input.inputType)
    });
    const now = new Date().toISOString();
    const stageState = activeQuestion.stages[stage];
    const nextSession = replaceQuestion(
      {
        ...state.session,
        activeQuestionId: activeQuestion.id,
        activeStage: stage,
        updatedAt: now
      },
      activeQuestion.id,
      (question) => ({
        ...question,
        currentStage: stage,
        stages: {
          ...question.stages,
          [stage]: {
            ...stageState,
            status: 'submitted',
            attemptIds: [...stageState.attemptIds, attempt.id],
            latestAttemptId: attempt.id,
            latestEvaluationId: undefined,
            updatedAt: now
          }
        },
        updatedAt: now
      })
    );

    dispatch({ type: 'SUBMITTING_SET', isSubmitting: true });
    let persistedAttempt = attempt;

    try {
      await saveInterviewTrainingSession(nextSession);
      persistedAttempt = await saveTrainingAttempt(attempt, input.audioBlob);
      dispatch({ type: 'ATTEMPT_ADDED', attempt: persistedAttempt, session: nextSession });

      let attemptForEvaluation = persistedAttempt;
      attemptForEvaluation = {
        ...attemptForEvaluation,
        status: 'evaluating',
        updatedAt: new Date().toISOString()
      };
      attemptForEvaluation = await saveTrainingAttempt(attemptForEvaluation);
      dispatch({ type: 'ATTEMPT_UPDATED', attempt: attemptForEvaluation });

      const questionForEvaluation =
        nextSession.questions.find((question) => question.id === activeQuestion.id) ??
        activeQuestion;
      const crossQuestionTextContext = buildCrossQuestionTextContext({
        session: nextSession,
        currentQuestionId: activeQuestion.id,
        currentStage: stage,
        attempts: [attemptForEvaluation, ...state.attempts],
        evaluations: state.evaluations
      });

      const result = await evaluateInterviewTrainingStage({
        session: nextSession,
        question: questionForEvaluation,
        stage,
        inputType: input.inputType,
        transcript: input.transcript,
        audioBlob: input.audioBlob,
        durationSec: input.durationSec,
        promptUsage,
        timingWindow: isTimedInterviewStage(stage) ? timingWindow : undefined,
        crossQuestionTextContext,
        attemptId: attemptForEvaluation.id,
        scopeId
      });
      const evaluation = createEvaluation({ attempt: attemptForEvaluation, result });
      const completion = await completeAttemptEvaluation({
        attemptId: attemptForEvaluation.id,
        evaluation
      });
      const updatedAttempt: TrainingAttempt = {
        ...attemptForEvaluation,
        evaluationId: evaluation.id,
        status: 'evaluated',
        updatedAt: new Date().toISOString()
      };
      const latestSession = completion.promotedToLatest
        ? await loadActiveInterviewTrainingSession()
        : null;

      dispatch({
        type: 'EVALUATION_ADDED',
        evaluation,
        attempt: updatedAttempt,
        session: latestSession ?? undefined
      });
      void cleanupOldAudioBlobs({
        sessionId: attemptForEvaluation.sessionId,
        keepLatest: 20
      });
    } catch (error) {
      const failedAttempt: TrainingAttempt = {
        ...persistedAttempt,
        status: 'failed',
        updatedAt: new Date().toISOString()
      };
      await saveTrainingAttempt(failedAttempt);
      dispatch({ type: 'ATTEMPT_UPDATED', attempt: failedAttempt });
      dispatch({
        type: 'ERROR_SET',
        error: buildRetryAwareMessage(
          'This attempt could not be evaluated. Your session was kept.',
          error
        )
      });
    } finally {
      dispatch({ type: 'SUBMITTING_SET', isSubmitting: false });
    }
  };

  const submitTextAttempt = async (transcript: string) =>
    submitAttempt({ inputType: 'text', transcript });

  const submitAudioAttempt = async (audioBlob: Blob, durationSec: number) =>
    submitAttempt({ inputType: 'audio', audioBlob, durationSec });

  const retryAttemptEvaluation = async (attemptId: string) => {
    const attempt = state.attempts.find((a) => a.id === attemptId);
    if (!attempt || !state.session) {
      return;
    }
    const targetQuestion = state.session.questions.find((q) => q.id === attempt.questionId);
    if (!targetQuestion) {
      return;
    }

    let audioBlob: Blob | undefined;
    if (attempt.inputType === 'audio') {
      if (attempt.audioBlobId) {
        const { getAudioBlob } = await import('../../../services/interviewTrainingPersistence');
        const blob = await getAudioBlob(attempt.audioBlobId);
        if (blob) {
          audioBlob = blob;
        }
      }
      if (!audioBlob) {
        dispatch({
          type: 'ERROR_SET',
          error: 'Original audio could not be found. Please record a new attempt.'
        });
        return;
      }
    }

    dispatch({ type: 'SUBMITTING_SET', isSubmitting: true });

    let attemptForEvaluation: TrainingAttempt = {
      ...attempt,
      status: 'evaluating',
      updatedAt: new Date().toISOString()
    };

    try {
      attemptForEvaluation = await saveTrainingAttempt(attemptForEvaluation);
      dispatch({ type: 'ATTEMPT_UPDATED', attempt: attemptForEvaluation });

      const crossQuestionTextContext = buildCrossQuestionTextContext({
        session: state.session,
        currentQuestionId: targetQuestion.id,
        currentStage: attemptForEvaluation.stage,
        attempts: state.attempts.map((a) => (a.id === attemptForEvaluation.id ? attemptForEvaluation : a)),
        evaluations: state.evaluations
      });

      const result = await evaluateInterviewTrainingStage({
        session: state.session,
        question: targetQuestion,
        stage: attemptForEvaluation.stage,
        inputType: attemptForEvaluation.inputType,
        transcript: attemptForEvaluation.transcript,
        audioBlob,
        durationSec: attemptForEvaluation.durationSec,
        promptUsage: attemptForEvaluation.promptUsage,
        timingWindow: attemptForEvaluation.timingWindow,
        crossQuestionTextContext,
        attemptId: attemptForEvaluation.id,
        scopeId
      });

      const evaluation = createEvaluation({ attempt: attemptForEvaluation, result });
      const completion = await completeAttemptEvaluation({
        attemptId: attemptForEvaluation.id,
        evaluation
      });
      const updatedAttempt: TrainingAttempt = {
        ...attemptForEvaluation,
        evaluationId: evaluation.id,
        status: 'evaluated',
        updatedAt: new Date().toISOString()
      };
      const latestSession = completion.promotedToLatest
        ? await loadActiveInterviewTrainingSession()
        : null;

      dispatch({
        type: 'EVALUATION_ADDED',
        evaluation,
        attempt: updatedAttempt,
        session: latestSession ?? undefined
      });
    } catch (error) {
      const failedAttempt: TrainingAttempt = {
        ...attemptForEvaluation,
        status: 'failed',
        updatedAt: new Date().toISOString()
      };
      await saveTrainingAttempt(failedAttempt);
      dispatch({ type: 'ATTEMPT_UPDATED', attempt: failedAttempt });
      dispatch({
        type: 'ERROR_SET',
        error: buildRetryAwareMessage(
          'This retry attempt could not be evaluated.',
          error
        )
      });
    } finally {
      dispatch({ type: 'SUBMITTING_SET', isSubmitting: false });
    }
  };

  const startNewTrainingSet = async () => {
    dispatch({ type: 'SUBMITTING_SET', isSubmitting: true });
    const token = invalidateSession();
    const controller = new AbortController();

    try {
      const result = await createNewTrainingSession({
        voice: INTERVIEWER_VOICE,
        scopeId,
        signal: controller.signal,
        supersedeKey: 'interview-training:new-generate',
        firstTtsSupersedeKey: 'interview-training:new-first-tts'
      });

      if (!isSessionCurrent(token)) {
        return;
      }

      await hydrateSession(result.session, result.kind);
    } catch (error) {
      dispatch({
        type: 'ERROR_SET',
        error: buildRetryAwareMessage(
          'A new interview training set could not be created.',
          error
        )
      });
    } finally {
      dispatch({ type: 'SUBMITTING_SET', isSubmitting: false });
    }
  };

  if (showLegacyMock) {
    return <LegacyMockInterview onBack={() => setShowLegacyMock(false)} />;
  }

  if (state.status === 'corrupted') {
    return (
      <div className="min-h-[calc(100vh-64px)] bg-slate-100 p-4 md:p-6">
        <div className="mx-auto max-w-3xl rounded-lg border border-amber-200 bg-white p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-1 h-5 w-5 text-amber-600" />
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                Training Session Needs Restart
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {state.error}
              </p>
              <button
                type="button"
                onClick={() => void startNewTrainingSet()}
                disabled={state.isSubmitting}
                className="mt-5 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {state.isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Shuffle className="mr-2 h-4 w-4" />
                )}
                Start New Training Set
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'error' && !state.session) {
    return (
      <div className="min-h-[calc(100vh-64px)] bg-slate-100 p-4 md:p-6">
        <div className="mx-auto max-w-3xl rounded-lg border border-rose-200 bg-white p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-1 h-5 w-5 text-rose-600" />
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                Interview Training Unavailable
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {state.error}
              </p>
              <button
                type="button"
                onClick={() => void initialize()}
                className="mt-5 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"
              >
                <Loader2 className="mr-2 h-4 w-4" />
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'initializing' || !state.session || !activeQuestion) {
    return (
      <div className="min-h-[calc(100vh-64px)] bg-slate-100 p-4 md:p-6">
        <div className="mx-auto flex min-h-[420px] max-w-5xl items-center justify-center rounded-lg border border-slate-200 bg-white">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
            <p className="mt-4 text-sm font-semibold text-slate-600">
              Preparing interview training...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-100 p-4 pb-20 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-col gap-3 border-b border-slate-300 pb-4 md:flex-row md:items-center md:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="flex min-w-0 items-center gap-3 text-left hover:opacity-80"
          >
            <span className="rounded-lg bg-white p-2 text-slate-600 shadow-sm">
              <ArrowLeft className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-xl font-bold text-slate-900">
                <GraduationCap className="h-5 w-5 text-emerald-600" />
                Interview Training
              </span>
              <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                {formatLoadSource(state.source)}
              </span>
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowLegacyMock(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Mock Mode
            </button>
            <NewTrainingSetButton
              disabled={state.isSubmitting}
              onNewTrainingSet={startNewTrainingSet}
            />
          </div>
        </header>

        {state.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {state.error}
          </div>
        )}
        <QuestionSwitcher
          session={state.session}
          onSelect={(questionId) => void selectQuestion(questionId)}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <main className="space-y-4">
            <CurrentQuestionPanel
              topic={state.session.topic}
              question={activeQuestion}
              stage={state.session.activeStage}
              onPromptUsageChange={updateQuestionPromptUsage}
              onEnsurePromptAudio={ensureQuestionPromptAudio}
            />
            <StageSwitcher
              activeStage={state.session.activeStage}
              stages={activeQuestion.stages}
              onSelect={(stage) => void selectStage(stage)}
            />
            <StageAttemptPanel
              stage={state.session.activeStage}
              isSubmitting={state.isSubmitting}
              onSubmit={submitTextAttempt}
              onSubmitAudio={submitAudioAttempt}
            />
          </main>

          <aside className="space-y-4">
            <LatestFeedbackPanel
              evaluation={latestEvaluation}
              onGoToRecommendation={(recommendation) =>
                void goToRecommendation(recommendation)
              }
            />
            <AttemptHistory 
              attempts={activeAttempts} 
              onRetryAttempt={retryAttemptEvaluation} 
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
