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
  let segments: TranscriptSegment[] | undefined = undefined;
  if (Array.isArray(details.displayTranscriptSegments)) {
    segments = details.displayTranscriptSegments.map(seg => ({
      startSec: typeof seg?.startSec === 'number' ? seg.startSec : 0,
      endSec: typeof seg?.endSec === 'number' ? seg.endSec : 0,
      text: typeof seg?.text === 'string' ? seg.text : '',
      afterCutoff: typeof seg?.afterCutoff === 'boolean' ? seg.afterCutoff : false
    }));
  }
  return {
    displayTranscript: typeof details.displayTranscript === 'string' 
      ? details.displayTranscript 
      : undefined,
    displayTranscriptSegments: segments,
  };
}

export function readTimeAnalysis(details: Record<string, unknown>): TimeAnalysis | null {
  if (isRecord(details.timeAnalysis)) {
    const raw = details.timeAnalysis;
    return {
      durationSec: typeof raw.durationSec === 'number' ? raw.durationSec : 0,
      cutoffSec: typeof raw.cutoffSec === 'number' ? raw.cutoffSec : 45,
      category: typeof raw.category === 'string' ? raw.category as any : 'unknown',
      beforeCutoffSummary: typeof raw.beforeCutoffSummary === 'string' ? raw.beforeCutoffSummary : '',
      afterCutoffSummary: typeof raw.afterCutoffSummary === 'string' ? raw.afterCutoffSummary : '',
      pacingAdvice: typeof raw.pacingAdvice === 'string' ? raw.pacingAdvice : '',
    };
  }
  return null;
}

export function readQuestionComprehensionAnalysis(
  details: Record<string, unknown>
): QuestionComprehensionAnalysis | null {
  if (isRecord(details.questionComprehensionAnalysis)) {
    const raw = details.questionComprehensionAnalysis;
    return {
      promptTextVisibleOnSubmit: typeof raw.promptTextVisibleOnSubmit === 'boolean' ? raw.promptTextVisibleOnSubmit : false,
      promptTextWasEverShown: typeof raw.promptTextWasEverShown === 'boolean' ? raw.promptTextWasEverShown : false,
      promptListenCount: typeof raw.promptListenCount === 'number' ? raw.promptListenCount : 0,
      likelyAnsweredFromListening: typeof raw.likelyAnsweredFromListening === 'boolean' ? raw.likelyAnsweredFromListening : true,
      evidence: typeof raw.evidence === 'string' ? raw.evidence : '',
    };
  }
  return null;
}

export function readCrossQuestionConsistency(
  details: Record<string, unknown>
): CrossQuestionConsistency | null {
  if (isRecord(details.crossQuestionConsistency)) {
    const raw = details.crossQuestionConsistency;
    return {
      includedQuestionIds: Array.isArray(raw.includedQuestionIds) 
        ? raw.includedQuestionIds.filter((id): id is string => typeof id === 'string')
        : [],
      contradictions: Array.isArray(raw.contradictions)
        ? raw.contradictions.filter((c): c is string => typeof c === 'string')
        : [],
      consistencySummary: typeof raw.consistencySummary === 'string' ? raw.consistencySummary : '',
      suggestedFix: typeof raw.suggestedFix === 'string' ? raw.suggestedFix : '',
    };
  }
  return null;
}
