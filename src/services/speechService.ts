import { sakuraFetch } from "./sakuraAI";

interface SpeechRequest {
  model: string;
  input: string;
  voice: string;
  response_format: string;
}

export type VoiceStyle = "normal" | "happy" | "angry" | "sad";

export async function synthesizeSpeech(
  text: string,
  options: {
    model?: string;
    voice?: VoiceStyle;
  } = {},
): Promise<Blob> {
  const { model = "zundamon", voice = "normal" } = options;

  // さくらのAI Engineの音声合成は1000文字程度の制限あり
  const truncatedText = text.slice(0, 1000);

  const request: SpeechRequest = {
    model,
    input: truncatedText,
    voice,
    response_format: "wav",
  };

  const blob = await sakuraFetch<Blob>("/audio/speech", {
    body: request,
    responseType: "blob",
  });

  return blob;
}

export function createAudioUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokeAudioUrl(url: string): void {
  URL.revokeObjectURL(url);
}

export async function playAudio(audioUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(audioUrl);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("Failed to play audio"));
    audio.play().catch(reject);
  });
}

export async function speakText(text: string): Promise<void> {
  const blob = await synthesizeSpeech(text);
  const url = createAudioUrl(blob);
  try {
    await playAudio(url);
  } finally {
    revokeAudioUrl(url);
  }
}
