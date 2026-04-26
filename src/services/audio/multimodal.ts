export type InlineAudioPart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

export const blobToBase64Data = async (blob: Blob) =>
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Audio read failed.'));
    reader.onloadend = () => {
      const [, data = ''] = String(reader.result ?? '').split(',');
      resolve(data);
    };
    reader.readAsDataURL(blob);
  });

export async function buildInlineAudioPartFromBlob(
  blob: Blob
): Promise<InlineAudioPart> {
  const data = await blobToBase64Data(blob);
  return {
    inlineData: {
      mimeType: blob.type || 'audio/webm',
      data
    }
  };
}
