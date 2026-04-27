import { describe, it, expect } from 'vitest';
import {
  readTranscriptDetails,
  readTimeAnalysis,
  readCrossQuestionConsistency
} from '../features/interview/training/components/evaluationDetails';

describe('evaluationDetails weak schema reader', () => {
  it('handles empty or malformed transcript details', () => {
    const details = {};
    const res = readTranscriptDetails(details);
    expect(res.displayTranscript).toBeUndefined();
    expect(res.displayTranscriptSegments).toBeUndefined();

    const malformed = { displayTranscriptSegments: [ { text: 123 } ] };
    const res2 = readTranscriptDetails(malformed);
    expect(res2.displayTranscriptSegments?.[0].text).toBe('');
    expect(res2.displayTranscriptSegments?.[0].startSec).toBe(0);
  });

  it('handles empty or malformed time analysis', () => {
    const res = readTimeAnalysis({ timeAnalysis: { durationSec: 'not-a-number' } });
    expect(res?.durationSec).toBe(0);
    expect(res?.cutoffSec).toBe(45);
  });

  it('handles missing cross question consistency', () => {
    const res = readCrossQuestionConsistency({});
    expect(res).toBeNull();

    const res2 = readCrossQuestionConsistency({ crossQuestionConsistency: { contradictions: ['bad'] } });
    expect(res2?.includedQuestionIds).toEqual([]);
    expect(res2?.contradictions).toEqual(['bad']);
  });
});
