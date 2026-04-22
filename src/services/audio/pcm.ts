export const pcmToWavUrl = (base64Data: string, sampleRate: number) => {
  const binaryString = atob(base64Data);
  const originalPcmBuffer = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    originalPcmBuffer[i] = binaryString.charCodeAt(i);
  }

  const silenceDuration = 0.25;
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleRateInt = Number.parseInt(String(sampleRate), 10);
  let silenceBytes =
    Math.floor(sampleRateInt * silenceDuration) * numChannels * bytesPerSample;

  if (silenceBytes % 2 !== 0) {
    silenceBytes += 1;
  }

  const pcmBuffer = new Uint8Array(silenceBytes + originalPcmBuffer.length);
  pcmBuffer.set(originalPcmBuffer, silenceBytes);

  const byteRate = sampleRateInt * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = pcmBuffer.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRateInt, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcmBuffer);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
};
