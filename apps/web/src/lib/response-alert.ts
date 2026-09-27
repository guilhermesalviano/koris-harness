const ALERT_FAVICON = '/favicon-alert.ico';

let alertActive = false;
let originals: { link: HTMLLinkElement; href: string }[] = [];

const CLEAR_EVENTS = ['focus', 'visibilitychange', 'pointerdown', 'keydown'] as const;

function handleClearEvent() {
  clearResponseAlert();
}

function armClear() {
  for (const event of CLEAR_EVENTS) {
    window.addEventListener(event, handleClearEvent, { once: true });
  }
}

export function triggerResponseDone(): void {
  if (alertActive || !document.hidden) return;

  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
  if (links.length === 0) return;

  originals = links.map((link) => ({ link, href: link.href }));
  for (const link of links) link.href = ALERT_FAVICON;

  alertActive = true;
  armClear();
}

export function clearResponseAlert(): void {
  for (const event of CLEAR_EVENTS) {
    window.removeEventListener(event, handleClearEvent);
  }
  if (originals.length > 0) {
    for (const { link, href } of originals) link.href = href;
    originals = [];
  }
  alertActive = false;
}