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
import { generateInterviewSession } from '../features/interview/interviewGeneration';
import { PreloadPipeline } from '../services/preload/orchestrator';
import * as Persistence from '../services/interviewTrainingPersistence';

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
    PreloadPipeline.cache = {};
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
    const mockGenerated = {
      topic: 'Test Topic',
      questions: [
        { role: 'personal_anchor', text: 'Q1', audioUrl: 'url1' },
        { role: 'personal_choice', text: 'Q2', audioUrl: 'url2' },
        { role: 'broad_opinion', text: 'Q3', audioUrl: 'url3' },
        { role: 'future_or_tradeoff', text: 'Q4', audioUrl: 'url4' }
      ]
    };
    const session = createSessionFromGeneratedInterview(mockGenerated as any, {
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
    expect(() => createSessionFromGeneratedInterview({} as any, { source: 'fresh_generation', voice: 'v' }))
      .toThrow('Invalid generated interview payload.');
    
    expect(() => createSessionFromGeneratedInterview({ topic: 'T', questions: [{ role: 'personal_anchor', text: '' }] } as any, { source: 'fresh_generation', voice: 'v' }))
      .toThrow('Interview training session requires four durable questions.');
  });

  it('normalizes session by stripping blob URLs', () => {
    const mockSession = {
      questions: [{
        role: 'personal_anchor',
        promptAudio: { audioUrl: 'blob:123', status: 'ready', voice: 'v' },
        promptUsage: { listenCount: 5 },
        stages: {},
        completedStages: []
      }]
    } as any;

    const normalized = normalizeInterviewTrainingSession(mockSession, 'new-voice');
    expect(normalized.questions[0].promptAudio?.audioUrl).toBeUndefined();
    expect(normalized.questions[0].promptAudio?.status).toBe('idle');
    expect(normalized.questions[0].promptAudio?.voice).toBe('v'); // Preserves original voice if present
  });

  describe('loadOrCreateTrainingSession', () => {
    it('restores an active session if valid', async () => {
      // Use createSessionFromGeneratedInterview to get a valid session for schema validation
      const mockGenerated = {
        topic: 'Test Topic',
        questions: [
          { role: 'personal_anchor', text: 'Q' },
          { role: 'personal_choice', text: 'Q' },
          { role: 'broad_opinion', text: 'Q' },
          { role: 'future_or_tradeoff', text: 'Q' }
        ]
      };
      const mockActive = createSessionFromGeneratedInterview(mockGenerated as any, {
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
      const mockCached = {
        topic: 'Cached',
        questions: Array(4).fill({ text: 'Q', role: 'R' })
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
        questions: Array(4).fill({ text: 'Q', role: 'R' })
      };
      vi.mocked(generateInterviewSession).mockResolvedValue(mockGenerated as any);

      const result = await loadOrCreateTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('created_fresh');
      expect(result.session.topic).toBe('Fresh');
    });

    it('handles corrupted active session by trying preload', async () => {
      const mockCorrupted = {
        id: 's1',
        status: 'active',
        activeQuestionId: 'wrong-id',
        questions: [{ id: 'q1' }]
      };
      vi.mocked(Persistence.loadActiveInterviewTrainingSession).mockResolvedValue(mockCorrupted as any);

      const result = await loadOrCreateTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('corrupted');
    });
  });

  describe('createNewTrainingSession', () => {
    it('always creates new, prioritizing preload', async () => {
      const mockCached = { topic: 'New Cached', questions: Array(4).fill({ text: 'Q', role: 'R' }) };
      PreloadPipeline.cache.interview = mockCached;

      const result = await createNewTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('created_from_preload');
    });

    it('generates fresh if no cache', async () => {
      const mockGenerated = { topic: 'New Fresh', questions: Array(4).fill({ text: 'Q', role: 'R' }) };
      vi.mocked(generateInterviewSession).mockResolvedValue(mockGenerated as any);

      const result = await createNewTrainingSession({ voice: 'v', scopeId: 'sc1' });
      expect(result.kind).toBe('created_fresh');
    });
  });
});
