export const TTS_MAX_UTTERANCE_LENGTH = 32768;
const DEFAULT_CHUNK_SIZE = 2800;
export const SUMMARY_AUDIO_MAX_CHARS = 12000;

function normalizeLineForSpeech(line: string): string {
  let out = line.trim();
  if (!out) return "";

  out = out
    .replace(/^#{1,6}\s*/g, "")
    .replace(/^\s*[-*+]\s+/g, "")
    .replace(/^\s*\d+[.)]\s+/g, "")
    .replace(/\(\s*snippet\s*:\s*[^)]+\)/gi, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[#*_~`>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!out) return "";
  const endsWithPunctuation = /[.!?;:]$/.test(out);
  return endsWithPunctuation ? out : `${out}.`;
}

export function normalizeSummaryForSpeech(summaryText: string): { text: string; wasTrimmed: boolean } {
  const withoutCode = summaryText
    .replace(/\r/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[-=]{3,}\s*$/gm, " ");
  const lines = withoutCode
    .split("\n")
    .map(normalizeLineForSpeech)
    .filter(Boolean);
  const merged = lines
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\.\s+\./g, ".")
    .trim();

  if (!merged) return { text: "", wasTrimmed: false };

  const suffix = " Summary shortened for audio.";
  if (merged.length <= SUMMARY_AUDIO_MAX_CHARS) {
    return { text: merged, wasTrimmed: false };
  }
  const room = Math.max(0, SUMMARY_AUDIO_MAX_CHARS - suffix.length);
  return {
    text: `${merged.slice(0, room).trimEnd()}${suffix}`,
    wasTrimmed: true,
  };
}

function splitByWords(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    current = word.length > maxChars ? word.slice(0, maxChars) : word;
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitBySentences(text: string, maxChars: number): string[] {
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return splitByWords(text, maxChars);

  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }
    const broken = splitByWords(sentence, maxChars);
    chunks.push(...broken.slice(0, -1));
    current = broken[broken.length - 1] ?? "";
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitTextForTts(text: string, chunkSize = DEFAULT_CHUNK_SIZE): string[] {
  const sanitized = text.replace(/\r/g, "").trim();
  if (!sanitized) return [];
  const hardCap = Math.max(512, Math.min(chunkSize, TTS_MAX_UTTERANCE_LENGTH));
  const paragraphs = sanitized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= hardCap) {
      chunks.push(paragraph);
      continue;
    }
    chunks.push(...splitBySentences(paragraph, hardCap));
  }
  return chunks;
}

export function filterLocalVoices(voices: chrome.tts.TtsVoice[]): chrome.tts.TtsVoice[] {
  return voices.filter((voice) => voice.remote !== true);
}
