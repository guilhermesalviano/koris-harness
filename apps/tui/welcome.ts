import { defaultColors } from './colors';
import type { TuiContext } from './types';

// ── Title art variants ────────────────────────────────────────────────────
// Each variant is an array of lines. The selector picks the largest art that
// fits inside the inner content area (terminalWidth - 4).

const TITLE_LARGE = [
  `██╗  ██╗  ██████╗  ██████╗  ██╗ ███████╗         █████╗   ██████╗  ███████╗ ███╗   ██╗ ████████╗`,
  `██║ ██╔╝ ██╔═══██╗ ██╔══██╗ ██║ ██╔════╝        ██╔══██╗ ██╔════╝  ██╔════╝ ████╗  ██║ ╚══██╔══╝`,
  `█████╔╝  ██║   ██║ ██████╔╝ ██║ ███████╗ █████╗ ███████║ ██║  ███╗ █████╗   ██╔██╗ ██║    ██║   `,
  `██╔═██╗  ██║   ██║ ██╔══██╗ ██║ ╚════██║ ╚════╝ ██╔══██║ ██║   ██║ ██╔══╝   ██║╚██╗██║    ██║   `,
  `██║  ██╗ ╚██████╔╝ ██║  ██║ ██║ ███████║        ██║  ██║ ╚██████╔╝ ███████╗ ██║ ╚████║    ██║   `,
  `╚═╝  ╚═╝  ╚═════╝  ╚═╝  ╚═╝ ╚═╝ ╚══════╝        ╚═╝  ╚═╝  ╚═════╝  ╚══════╝ ╚═╝  ╚═══╝    ╚═╝   `,
];

// 3-row compact art using Unicode box-drawing characters (~46 chars wide).
// Letters: K O R I S
//  A G E N T
const TITLE_MEDIUM = [
  `██╗  ██╗ ██████╗ ██████╗ ██╗███████╗ `,
  `██║ ██╔╝██╔═══██╗██╔══██╗██║██╔════╝ `,
  `█████╔╝ ██║   ██║██████╔╝██║███████╗ `,
  `██╔═██╗ ██║   ██║██╔══██╗██║╚════██║ `,
  `██║  ██╗╚██████╔╝██║  ██║██║███████║ `,
  `╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝╚══════╝ `,
];

// Widths of the art lines (used to pick the right variant).
const TITLE_LARGE_WIDTH = 104;
const TITLE_MEDIUM_WIDTH = 46;

type Rgb = [number, number, number];

const GRADIENT_PALETTE: readonly Rgb[] = [
  [180, 60, 0],
  [220, 110, 20],
  [255, 175, 80],
  [255, 235, 200],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function paletteColorAt(t: number): Rgb {
  if (GRADIENT_PALETTE.length === 1) return GRADIENT_PALETTE[0];
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (GRADIENT_PALETTE.length - 1);
  const index = Math.floor(scaled);
  const nextIndex = Math.min(index + 1, GRADIENT_PALETTE.length - 1);
  const localT = scaled - index;
  return mixRgb(GRADIENT_PALETTE[index], GRADIENT_PALETTE[nextIndex], localT);
}

function paintGradient(text: string, start: Rgb, end: Rgb): string {
  const chars = Array.from(text);
  if (chars.length === 0) return text;

  const denominator = Math.max(1, chars.length - 1);
  let output = '';

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === ' ') {
      output += ch;
      continue;
    }

    const t = i / denominator;
    const color = mixRgb(start, end, t);
    output += `\x1b[38;2;${color[0]};${color[1]};${color[2]}m${ch}`;
  }

  return `${output}\x1b[0m`;
}

function gradientForLine(line: string, lineIndex: number, lineCount: number): string {
  const rowT = lineCount <= 1 ? 0 : lineIndex / (lineCount - 1);
  const start = paletteColorAt(Math.min(1, rowT * 0.7));
  const end = paletteColorAt(Math.min(1, 0.25 + rowT * 0.75));
  return paintGradient(line, start, end);
}

