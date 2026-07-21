/**
 * Referral attribution for the branding links (ADR-027).
 *
 * The project is a GitHub template: people clone it and deploy their own page. Every
 * clone's masthead/footer links back to the maker's repo and support page, so those
 * links are how the maker measures template adoption — without any backend.
 *
 * `withReferral` tags an outbound link so a click is traceable to the *source
 * project* and the specific clone. `readInboundSource` reads where a visit was
 * referred from, for a quiet on-page reference. Both take an injectable argument so
 * they stay pure and unit-testable.
 *
 * No network call happens here — `withReferral` only builds an href, so hard rule 4
 * (nothing over the wire when analytics is off) holds. `readInboundSource` is also
 * what `main.tsx` attaches to the `page_view` event as `source`, so the same signal
 * the on-page chip shows is the one PostHog counts (ADR-027).
 */

const currentHost = (): string => (typeof window !== 'undefined' ? window.location.hostname : '');

/**
 * Tags an outbound branding link so the maker can see clone-driven traffic:
 *  - `utm_campaign` = the source project, so every clone groups together;
 *  - `utm_source`   = this deployment's host, so one clone is distinguishable;
 *  - `utm_medium`   = `referral`; `utm_content` = where it was clicked;
 *  - `ref`          = host, the domain-referral convention some hosts read.
 *
 * `campaign` is the source project's name — injected (from `config.branding.project`)
 * rather than imported, so this stays pure and unit-testable (ADR-027, ADR-032). The
 * host is public information, never PII. Returns the URL untouched when there is no
 * host (build/SSR) or the URL cannot be parsed.
 */
export const withReferral = (
  url: string,
  surface: string,
  campaign: string,
  host: string = currentHost(),
): string => {
  if (host === '') return url;
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', host);
    u.searchParams.set('utm_medium', 'referral');
    u.searchParams.set('utm_campaign', campaign);
    u.searchParams.set('utm_content', surface);
    u.searchParams.set('ref', host);
    return u.toString();
  } catch {
    return url;
  }
};

/** The inbound keys we recognise, in precedence order. */
const INBOUND_KEYS = ['ref', 'source', 'utm_source'] as const;

/** Printable, non-angle-bracket characters — everything a display source may keep. */
const isDisplayChar = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f && ch !== '<' && ch !== '>';
};

/**
 * Reads where a visit was referred from (`?ref=` / `?source=` / `?utm_source=`),
 * sanitised for display: control and angle characters dropped, capped at 48 chars,
 * returned as plain text (never a URL) so it is safe to render as-is. `null` when
 * absent or empty.
 */
export const readInboundSource = (
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): string | null => {
  const params = new URLSearchParams(search);
  for (const key of INBOUND_KEYS) {
    const raw = params.get(key);
    if (raw !== null) {
      const cleaned = Array.from(raw.trim()).filter(isDisplayChar).slice(0, 48).join('');
      if (cleaned !== '') return cleaned;
    }
  }
  return null;
};
