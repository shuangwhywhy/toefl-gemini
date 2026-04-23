import { toRetryFailure } from '../../services/llm/retry';

export const getLengthDescription = (level: number) => {
  const descriptions = [
    'extremely short (around 5-7 words)',
    'very short (around 8-10 words)',
    'short (around 11-13 words)',
    'moderately short (around 14-16 words)',
    'medium length (around 17-19 words)',
    'average length (around 20-22 words)',
    'moderately long (around 23-26 words)',
    'long (around 27-30 words)',
    'very long (around 31-35 words)',
    'extremely long and complex (36+ words)'
  ];

  return descriptions[Math.max(0, Math.min(9, level - 1))];
};

export const getDifficultyDescription = (level: number) => {
  const descriptions = [
    'extremely basic, beginner-level everyday words',
    'very simple, familiar daily vocabulary',
    'simple conversational words',
    'mostly simple words with one slightly less common term',
    'standard intermediate vocabulary typical of college students',
    'intermediate vocabulary with a touch of formal phrasing',
    'fairly advanced vocabulary including one academic word',
    'advanced, formal vocabulary with typical TOEFL-level academic terms',
    'highly advanced vocabulary with precise academic terminology',
    'expert-level, highly sophisticated and nuanced academic terminology'
  ];

  return descriptions[Math.max(0, Math.min(9, level - 1))];
};

export const buildRetryAwareMessage = (
  fallbackMessage: string,
  error: unknown
) => {
  const retryError = toRetryFailure(error);
  const baseMessage = retryError.failure.userMessage || fallbackMessage;
  if (retryError.retries === 0) {
    return baseMessage;
  }

  const normalized = baseMessage
    .replace(/请稍后(?:调整后)?重试。?$/, '')
    .replace(/。$/, '');

  return `${normalized}。系统已自动重试 ${retryError.retries} 次，请稍后重试。`;
};
