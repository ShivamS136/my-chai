import { Download } from 'lucide-react';
import type { JSX } from 'react';
import { downloadDataUrl } from '../lib/download.ts';
import { strings } from '../strings.ts';

/**
 * The live UPI QR (P0.5).
 *
 * Presentational by design: it receives an already-rendered SVG data URI and a
 * PNG factory from `useUpiIntent`, and never encodes anything itself. That keeps
 * every QR the page shows and every QR it downloads derived from one matrix.
 *
 * An `<img>` rather than inline SVG so the symbol carries a real `alt` — the VPA
 * and amount in text, which is both the accessibility requirement (DESIGN.md) and
 * the fallback for a donor whose images fail to load.
 */
export interface QrCodeProps {
  readonly svgDataUrl: string;
  readonly alt: string;
  readonly filename: string;
  /** Encodes the PNG on demand — see `UpiQr.toPngDataUrl`. */
  readonly toPngDataUrl: () => string;
}

export function QrCode({ svgDataUrl, alt, filename, toPngDataUrl }: QrCodeProps): JSX.Element {
  return (
    <figure className="flex flex-col items-center gap-4">
      {/*
       * The plate stays white in dark mode. A QR is read by luminance contrast,
       * and inverting it is the single most common way to make one unscannable.
       */}
      <div className="rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgb(43_29_20/0.08),0_8px_24px_rgb(43_29_20/0.08)] ring-1 ring-chai-line">
        <img
          // Re-keying on the URI remounts the image, which replays the crossfade
          // each time the amount or message changes (DESIGN.md §Motion).
          key={svgDataUrl}
          src={svgDataUrl}
          alt={alt}
          className="chai-fade-in h-56 w-56 sm:h-60 sm:w-60"
        />
      </div>

      <figcaption className="text-center text-[13px] leading-snug text-chai-muted">
        {strings.qrCaption}
      </figcaption>

      <button
        type="button"
        onClick={() => downloadDataUrl(toPngDataUrl(), filename)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-chai-line px-5 text-[13px] font-semibold text-chai-ink transition-colors hover:border-chai-accent hover:text-chai-accent"
      >
        <Download aria-hidden="true" className="h-4 w-4" />
        {strings.qrDownload}
      </button>
    </figure>
  );
}
