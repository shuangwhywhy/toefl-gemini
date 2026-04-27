import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  fetchGeminiTextMock: vi.fn(),
  fetchNeuralTtsMock: vi.fn()
}));

vi.mock('../services/llm/helpers', () => ({
  fetchGeminiText: hoisted.fetchGeminiTextMock,
  fetchNeuralTTS: hoisted.fetchNeuralTtsMock
}));

import {
  INTERVIEW_PROMPT_VERSION,
  buildInterviewPrompt,
  generateInterviewSession,
  mapInterviewPayloadToSession
} from '../features/interview/interviewGeneration';

describe('interview generation helpers', () => {
  beforeEach(() => {
    hoisted.fetchGeminiTextMock.mockReset();
    hoisted.fetchNeuralTtsMock.mockReset();
  });

  it('builds a 2026 prompt with fixed question roles and no scene examples', () => {
    const prompt = buildInterviewPrompt('seed-2026');

    expect(prompt).toContain('2026 TOEFL iBT Speaking "Take an Interview" task');
    expect(prompt).toContain('It is not the old independent speaking task.');
    expect(prompt).toContain('It is not an integrated speaking task.');
    expect(prompt).toContain('Q1 must anchor the interview in the test taker\'s personal reality.');
    expect(prompt).toContain('Q4 must raise the level again.');
    expect(prompt).toContain('There will be no downstream semantic correction step.');
    expect(prompt).toContain('"q1":"..."');
    expect(prompt).toContain('seed-2026');

    expect(prompt).not.toMatch(/\be\.g\./i);
    expect(prompt).not.toMatch(/\bfor example\b/i);
    expect(prompt).not.toMatch(/\bsuch as\b/i);
    expect(prompt).not.toMatch(/\bcandidate pool\b/i);
    expect(prompt).not.toMatch(/\bbucket\b/i);
    expect(prompt).not.toMatch(/\blist\b/i);
    expect(prompt).not.toMatch(/\btechnology\b/i);
    expect(prompt).not.toMatch(/\beducation\b/i);
    expect(prompt).not.toMatch(/\benvironment\b/i);
    expect(prompt).not.toMatch(/\bcampus\b/i);
  });

  it('maps q1-q4 into the runtime question array with fixed roles', () => {
    const session = mapInterviewPayloadToSession({
      topic: 'Library seat reservations during exam week',
      q1: 'What do you usually do when you cannot find a quiet seat in the library?',
      q2: 'Would you rather reserve a seat in advance or look for one in person?',
      q3: 'Do you think seat reservation systems are a good idea for students?',
      q4: 'How might reservation systems affect students in the future?'
    });

    expect(session.topic).toBe('Library seat reservations during exam week');
    expect(session.questions).toEqual([
      {
        role: 'personal_anchor',
        text: 'What do you usually do when you cannot find a quiet seat in the library?',
        audioUrl: null
      },
      {
        role: 'personal_choice',
        text: 'Would you rather reserve a seat in advance or look for one in person?',
        audioUrl: null
      },
      {
        role: 'broad_opinion',
        text: 'Do you think seat reservation systems are a good idea for students?',
        audioUrl: null
      },
      {
        role: 'future_or_tradeoff',
        text: 'How might reservation systems affect students in the future?',
        audioUrl: null
      }
    ]);
  });

  it('generates interview content in one pass without semantic validator retries', async () => {
    hoisted.fetchGeminiTextMock.mockResolvedValue({
      topic: 'Shared electric scooters near a train station',
      q1: 'How often do you use shared electric scooters near a train station?',
      q2: 'Would you rather use a scooter or walk when you are in a hurry?',
      q3: 'Do you think shared scooters are helpful in crowded areas?',
      q4: 'What long-term effects could shared scooters have on city transportation?'
    });
    hoisted.fetchNeuralTtsMock.mockResolvedValue('https://example.com/q1.wav');

    const session = await generateInterviewSession({
      voice: 'Puck',
      scopeId: 'interview-scope',
      supersedeKey: 'interview:generate',
      firstTtsSupersedeKey: 'interview:first-tts',
      mode: 'manual',
      seed: 'manual-seed'
    });

    expect(hoisted.fetchGeminiTextMock).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchNeuralTtsMock).toHaveBeenCalledTimes(1);

    const [
      prompt,
      temperature,
      maxOutputTokens,
      schema,
      signal,
      validator,
      requestOptions
    ] = hoisted.fetchGeminiTextMock.mock.calls[0];

    expect(prompt).toContain('manual-seed');
    expect(temperature).toBe(0.9);
    expect(maxOutputTokens).toBe(900);
    expect(schema.required).toEqual(['topic', 'q1', 'q2', 'q3', 'q4']);
    expect(signal).toBeNull();
    expect(validator).toBeNull();
    expect(requestOptions).toMatchObject({
      scopeId: 'interview-scope',
      supersedeKey: 'interview:generate',
      isBackground: false,
      origin: 'ui',
      sceneKey: 'interview:generate',
      disableJsonFixer: true,
      businessContext: {
        task: 'interview',
        promptVersion: INTERVIEW_PROMPT_VERSION
      }
    });

    expect(hoisted.fetchNeuralTtsMock).toHaveBeenCalledWith(
      'Puck',
      'How often do you use shared electric scooters near a train station?',
      null,
      {
        scopeId: 'interview-scope',
        supersedeKey: 'interview:first-tts',
        origin: 'ui',
        sceneKey: 'interview:first-tts',
        isBackground: false
      }
    );

    expect(session.questions[0].audioUrl).toBe('https://example.com/q1.wav');
  });

  it('verifies background generation options', async () => {
    hoisted.fetchGeminiTextMock.mockResolvedValue({
      topic: 'Topic', q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4'
    });
    hoisted.fetchNeuralTtsMock.mockResolvedValue('url');

    await generateInterviewSession({
      voice: 'Puck',
      scopeId: 'bg-scope',
      supersedeKey: 'bg-gen',
      firstTtsSupersedeKey: 'bg-tts',
      mode: 'preload',
      isBackground: true
    });

    const geminiOptions = hoisted.fetchGeminiTextMock.mock.calls[0][6];
    expect(geminiOptions).toMatchObject({
      scopeId: 'bg-scope',
      isBackground: true,
      origin: 'preload'
    });

    const ttsOptions = hoisted.fetchNeuralTtsMock.mock.calls[0][3];
    expect(ttsOptions).toMatchObject({
      scopeId: 'bg-scope',
      isBackground: true,
      origin: 'preload'
    });
  });
});
