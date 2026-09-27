import { RESPONSE_ANCHOR, THINK_END, THINK_START } from '../constants/thinking';

export function stripInternalStreamMarkers(text: string): string {
  const thinkPattern = new RegExp(
    `${escapeRegex(THINK_START)}[\\s\\S]*?(?:${escapeRegex(THINK_END)}|$)`,
    'g',
  );

  return text
    .replace(thinkPattern, '')
    .replace(new RegExp(escapeRegex(RESPONSE_ANCHOR), 'g'), '')
    .trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[\x00-\x1f\\^$.|?*+()[\]{}]/g, (char) =>
    `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
