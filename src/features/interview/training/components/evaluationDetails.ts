import { 
  StageEvaluation,
  TimeAnalysis,
  QuestionComprehensionAnalysis,
  CrossQuestionConsistency,
  TranscriptSegment
} from '../../types';

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export function readEvaluationDetails(
  evaluation: StageEvaluation
): Record<string, unknown> {
  if (isRecord(evaluation.details)) {
    return evaluation.details;
  }
  return {};
}

export function readTranscriptDetails(details: Record<string, unknown>): {
  displayTranscript?: string;
  displayTranscriptSegments?: TranscriptSegment[];
} {
  return {
    displayTranscript: typeof details.displayTranscript === 'string' 
      ? details.displayTranscript 
      : undefined,
    displayTranscriptSegments: Array.isArray(details.displayTranscriptSegments)
      ? (details.displayTranscriptSegments as TranscriptSegment[])
      : undefined,
  };
}

export function readTimeAnalysis(details: Record<string, unknown>): TimeAnalysis | null {
  if (isRecord(details.timeAnalysis)) {
    return details.timeAnalysis as unknown as TimeAnalysis;
  }
  return null;
}

export function readQuestionComprehensionAnalysis(
  details: Record<string, unknown>
): QuestionComprehensionAnalysis | null {
  if (isRecord(details.questionComprehensionAnalysis)) {
    return details.questionComprehensionAnalysis as unknown as QuestionComprehensionAnalysis;
  }
  return null;
}

export function readCrossQuestionConsistency(
  details: Record<string, unknown>
): CrossQuestionConsistency | null {
  if (isRecord(details.crossQuestionConsistency)) {
    return details.crossQuestionConsistency as unknown as CrossQuestionConsistency;
  }
  return null;
}
