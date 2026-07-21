import type { JSX } from 'react';
import { config } from '../config/config.ts';
import { strings } from '../strings.ts';

/**
 * The demo notice bar (ADR-034), shown ONLY on the canonical repo's public demo.
 *
 * That demo publishes the shipped *example* config past the placeholder guard
 * (ADR-013) by setting `CHAI_ALLOW_PLACEHOLDER=1`. The page then shows
 * `yourname@bank` — an unresolvable VPA that is not a real payment target — so this
 * bar makes the "example only, don't send money" state unmissable, which is ADR-008's
 * payment-honesty rule applied to the demo.
 *
 * It never reaches a real creator's page: `App.tsx` renders it behind the build-time
 * `__CHAI_DEMO__` flag, a literal `false` in every non-demo build, so Rollup drops
 * this component from their bundle entirely.
 */
export function DemoBanner(): JSX.Element {
  return (
    <div
      role="note"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-chai-ink px-4 py-2 text-center text-[13px] leading-snug text-chai-bg"
    >
      <span>
        <span aria-hidden="true">⚠ </span>
        {strings.demoBanner}
      </span>
      <a
        href={config.branding.project.templateUrl}
        className="font-semibold underline underline-offset-2"
      >
        {strings.demoBannerCta}
      </a>
    </div>
  );
}
