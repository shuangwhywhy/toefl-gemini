import { describe, expect, it, vi, beforeEach } from 'vitest';
import { 
  createEmptyStage, 
  createDefaultPromptUsageState, 
  createEmptyStageMap, 
  createSessionFromGeneratedInterview,
  normalizeInterviewTrainingSession,
  loadOrCreateTrainingSession,
  createNewTrainingSession
} from '../services/interviewTrainingSessionFactory';
import { createMockSession, createMockQuestion } from './fixtures/interviewFixtures';
import { generateInterviewSession } from '../features/interview/interviewGeneration';
import { PreloadPipeline } from '../services/preload/orchestrator';
import * as Persistence from '../services/interviewTrainingPersistence';
import type { InterviewSessionData } from '../features/interview/interviewGeneration';

vi.mock('../features/interview/interviewGeneration', () => ({
  generateInterviewSession: vi.fn(),
  INTERVIEW_PROMPT_VERSION: '1.0'
}));

vi.mock('../services/preload/orchestrator', () => ({
  PreloadPipeline: {
    inFlight: {},
    cache: {}
  }
}));

vi.mock('../services/interviewTrainingPersistence', () => ({
  loadActiveInterviewTrainingSession: vi.fn(),
  saveInterviewTrainingSession: vi.fn(),
  createInterviewTrainingSession: vi.fn()
}));

