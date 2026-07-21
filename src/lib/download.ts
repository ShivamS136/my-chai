/**
 * Triggers a client-side file download from a `data:` URI.
 *
 * The one DOM-touching module in `src/lib` — kept separate so `qr.ts` and
 * `upi.ts` stay pure for the v1 widget extraction (ADR-004), and so components
 * can mock a single seam instead of stubbing anchors.
 *
 * A synthesised anchor rather than `window.open`: mobile browsers block popups
 * from anything the user did not directly click, and `download` on a same-origin
 * `data:` URI is the one path that behaves consistently across Android Chrome and
 * iOS Safari. Nothing leaves the device — a `data:` URI never hits the network.
 */
export const downloadDataUrl = (dataUrl: string, filename: string): void => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.rel = 'noopener';
  // Firefox ignores `click()` on an anchor that is not in the document.
  document.body.appendChild(link);
  link.click();
  link.remove();
};
