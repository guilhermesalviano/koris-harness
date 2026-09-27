import type { ImageAttachment } from '../../lib/types';

/**
 * The reading measure shared by the thread and the composer docked under it, so
 * the two line up as one column instead of drifting apart on wide screens.
 */
export const CHAT_COLUMN = 'mx-auto w-full max-w-[68ch]';

export function imageSrc(image: ImageAttachment): string {
  return `data:${image.mimeType ?? 'image/png'};base64,${image.data}`;
}

/** Opens the lightbox on one image of a set. */
export type PreviewImages = (images: ImageAttachment[], index: number) => void;

/** Reads an image file into an ImageAttachment payload. */
export function readFileAsAttachment(file: File): Promise<ImageAttachment> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
        resolve({ data: base64, mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(buffer).toString('base64');
    return { data: base64, mimeType: file.type };
  });
}
