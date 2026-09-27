import { defaultColors, type TuiColors } from './colors';
import type { TuiContext } from './types';

export function buildBeautifulPrompt(colors: TuiColors = defaultColors): string {
  return `${colors.bright}${colors.gray}>${colors.reset}${colors.cyan}${colors.bright} ${colors.reset}`;
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<string> {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { [Symbol.asyncIterator]?: unknown };
  return typeof maybe[Symbol.asyncIterator] === 'function';
}

export function applyInlineMarkdown(text: string, colors: TuiColors = defaultColors): string {
  let formatted = text.replace(/\*\*(.+?)\*\*/g, `${colors.bright}$1${colors.reset}`);
  formatted = formatted.replace(/__(.+?)__/g, `${colors.bright}$1${colors.reset}`);
  formatted = formatted.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `${colors.dim}$1${colors.reset}`);
  formatted = formatted.replace(/`([^`]+)`/g, `${colors.yellow}$1${colors.reset}`);
  return formatted;
}

/** Split accumulated stream text into thinking and content parts. */
export function splitThinking(
  text: string,
  markers: { start: string; end: string },
): { thinking: string; content: string; thinkingInProgress: boolean } {
  const si = text.indexOf(markers.start);
  if (si === -1) return { thinking: '', content: text, thinkingInProgress: false };

  const ei = text.indexOf(markers.end, si + markers.start.length);
  if (ei === -1) {
    return {
      thinking: text.slice(si + markers.start.length),
      content: '',
      thinkingInProgress: true,
    };
  }
  return {
    thinking: text.slice(si + markers.start.length, ei),
    content: text.slice(ei + markers.end.length),
    thinkingInProgress: false,
  };
}

const PADDING = '  ';

/**
 * Default thinking block renderer.
 * Produces a dim box with 2-space padding on each content line.
 * When `inProgress` is true the footer line is omitted (box still open).
 */
export function defaultFormatThinking(
  content: string,
  colors: TuiColors,
  inProgress: boolean,
): string {
  const trimmed = content.trim();
  if (!trimmed) return inProgress ? `${colors.bright}${colors.gray}${PADDING}╭─ thinking...${colors.reset}` : '';

  const header = `${colors.bright}${colors.gray}${PADDING}╭─ thinking ${'─'.repeat(3)}${colors.reset}`;
  const innerLines = trimmed
    .split('\n')
    .map((line) => `${colors.bright}${colors.gray}${PADDING}│ ${line}${colors.reset}`);
  const footer = inProgress
    ? `${colors.bright}${colors.gray}${PADDING}│${colors.reset}`
    : `${colors.bright}${colors.gray}${PADDING}╰${'─'.repeat(14)}${colors.reset}`;

  return [header, ...innerLines, footer].join('\n');
}

export function defaultFormatResponse(response: string, ctx: TuiContext): string {
  const { colors } = ctx;
  const lines = response.split('\n');
  let inCodeBlock = false;

  return lines
    .map((line) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        return `${colors.dim}${line}${colors.reset}`;
      }

      if (inCodeBlock) {
        return `${colors.green}${line}${colors.reset}`;
      }

      const h3 = line.match(/^#{3}\s+(.*)/);
      if (h3) return `${colors.bright}${colors.yellow}▸ ${applyInlineMarkdown(h3[1], colors)}${colors.reset}`;

      const h2 = line.match(/^#{2}\s+(.*)/);
      if (h2) return `${colors.bright}${colors.cyan}▶ ${applyInlineMarkdown(h2[1], colors)}${colors.reset}`;

      const h1 = line.match(/^#\s+(.*)/);
      if (h1) return `${colors.bright}${colors.blue}◆ ${applyInlineMarkdown(h1[1], colors)}${colors.reset}`;

      if (/^\s*([-•])\s+/.test(line)) {
        const content = applyInlineMarkdown(line.replace(/^\s*[-•]\s+/, ''), colors);
        return `  ${colors.cyan}•${colors.reset} ${content}`;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        return `  ${applyInlineMarkdown(line.trimStart(), colors)}`;
      }

      return applyInlineMarkdown(line, colors);
    })
    .join('\n');
}