import { useCallback, useEffect, useRef } from 'react';
import { getLLMClient } from './llm/client';

let scopeCounter = 0;

export const createScopeId = (prefix = 'scope') =>
  `${prefix}:${Date.now().toString(36)}:${(++scopeCounter).toString(36)}`;

export const useRequestScope = (prefix = 'scope') => {
  const scopeIdRef = useRef(createScopeId(prefix));
  const sessionRef = useRef(0);

  const beginSession = useCallback(() => {
    sessionRef.current += 1;
    return sessionRef.current;
  }, []);

  const isSessionCurrent = useCallback((token: number) => {
    return sessionRef.current === token;
  }, []);

  const invalidateSession = useCallback(() => {
    sessionRef.current += 1;
    getLLMClient().cancelPendingByScope(scopeIdRef.current);
    return sessionRef.current;
  }, []);

  useEffect(() => {
    return () => {
      getLLMClient().cancelPendingByScope(scopeIdRef.current);
      sessionRef.current += 1;
    };
  }, []);

  return {
    scopeId: scopeIdRef.current,
    beginSession,
    isSessionCurrent,
    invalidateSession
  };
};
