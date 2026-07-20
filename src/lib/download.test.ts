import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadDataUrl } from './download.ts';

describe('downloadDataUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * jsdom does not implement navigation, so `click()` is stubbed. What matters
   * is the anchor we hand the browser: its href, its `download` name, and that
   * it was in the document when clicked (Firefox ignores detached anchors).
   */
  const captureDownload = (): { anchor: HTMLAnchorElement | null; wasConnected: boolean } => {
    let anchor: HTMLAnchorElement | null = null;
    let wasConnected = false;
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = create(tag);
      if (tag === 'a') anchor = element as HTMLAnchorElement;
      return element;
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
      wasConnected = this.isConnected;
    });
    return {
      get anchor() {
        return anchor;
      },
      get wasConnected() {
        return wasConnected;
      },
    };
  };

  it('clicks an in-document anchor carrying the data URI and filename', () => {
    const captured = captureDownload();
    downloadDataUrl('data:image/png;base64,AAAA', 'chai-shivam-okaxis-150.png');

    expect(captured.anchor?.getAttribute('href')).toBe('data:image/png;base64,AAAA');
    expect(captured.anchor?.download).toBe('chai-shivam-okaxis-150.png');
    expect(captured.wasConnected).toBe(true);
  });

  it('leaves no anchor behind in the document', () => {
    captureDownload();
    downloadDataUrl('data:image/png;base64,AAAA', 'chai.png');
    expect(document.body.querySelector('a')).toBeNull();
  });
});