function titleArtForWidth(innerWidth: number): string[] {
  if (innerWidth >= TITLE_LARGE_WIDTH) return TITLE_LARGE;
  if (innerWidth >= TITLE_MEDIUM_WIDTH) return TITLE_MEDIUM;
  return []; // tiny: caller renders a plain text fallback
}

export function defaultWelcome(ctx: TuiContext, title?: string, aiModel?: string, showHints?: boolean): void {
  const { colors, println, terminalWidth } = ctx;
  const displayHints = showHints !== false;
  const innerWidth = Math.max(20, terminalWidth - 4);
  const ansiPattern = /^\x1b\[[0-9;?]*[ -/]*[@-~]/;
  const visibleWidth = (value: string) => value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').length;
  const fit = (value: string) => {
    let output = '';
    let index = 0;
    let width = 0;

    while (index < value.length && width < innerWidth) {
      const remaining = value.slice(index);
      const ansiMatch = remaining.match(ansiPattern);

      if (ansiMatch) {
        output += ansiMatch[0];
        index += ansiMatch[0].length;
        continue;
      }

      output += value[index];
      index += 1;
      width += 1;
    }

    return output;
  };
  const orange = '\x1b[38;2;220;110;20m';
  const frameLine = (content = '') => {
    const fitted = fit(content);
    return `${colors.bright}${orange}┃${colors.reset} ${fitted}${' '.repeat(Math.max(0, innerWidth - visibleWidth(fitted)))} ${colors.bright}${orange}┃${colors.reset}`;
  };

  const topBorder = `${colors.bright}${orange}┏${'━'.repeat(terminalWidth - 2)}┓${colors.reset}`;
  println(topBorder);

  const artLines = titleArtForWidth(innerWidth);
  if (artLines.length > 0) {
    const artWidth = artLines[0].trimEnd().length;
    const artPad = ' '.repeat(Math.max(0, Math.floor((innerWidth - artWidth) / 2)));
    for (let i = 0; i < artLines.length; i += 1) {
      const line = artLines[i];
      println(frameLine(`${artPad}${colors.bright}${gradientForLine(line, i, artLines.length)}${colors.reset}`));
    }
  } else {
    // Terminal too narrow for any art: show a single centered label.
    const label = `  ✦  KORIS-AGENT  ✦  `;
    const pad = ' '.repeat(Math.max(0, Math.floor((innerWidth - label.length) / 2)));
    println(frameLine(`${pad}${colors.bright}${gradientForLine(label, 0, 1)}${colors.reset}`));
  }

  if (title) {
    const center = (text: string) => {
      const pad = ' '.repeat(Math.max(0, Math.floor((innerWidth - visibleWidth(text)) / 2)));
      return `${pad}${text}`;
    };
    println(frameLine(center(`${colors.dim}${title}${colors.reset}`)));
  }

  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const modelLabel = aiModel || 'agent';
  const center = (text: string) => {
    const pad = ' '.repeat(Math.max(0, Math.floor((innerWidth - visibleWidth(text)) / 2)));
    return `${pad}${text}`;
  };
  println(frameLine(center(`${colors.gray}Model:${colors.reset} ${modelLabel}`)));
  println(frameLine(center(`${colors.gray}Started:${colors.reset} ${timeStr}`)));

  const bottomBorder = `${colors.bright}${orange}┗${'━'.repeat(terminalWidth - 2)}┛${colors.reset}`;
  println(bottomBorder);

  println();

  if (displayHints) {
    println(`${colors.bright}${colors.magenta}Quick Tips:${colors.reset}`);
    println(`  ${colors.cyan}•${colors.reset} Start commands with ${colors.bright}/${colors.reset}`);
    println(`  ${colors.cyan}•${colors.reset} Type ${colors.bright}/help${colors.reset} for available commands`);
    println(`  ${colors.cyan}•${colors.reset} Press ${colors.bright}Esc${colors.reset} to cancel the current AI request`);
    println(`  ${colors.cyan}•${colors.reset} Press ${colors.bright}Ctrl+C${colors.reset} to exit gracefully`);
    println();
  }

//   println(`${colors.dim}${modelLabel} is ready to assist! What can I help you with?${colors.reset}`);
//   println();
}

export function getDefaultColors() {
  return defaultColors;
}