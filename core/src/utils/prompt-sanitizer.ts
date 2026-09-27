interface SanitizeStats {
  originalLength: number;
  sanitizedLength: number;
  removedChars: number;
  removedWords: number;
  removedFillers: number;
  dedupedLines: number;
  dedupedSentences: number;
  percentReduced: number;
}

interface SanitizeOptions {
  fillerWords?: string[];
  dedupeSentences?: boolean;
  dedupeLines?: boolean;
  dedupeRepeatedWords?: boolean;
  collapseWhitespace?: boolean;
}

const DEFAULT_FILLER_WORDS = [
  'um', 'uh', 'er', 'hmm', 'like', 'actually', 'basically', 'literally',
  'honestly', 'seriously', 'kinda', 'sorta', 'really', 'very', 'just',
  'yeah', 'okay', 'ok', 'you know', 'i mean', 'i guess', 'kind of', 'sort of',
];

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function splitSentences(line: string): string[] {
  return line.match(/[^.!?]+[.!?]*/g) ?? [line];
}

function sanitizePrompt(input: string, options: SanitizeOptions = {}): { text: string; stats: SanitizeStats } {
  const originalLength = input.length;
  const originalWords = countWords(input);

  const collapseWhitespace = options.collapseWhitespace ?? true;
  const dedupeLines = options.dedupeLines ?? true;
  const dedupeSentences = options.dedupeSentences ?? true;
  const dedupeRepeatedWords = options.dedupeRepeatedWords ?? true;
  const fillerWords = (options.fillerWords ?? DEFAULT_FILLER_WORDS)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);

  let dedupedLines = 0;
  let dedupedSentences = 0;
  let removedFillers = 0;
  let text = input;

  if (collapseWhitespace) {
    const lines = text.split('\n');
    const kept: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      kept.push(trimmed);
    }
    text = kept.join('\n');
    text = text.replace(/[ \t]{2,}/g, ' ');
    text = text.replace(/([.!?])\1+/g, '$1');
  }

  if (dedupeLines) {
    const lines = text.split('\n');
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const line of lines) {
      const key = line.trim().toLowerCase();
      if (key && seen.has(key)) {
        dedupedLines += 1;
        continue;
      }
      if (key) seen.add(key);
      kept.push(line);
    }
    text = kept.join('\n');
  }

  if (dedupeSentences) {
    const keptLines: string[] = [];
    for (const line of text.split('\n')) {
      const sentences = splitSentences(line.trim());
      const seen = new Set<string>();
      const kept: string[] = [];
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        const key = trimmed.toLowerCase();
        if (key && seen.has(key)) {
          dedupedSentences += 1;
          continue;
        }
        if (key) seen.add(key);
        kept.push(trimmed);
      }
      keptLines.push(kept.join(' '));
    }
    text = keptLines.join('\n');
  }

  if (dedupeRepeatedWords) {
    const keptLines: string[] = [];
    for (const line of text.split('\n')) {
      const words = line.split(/\s+/);
      const kept: string[] = [];
      for (let i = 0; i < words.length; i++) {
        if (i > 0 && words[i].toLowerCase() === words[i - 1].toLowerCase()) continue;
        kept.push(words[i]);
      }
      keptLines.push(kept.join(' '));
    }
    text = keptLines.join('\n');
  }

  if (fillerWords.length > 0) {
    const sorted = [...fillerWords].sort((a, b) => b.length - a.length);
    for (const word of sorted) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:,\\s*)?\\b${escaped}\\b,?`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        removedFillers += matches.length;
        text = text.replace(regex, ' ');
      }
    }
    text = text.replace(/ {2,}/g, ' ');
    text = text.replace(/[ \t]+([,.;:!?])/g, '$1');
    text = text.trim();
  }

  const sanitizedLength = text.length;
  const removedChars = originalLength - sanitizedLength;
  const removedWords = originalWords - countWords(text);
  const percentReduced = originalLength > 0 ? Math.round((removedChars / originalLength) * 100) : 0;

  return {
    text,
    stats: {
      originalLength,
      sanitizedLength,
      removedChars,
      removedWords,
      removedFillers,
      dedupedLines,
      dedupedSentences,
      percentReduced,
    },
  };
}

export { sanitizePrompt, DEFAULT_FILLER_WORDS, SanitizeOptions, SanitizeStats };