describe('InterviewTrainingSessionFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PreloadPipeline.inFlight = {};
    PreloadPipeline.cache = { shadow: null, interview: null, listening: null, dictation: null };
  });

  it('creates an empty stage state', () => {
    const now = '2026-01-01T00:00:00Z';
    const stage = createEmptyStage(now);
    expect(stage).toEqual({
      status: 'not_started',
      attemptIds: [],
      updatedAt: now
    });
  });

  it('creates default prompt usage state', () => {
    const state = createDefaultPromptUsageState();
    expect(state.listenCount).toBe(0);
    expect(state.textVisible).toBe(false);
  });

  it('creates empty stage map for all stages', () => {
    const now = '2026-01-01T00:00:00Z';
    const map = createEmptyStageMap(now);
    expect(Object.keys(map)).toContain('thinking_structure');
    expect(Object.keys(map)).toContain('final_practice');
    expect(map.thinking_structure.status).toBe('not_started');
  });

  it('creates session from generated interview data', () => {
    const mockGenerated: InterviewSessionData = {
      topic: 'Test Topic',
      questions: [
        { role: 'personal_anchor', text: 'Q1', audioUrl: 'url1' },
        { role: 'personal_choice', text: 'Q2', audioUrl: 'url2' },
        { role: 'broad_opinion', text: 'Q3', audioUrl: 'url3' },
        { role: 'future_or_tradeoff', text: 'Q4', audioUrl: 'url4' }
      ]
    };
    const session = createSessionFromGeneratedInterview(mockGenerated, {
      source: 'fresh_generation',
      voice: 'en-US-Standard-A'
    });

    expect(session.topic).toBe('Test Topic');
    expect(session.questions).toHaveLength(4);
    expect(session.questions[0].question).toBe('Q1');
    expect(session.questions[0].promptAudio?.audioUrl).toBe('url1');
    expect(session.metadata?.source).toBe('fresh_generation');
  });

  it('throws error for invalid generated interview payload', () => {
    expect(() => createSessionFromGeneratedInterview({ topic: '', questions: [] } as InterviewSessionData, { source: 'fresh_generation', voice: 'v' }))
      .toThrow('Invalid generated interview payload.');
    
    expect(() => createSessionFromGeneratedInterview({ topic: 'T', questions: [{ role: 'personal_anchor', text: '', audioUrl: '' }] } as InterviewSessionData, { source: 'fresh_generation', voice: 'v' }))
      .toThrow('Interview training session requires four durable questions.');
  });

  it('normalizes session by stripping blob URLs', () => {
    const mockSession = createMockSession({
      questions: [createMockQuestion({
        role: 'personal_anchor',
        promptAudio: { audioUrl: 'blob:123', status: 'ready', voice: 'v' },
        promptUsage: { 
          textVisible: false,
          textWasEverShown: false,
          listenCount: 5,
          playbackStartedCount: 0,
          playbackCompletedCount: 0
        }
      })]
    });

    const normalized = normalizeInterviewTrainingSession(mockSession, 'new-voice');
    expect(normalized.questions[0].promptAudio?.audioUrl).toBeUndefined();
    expect(normalized.questions[0].promptAudio?.status).toBe('idle');
    expect(normalized.questions[0].promptAudio?.voice).toBe('v'); // Preserves original voice if present
  });

  describe('loadOrCreateTrainingSession', () => {
    it('restores an active session if valid', async () => {
      // Use createSessionFromGeneratedInterview to get a valid session for schema validation
      const mockGenerated: InterviewSessionData = {
        topic: 'Test Topic',
        questions: [
          { role: 'personal_anchor', text: 'Q', audioUrl: 'url' },
          { role: 'personal_choice', text: 'Q', audioUrl: 'url' },
          { role: 'broad_opinion', text: 'Q', audioUrl: 'url' },
          { role: 'future_or_tradeoff', text: 'Q', audioUrl: 'url' }
        ]
      };
      const mockActive = createSessionFromGeneratedInterview(mockGenerated, {
        source: 'fresh_generation',
        voice: 'en-US-Standard-A'
      });
      
      vi.mocked(Persistence.loadActiveInterviewTrainingSession).mockResolvedValue(mockActive);

      const result = await loadOrCreateTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('restored');
      expect(result.session.id).toBe(mockActive.id);
      expect(Persistence.saveInterviewTrainingSession).toHaveBeenCalled();
    });

    it('creates from preload cache if active session is missing', async () => {
      vi.mocked(Persistence.loadActiveInterviewTrainingSession).mockResolvedValue(null);
      const mockCached: InterviewSessionData = {
        topic: 'Cached',
        questions: Array(4).fill({ text: 'Q', role: 'R', audioUrl: 'url' })
      };
      PreloadPipeline.cache.interview = mockCached;

      const result = await loadOrCreateTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('created_from_preload');
      expect(result.session.topic).toBe('Cached');
      expect(PreloadPipeline.cache.interview).toBeNull();
    });

    it('generates fresh session if no active and no cache', async () => {
      vi.mocked(Persistence.loadActiveInterviewTrainingSession).mockResolvedValue(null);
      const mockGenerated = {
        topic: 'Fresh',
        questions: Array(4).fill({ text: 'Q', role: 'personal_anchor' })
      } as InterviewSessionData;
      vi.mocked(generateInterviewSession).mockResolvedValue(mockGenerated);

      const result = await loadOrCreateTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('created_fresh');
      expect(result.session.topic).toBe('Fresh');
    });

    it('handles corrupted active session by trying preload', async () => {
      const mockCorrupted = createMockSession({
        id: 's1',
        status: 'active',
        activeQuestionId: 'wrong-id',
        questions: [createMockQuestion({ id: 'q1' })]
      });
      vi.mocked(Persistence.loadActiveInterviewTrainingSession).mockResolvedValue(mockCorrupted);

      const result = await loadOrCreateTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('corrupted');
    });
  });

  describe('createNewTrainingSession', () => {
    it('always creates new, prioritizing preload', async () => {
      const mockCached: InterviewSessionData = { topic: 'New Cached', questions: Array(4).fill({ text: 'Q', role: 'R', audioUrl: 'url' }) };
      PreloadPipeline.cache.interview = mockCached;

      const result = await createNewTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('created_from_preload');
    });

    it('generates fresh if no cache', async () => {
      const mockGenerated = { topic: 'New Fresh', questions: Array(4).fill({ text: 'Q', role: 'personal_anchor' }) } as InterviewSessionData;
      vi.mocked(generateInterviewSession).mockResolvedValue(mockGenerated);

      const result = await createNewTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('created_fresh');
    });
  });
});
