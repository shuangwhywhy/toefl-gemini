interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_GEMINI_TEXT_MODEL?: string;
  readonly VITE_GEMINI_TTS_MODEL?: string;
  readonly VITE_GEMINI_TRANSCRIBE_MODEL?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_TEXT_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
