import type {
  InterviewTrainingAction,
  InterviewTrainingState
} from './interviewTrainingActions';

export const initialInterviewTrainingState: InterviewTrainingState = {
  status: 'initializing',
  session: null,
  attempts: [],
  evaluations: [],
  isSubmitting: false
};

export function interviewTrainingReducer(
  state: InterviewTrainingState,
  action: InterviewTrainingAction
): InterviewTrainingState {
  switch (action.type) {
    case 'SESSION_LOADED':
      return {
        ...state,
        status: 'ready',
        source: action.source,
        session: action.session,
        attempts: action.attempts,
        evaluations: action.evaluations,
        error: undefined
      };

    case 'SESSION_UPDATED':
      return {
        ...state,
        session: action.session,
        error: undefined
      };

    case 'SESSION_CORRUPTED':
      return {
        ...state,
        status: 'corrupted',
        session: action.session,
        error: action.error
      };

    case 'ATTEMPT_ADDED':
      return {
        ...state,
        session: action.session,
        attempts: [
          action.attempt,
          ...state.attempts.filter((attempt) => attempt.id !== action.attempt.id)
        ],
        error: undefined
      };

    case 'ATTEMPT_UPDATED':
      return {
        ...state,
        attempts: state.attempts.map((attempt) =>
          attempt.id === action.attempt.id ? action.attempt : attempt
        )
      };

    case 'EVALUATION_ADDED':
      return {
        ...state,
        session: action.session ?? state.session,
        attempts: state.attempts.map((attempt) =>
          attempt.id === action.attempt.id ? action.attempt : attempt
        ),
        evaluations: [
          action.evaluation,
          ...state.evaluations.filter(
            (evaluation) => evaluation.id !== action.evaluation.id
          )
        ],
        error: undefined
      };

    case 'SUBMITTING_SET':
      return {
        ...state,
        isSubmitting: action.isSubmitting
      };

    case 'ERROR_SET':
      return {
        ...state,
        status: action.error ? 'error' : state.status,
        error: action.error
      };

    default:
      return state;
  }
}
