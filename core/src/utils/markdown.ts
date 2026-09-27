/**
 * Reduces markdown to plain speakable text: drops code, image and link syntax,
 * heading/list/quote/rule markers, and emphasis punctuation so a TTS engine
 * doesn't read `**`, `#`, backticks, etc. aloud. Kept in sync with the web
 * dashboard's copy in `apps/web/src/lib/markdown.ts`.
 */
export function stripMarkdown(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_{1,3}(.+?)_{1,3}/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
