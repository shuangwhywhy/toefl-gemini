import React, { useEffect, useState } from 'react';
import {
  DeviceSetupModule,
  ListeningMenuModule,
  MainMenuModule,
  PreloadStatus,
  SpeakingMenuModule
} from '../features/navigation/MenuModules';
import {
  ListeningDictationModule,
  ListeningPracticeModule
} from '../features/listening/ListeningModules';
import { ShadowingModule } from '../features/shadowing/ShadowingModule';
import { InterviewModule } from '../features/interview/InterviewModule';
import {
  DEFAULT_SHADOW_VOICE,
  queueDictationPreload,
  queueInterviewPreload,
  queueListeningPreload,
  queueShadowPreload
} from '../features/shared/preloadTasks';

type AppMode =
  | 'setup'
  | 'main_menu'
  | 'speaking_menu'
  | 'listening_menu'
  | 'shadow'
  | 'interview'
  | 'listening_practice'
  | 'listening_dictation';

const initialPreloadStatus: PreloadStatus = {
  shadow: false,
  interview: false,
  listening: false,
  dictation: false,
  shadowError: false,
  interviewError: false,
  listeningError: false,
  dictationError: false
};

export { ListeningDictationModule, ListeningPracticeModule, InterviewModule };

export default function ToeflTrainerApp() {
  const [mode, setMode] = useState<AppMode>('setup');
  const [preloadStatus, setPreloadStatus] =
    useState<PreloadStatus>(initialPreloadStatus);

  useEffect(() => {
    const handlePreloadReady = (event: Event) => {
      const customEvent = event as CustomEvent<{ type: string }>;
      if (customEvent.detail.type === 'shadow') {
        setPreloadStatus((current) => ({
          ...current,
          shadow: true,
          shadowError: false
        }));
      }
      if (customEvent.detail.type === 'interview') {
        setPreloadStatus((current) => ({
          ...current,
          interview: true,
          interviewError: false
        }));
      }
      if (customEvent.detail.type === 'listening') {
        setPreloadStatus((current) => ({
          ...current,
          listening: true,
          listeningError: false
        }));
      }
      if (customEvent.detail.type === 'dictation') {
        setPreloadStatus((current) => ({
          ...current,
          dictation: true,
          dictationError: false
        }));
      }
    };

    const handlePreloadError = (event: Event) => {
      const customEvent = event as CustomEvent<{ type: string }>;
      if (customEvent.detail.type === 'shadow') {
        setPreloadStatus((current) => ({ ...current, shadowError: true }));
      }
      if (customEvent.detail.type === 'interview') {
        setPreloadStatus((current) => ({ ...current, interviewError: true }));
      }
      if (customEvent.detail.type === 'listening') {
        setPreloadStatus((current) => ({ ...current, listeningError: true }));
      }
      if (customEvent.detail.type === 'dictation') {
        setPreloadStatus((current) => ({ ...current, dictationError: true }));
      }
    };

    window.addEventListener('preload-ready', handlePreloadReady);
    window.addEventListener('preload-error', handlePreloadError);
    return () => {
      window.removeEventListener('preload-ready', handlePreloadReady);
      window.removeEventListener('preload-error', handlePreloadError);
    };
  }, []);

  useEffect(() => {
    if (mode === 'setup') {
      return;
    }

    const timer = window.setTimeout(() => {
      // Staggered launch to prevent concurrent "Preload Storm"
      setTimeout(() => {
        try {
          queueShadowPreload(3, 'general daily English', 5, DEFAULT_SHADOW_VOICE);
        } catch {
          // Ignore preload errors
        }
      }, 0);

      setTimeout(() => {
        try {
          queueInterviewPreload('Puck');
        } catch {
          // Ignore preload errors
        }
      }, 1000);

      setTimeout(() => {
        try {
          queueListeningPreload();
        } catch {
          // Ignore preload errors
        }
      }, 2000);

      setTimeout(() => {
        try {
          queueDictationPreload();
        } catch {
          // Ignore preload errors
        }
      }, 3000);
    }, 800);

    return () => clearTimeout(timer);
  }, [mode]);

  if (mode === 'setup') {
    return <DeviceSetupModule onComplete={() => setMode('main_menu')} />;
  }

  if (mode === 'main_menu') {
    return <MainMenuModule onNavigate={(nextMode) => setMode(nextMode as AppMode)} />;
  }

  if (mode === 'speaking_menu') {
    return (
      <SpeakingMenuModule
        onNavigate={(nextMode) => setMode(nextMode as AppMode)}
        onBack={() => setMode('main_menu')}
        preloadStatus={preloadStatus}
      />
    );
  }

  if (mode === 'listening_menu') {
    return (
      <ListeningMenuModule
        onNavigate={(nextMode) => setMode(nextMode as AppMode)}
        onBack={() => setMode('main_menu')}
        preloadStatus={preloadStatus}
      />
    );
  }

  if (mode === 'shadow') {
    return <ShadowingModule onBack={() => setMode('speaking_menu')} />;
  }

  if (mode === 'interview') {
    return <InterviewModule onBack={() => setMode('speaking_menu')} />;
  }

  if (mode === 'listening_practice') {
    return <ListeningPracticeModule onBack={() => setMode('listening_menu')} />;
  }

  if (mode === 'listening_dictation') {
    return <ListeningDictationModule onBack={() => setMode('listening_menu')} />;
  }

  return null;
}
