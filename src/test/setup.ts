import '@testing-library/jest-dom';

if (typeof window !== 'undefined' && !window.crypto) {
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    writable: true,
    value: {
      randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(2, 9)
    }
  });
}

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

if (typeof window !== 'undefined') {
  window.Element.prototype.scrollIntoView = () => {};
}

if (typeof window !== 'undefined') {
  vi.stubGlobal('scrollTo', vi.fn());
  window.Element.prototype.scrollIntoView = vi.fn();
}

