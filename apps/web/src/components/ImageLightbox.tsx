import { useEffect } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './Icons';

interface ImageLightboxProps {
  src: string | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  caption?: string;
}

export default function ImageLightbox({ src, onClose, onPrev, onNext, caption }: ImageLightboxProps) {
  useEffect(() => {
    if (!src) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev?.();
      else if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [src, onClose, onPrev, onNext]);

  if (!src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption ?? 'Image preview'}
      onClick={onClose}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      {onPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          title="Previous image (←)"
          className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white/90 transition-colors duration-150 hover:bg-black/70"
        >
          <ChevronLeftIcon className="h-5 w-5 fill-none stroke-current" />
        </button>
      )}
      {onNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          title="Next image (→)"
          className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white/90 transition-colors duration-150 hover:bg-black/70"
        >
          <ChevronRightIcon className="h-5 w-5 fill-none stroke-current" />
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white/90 transition-colors duration-150 hover:bg-black/70"
      >
        <CloseIcon className="h-5 w-5 fill-none stroke-current" />
      </button>
      <img
        src={src}
        alt={caption ?? 'Image preview'}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] max-w-[92vw] rounded-lg border border-white/10 object-contain shadow-2xl"
      />
      {caption && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-black/40 px-3.5 py-1 font-mono text-xs text-white/90">
          {caption}
        </div>
      )}
    </div>
  );
}
