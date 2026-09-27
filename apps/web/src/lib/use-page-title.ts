import { useEffect } from 'react';

export function usePageTitle(title: string, description?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · koris` : 'koris';
    if (!description) return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [title, description]);
}