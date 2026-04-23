import '@testing-library/jest-dom';

if (typeof HTMLMediaElement !== 'undefined') {
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value: () => undefined
  });

  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: async () => undefined
  });
}

if (typeof window !== 'undefined' && !window.speechSynthesis) {
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: {
      speak: () => undefined,
      cancel: () => undefined,
      pause: () => undefined,
      resume: () => undefined
    }
  });
}
