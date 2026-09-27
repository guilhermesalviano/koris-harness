export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Lightweight regex-based markdown renderer, ported from the previous
 * vanilla-JS chat UI (public/chat/main.js) to avoid pulling in a new
 * dependency for a small, well-understood feature set.
 */
export function renderMarkdown(raw: string): string {
  let s = escapeHtml(raw);

  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const label = lang || '';
    return `<pre data-lang="${label}"><code>${code.trim()}</code></pre>`;
  });

  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  s = s.replace(/^---+$/gm, '<hr>');

  s = s.replace(/((?:^- .+\n?)+)/gm, (m) => {
    const items = m.trim().split('\n').map((l) => `<li>${l.slice(2)}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (m) => {
    const items = m.trim().split('\n').map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  const blocks = s.split(/\n\n+/);
  s = blocks
    .map((b) => {
      if (/^<(pre|ul|ol|h[1-3]|hr)/.test(b.trim())) return b;
      return `<p>${b.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  return s;
}

/**
 * Reduces markdown to plain speakable text: drops code, image and link syntax,
 * heading/list/quote/rule markers, and emphasis punctuation so a TTS engine
 * doesn't read `**`, `#`, backticks, etc. aloud.
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
