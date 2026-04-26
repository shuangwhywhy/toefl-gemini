# P0: Interview Training Voice-First Core

## Summary
- Implement the P0 scope from `plans/interview_training_implementation_plan.md`.
- Interview Training becomes voice-first: hidden prompt text, prompt audio controls, audio recording as the main answer path, and raw answer audio sent to Gemini for evaluation.
- Full Shadowing component migration, polished result cards, and P2 mobile/timestamp refinements stay out of this pass.

## Key Changes
- Add prompt audio state to each interview question, initialize it from generated/preloaded Q1 audio when available, and regenerate TTS with `fetchNeuralTTS` when a restored session lacks a usable URL.
- Replace `CurrentQuestionPanel` with a Shadowing-style prompt audio panel: play/pause/replay, rate, listen count, show/hide text, hidden-by-default question text, and prompt usage updates.
- Rewrite `StageAttemptPanel` around a `VoiceAnswerRecorder` state flow: idle, recording, recorded preview, submitting, error; recording cancel creates no attempt.
- Keep text entry only as a collapsed fallback path, marked `inputType: "text"`.
- Remove Interview Training’s audio-submit transcription step. Audio submissions save the raw blob, then evaluate that blob directly.
- Add timed-answer behavior only for `thinking_structure` and `final_practice`: visible timer, color bands for `<35`, `35-40`, `40-45`, `>45`, and one 220Hz beep at the 45s threshold.
- Build cross-question text context only for `thinking_structure` and `final_practice`, selecting at most one complete text answer from each other question.

## Interfaces And Data
- Extend `TrainingAttempt` with `answerLanguage`, `promptUsage`, and `timingWindow`; keep legacy `transcribed` status accepted for old data but stop creating it in the new audio path.
- Extend `InterviewTrainingQuestion` with `promptAudio` and durable `promptUsage`.
- Add normalization for restored sessions and attempts so missing P0 fields receive defaults instead of corrupting the active session.
- Change `saveTrainingAttempt(attempt, audioBlob?)` to return the persisted attempt, including `audioBlobId` when audio is saved.
- Add a shared audio-part helper, for example `buildInlineAudioPartFromBlob(blob)`, and use it from `evaluateInterviewTrainingStage` so the Interview evaluation service does not inline its own base64 conversion.
- Update `evaluateInterviewTrainingStage` to accept either `audioBlob` or text fallback, plus `promptUsage`, `timingWindow`, and optional cross-question context.
- Update the prompt/schema so model output can include `displayTranscript`, `displayTranscriptSegments`, `timeAnalysis`, `questionComprehensionAnalysis`, and `crossQuestionConsistency`, stored under evaluation `details`.

## Test Plan
- Add context-selection tests covering enabled stages, disabled middle stages, one answer per other question, and display-transcript/text-fallback sources.
- Add recorder tests for cancel, stop/preview, reset, supported MIME selection, timer categories, and single 45s beep.
- Add evaluation tests proving audio submissions create parts with current raw audio and text context only, with no transcription call.
- Add UI tests for hidden prompt text by default, show/hide metadata, listen count metadata, voice-first recorder controls, and collapsed text fallback.
- Run `npm test` and `npm run build`.

## Assumptions
- Scope is P0 only, per selection.
- Prompt audio attempts browser-safe autoplay only when feasible; if blocked, the play CTA remains the expected user action.
- The new prompt audio panel may live in shared audio files and visually match Shadowing, but migrating Shadowing itself onto that shared component is deferred to P1.
- Result UI in P0 adds functional display inside the existing feedback panel; dedicated cards and richer transcript visualization remain P1.
