import {
  fetchConversationTTS,
  fetchGeminiText,
  fetchNeuralTTS,
  processDictationText
} from '../../services/llm/helpers';
import { PreloadPipeline } from '../../services/preload/orchestrator';
import {
  getDifficultyDescription,
  getLengthDescription
} from './trainingUtils';

export const DEFAULT_SHADOW_VOICE = 'Aoede';

export const queueShadowPreload = (
  lengthLevel: number,
  learningFocus: string,
  difficultyLevel: number,
  voice: string
) => {
  const safeLengthLvl = parseInt(String(lengthLevel), 10) || 3;
  const safeDiffLvl = parseInt(String(difficultyLevel), 10) || 5;
  const fingerprint = JSON.stringify({
    lengthLevel: safeLengthLvl,
    learningFocus,
    difficultyLevel: safeDiffLvl,
    voice
  });

  PreloadPipeline.enqueue('shadow_preload', fingerprint, async (signal) => {
    const scopeId = 'preload:shadow';
    if (PreloadPipeline.cache.shadow) {
      const cached = PreloadPipeline.cache.shadow;
      if (
        cached.lengthLevel === safeLengthLvl &&
        cached.learningFocus === learningFocus &&
        cached.difficultyLevel === safeDiffLvl
      ) {
        return;
      }
    }

    try {
      const lengthDesc = getLengthDescription(safeLengthLvl);
      const diffDesc = getDifficultyDescription(safeDiffLvl);

      const prompt = `Act as an expert English teacher. Generate ONE complete English sentence.
      
      STRICT REQUIREMENTS:
      1. Length & Structure: The sentence should be ${lengthDesc}. (Never output short fragments).
      2. Topic: "${learningFocus}". Choose a specific TOEFL-style context (e.g., campus life, biology, history, etc.).
      3. Vocabulary: Use ${diffDesc}.
      
      CRITICAL INSTRUCTION: Output ONLY the actual English sentence as the value for the "sentence" key. DO NOT include any conversational filler like "Here is the sentence:" inside the JSON.`;

      const schema = {
        type: 'OBJECT',
        properties: { sentence: { type: 'STRING' } },
        required: ['sentence']
      };

      const validator = (data: { sentence?: string }) => {
        if (!data || typeof data.sentence !== 'string') {
          throw new Error('Invalid format');
        }

        let text = data.sentence.trim();
        if (text.split(/\s+/).length < Math.max(4, safeLengthLvl + 2)) {
          throw new Error('Sentence too short fragment');
        }

        if (!/[.!?]["']?$/.test(text)) {
          data.sentence = `${text}.`;
          text = data.sentence;
        }

        if (/^(here is|here's|sure|certainly|the json|json requested)/i.test(text)) {
          throw new Error('Contains AI filler');
        }
      };

      const data = await fetchGeminiText(prompt, 0.7, 400, schema, signal, validator, {
        scopeId,
        supersedeKey: 'shadow:sentence',
        isBackground: true
      });
      const sentence = data.sentence.trim();
      const audioUrl = await fetchNeuralTTS(voice, sentence, signal, {
        scopeId,
        supersedeKey: 'shadow:tts',
        isBackground: true
      });

      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      PreloadPipeline.cache.shadow = {
        text: sentence,
        audioUrl,
        voice,
        lengthLevel: safeLengthLvl,
        difficultyLevel: safeDiffLvl,
        learningFocus
      };
      window.dispatchEvent(new CustomEvent('preload-ready', { detail: { type: 'shadow' } }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('preload-error', { detail: { type: 'shadow' } }));
      throw error;
    }
  });
};

export const queueInterviewPreload = (voice: string) => {
  const fingerprint = JSON.stringify({ voice });
  PreloadPipeline.enqueue('interview_preload', fingerprint, async (signal) => {
    const scopeId = 'preload:interview';
    if (PreloadPipeline.cache.interview) {
      return;
    }

    try {
      const prompt = `Generate a 4-question TOEFL mock interview on a random specific topic. 
      Progression: Q1(Personal experience), Q2(Opinion/Choice), Q3(Broader social/campus impact), Q4(Complex trade-offs/Future prediction). 
      Return JSON: {"topic": "...", "questions": ["...", "...", "...", "..."]}`;

      const schema = {
        type: 'OBJECT',
        properties: {
          topic: { type: 'STRING' },
          questions: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['topic', 'questions']
      };

      const data = await fetchGeminiText(prompt, 0.9, 800, schema, signal, null, {
        scopeId,
        supersedeKey: 'interview:paper',
        isBackground: true
      });
      if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error('Invalid output format');
      }

      const questionsWithAudio = data.questions.map((question: string) => ({
        text: question,
        audioUrl: null
      }));
      questionsWithAudio[0].audioUrl = await fetchNeuralTTS(
        voice,
        questionsWithAudio[0].text,
        signal,
        {
          scopeId,
          supersedeKey: 'interview:first-tts',
          isBackground: true
        }
      );

      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      PreloadPipeline.cache.interview = {
        topic: data.topic,
        questions: questionsWithAudio
      };
      window.dispatchEvent(
        new CustomEvent('preload-ready', { detail: { type: 'interview' } })
      );
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent('preload-error', { detail: { type: 'interview' } })
      );
      throw error;
    }
  });
};

export const queueListeningPreload = () => {
  PreloadPipeline.enqueue('listening_preload', 'default', async (signal) => {
    const scopeId = 'preload:listening';
    if (PreloadPipeline.cache.listening) {
      return;
    }

    try {
      const prompt = `Generate a 180-250 word TOEFL campus conversation. Format exactly with 'Student:' and 'Professor:'.
      Topic: A random specific campus issue.
      Return JSON: {"topic": "...", "transcript": "...", "truth": {"who": "...", "problem": "...", "reason": "...", "solution": "...", "nextStep": "..."}}`;

      const schema = {
        type: 'OBJECT',
        properties: {
          topic: { type: 'STRING' },
          transcript: { type: 'STRING' },
          truth: {
            type: 'OBJECT',
            properties: {
              who: { type: 'STRING' },
              problem: { type: 'STRING' },
              reason: { type: 'STRING' },
              solution: { type: 'STRING' },
              nextStep: { type: 'STRING' }
            },
            required: ['who', 'problem', 'reason', 'solution', 'nextStep']
          }
        },
        required: ['topic', 'transcript', 'truth']
      };

      const data = await fetchGeminiText(prompt, 0.9, 2000, schema, signal, null, {
        scopeId,
        supersedeKey: 'listening:conversation',
        isBackground: true
      });
      if (!data || !data.transcript) {
        throw new Error('Invalid output format');
      }

      const audioUrl = await fetchConversationTTS(data.transcript, signal, {
        scopeId,
        supersedeKey: 'listening:tts',
        isBackground: true
      });
      if (!audioUrl) {
        throw new Error('Audio generation format failed');
      }

      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      PreloadPipeline.cache.listening = { ...data, audioUrl };
      window.dispatchEvent(
        new CustomEvent('preload-ready', { detail: { type: 'listening' } })
      );
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent('preload-error', { detail: { type: 'listening' } })
      );
      throw error;
    }
  });
};

export const queueDictationPreload = () => {
  PreloadPipeline.enqueue('dictation_preload', 'default', async (signal) => {
    const scopeId = 'preload:dictation';
    if (PreloadPipeline.cache.dictation) {
      return;
    }

    try {
      const prompt = `Generate an 80-100 word academic lecture passage on a random advanced topic (e.g. biology, history, astronomy). 
      Return JSON: {"topic": "...", "text": "..."}`;

      const schema = {
        type: 'OBJECT',
        properties: {
          topic: { type: 'STRING' },
          text: { type: 'STRING' }
        },
        required: ['topic', 'text']
      };

      const data = await fetchGeminiText(prompt, 0.9, 2000, schema, signal, null, {
        scopeId,
        supersedeKey: 'dictation:text',
        isBackground: true
      });
      const tokens = processDictationText(data.text);
      const audioUrl = await fetchNeuralTTS('Charon', data.text, signal, {
        scopeId,
        supersedeKey: 'dictation:tts',
        isBackground: true
      });
      if (!audioUrl) {
        throw new Error('Audio generation failed');
      }

      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      PreloadPipeline.cache.dictation = { ...data, tokens, audioUrl };
      window.dispatchEvent(
        new CustomEvent('preload-ready', { detail: { type: 'dictation' } })
      );
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent('preload-error', { detail: { type: 'dictation' } })
      );
      throw error;
    }
  });
};
