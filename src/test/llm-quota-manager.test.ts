import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QuotaManager, createEmptyQuotaHistories, buildQuotaContext } from '../services/llm/quotaManager';
import * as modelCatalog from '../services/llm/modelCatalog';

const mockModel: modelCatalog.LLMModelDefinition = {
  id: 'test-model',
  displayName: 'Test Model',
  bucket: 'text',
  capabilities: ['text'],
  pricing: { input1M: 0, output1M: 0 } as any,
  quota: { rpm: 2, rpd: 10, tpm: 100 },
  source: 'ai-studio-active-limits'
};

vi.mock('../services/llm/modelCatalog', async () => {
  const actual = await vi.importActual('../services/llm/modelCatalog');
  return {
    ...actual as any,
    getCandidateModels: vi.fn()
  };
});

const mockClock = (now: number) => ({
  now: () => now
});

describe('QuotaManager', () => {
  beforeEach(() => {
    vi.mocked(modelCatalog.getCandidateModels).mockReturnValue([mockModel]);
  });

  it('allows request within hard limits and blocks when exceeded', () => {
    let now = 1000;
    const histories = createEmptyQuotaHistories();
    const manager = new QuotaManager(mockClock(now), histories);
    const context = buildQuotaContext({ 
      route: { service: 'text', modelBucket: 'text' },
      origin: 'ui'
    });

    // 1st request
    const r1 = manager.selectCandidate(context);
    expect(r1.selection).not.toBeNull();
    manager.recordStarted(r1.selection!, 10);

    // 2nd request
    const r2 = manager.selectCandidate(context);
    expect(r2.selection).not.toBeNull();
    manager.recordStarted(r2.selection!, 10);

    // 3rd request - should be blocked by RPM=2
    const r3 = manager.selectCandidate(context);
    expect(r3.selection).toBeNull();
    expect(r3.nextWakeAt).toBe(1000 + 60000); // 1 minute after 1st request
  });

  it('blocks by TPM (tokens per minute)', () => {
    let now = 1000;
    const histories = createEmptyQuotaHistories();
    const manager = new QuotaManager(mockClock(now), histories);
    const context = buildQuotaContext({ 
      route: { service: 'text', modelBucket: 'text' },
      estimatedInputTokens: 60
    });

    // 1st request (60 tokens)
    const r1 = manager.selectCandidate(context);
    manager.recordStarted(r1.selection!, 60);

    // 2nd request (60 tokens) -> 120 total > 100 TPM
    const r2 = manager.selectCandidate(context);
    expect(r2.selection).toBeNull();
    expect(r2.nextWakeAt).toBe(1000 + 60000);
  });

  it('applies soft penalties based on origin/usage ratio', () => {
    let now = 1000;
    const histories = createEmptyQuotaHistories();
    const manager = new QuotaManager(mockClock(now), histories);
    
    // For 'ui' origin, soft ratio is 0.85
    // RPM=2, softMax = floor(2 * 0.85) = 1
    const context = buildQuotaContext({ 
      route: { service: 'text', modelBucket: 'text' },
      origin: 'ui'
    });

    // 1st request
    const r1 = manager.selectCandidate(context);
    expect(r1.selection!.softPenalty).toBe(0);
    manager.recordStarted(r1.selection!, 1);

    // 2nd request - within hard limit (RPM=2) but exceeds soft limit (1)
    const r2 = manager.selectCandidate(context);
    expect(r2.selection).not.toBeNull();
    expect(r2.selection!.softPenalty).toBeGreaterThan(0);
  });

  it('marks model as busy and applies penalty', () => {
    let now = 1000;
    const histories = createEmptyQuotaHistories();
    const clock = { now: () => now };
    const manager = new QuotaManager(clock, histories);
    const context = buildQuotaContext({ route: { service: 'text' } });

    manager.markModelBusy('test-model');
    
    const r1 = manager.selectCandidate(context);
    expect(r1.selection!.softPenalty).toBeGreaterThanOrEqual(100);

    // Advance time past cooldown
    now += 31000;
    const r2 = manager.selectCandidate(context);
    expect(r2.selection!.softPenalty).toBe(0);
  });

  it('disables model when not found (404)', () => {
    let now = 1000;
    const histories = createEmptyQuotaHistories();
    const clock = { now: () => now };
    const manager = new QuotaManager(clock, histories);
    const context = buildQuotaContext({ route: { service: 'text' } });

    const modelB: modelCatalog.LLMModelDefinition = { ...mockModel, id: 'model-b' };
    vi.mocked(modelCatalog.getCandidateModels).mockReturnValue([mockModel, modelB]);

    manager.markModelNotFound('test-model');

    const r1 = manager.selectCandidate(context);
    // Should fallback to next model
    expect(r1.selection!.route.model).toBe('model-b');

    // Advance time past disable duration
    now += 11 * 60 * 1000;
    const r2 = manager.selectCandidate(context);
    expect(r2.selection!.route.model).toBe('test-model');
  });

  it('prunes old history events', () => {
    let now = 1000;
    const histories = createEmptyQuotaHistories();
    const clock = { now: () => now };
    const manager = new QuotaManager(clock, histories);
    const context = buildQuotaContext({ route: { service: 'text' } });

    const r1 = manager.selectCandidate(context);
    manager.recordStarted(r1.selection!, 10);
    
    // Advance time by 2 minutes
    now += 120000;
    
    const r2 = manager.selectCandidate(context);
    expect(r2.selection).not.toBeNull();
    // History should be pruned and r2 should have 0 penalty
    expect(r2.selection!.softPenalty).toBe(0);
  });
});
