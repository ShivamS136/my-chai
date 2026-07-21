import type { JSX } from 'react';
import { config } from '../config/config.ts';
import { withReferral } from '../lib/referral.ts';
import { strings } from '../strings.ts';

/**
 * The project's two template links (ADR-026, ADR-027): a credit link to the repo and
 * the maintainer's support page. Both ship on by default and both are deletable from
 * source — the only ask of a free project (DESIGN.md §4). Their values come from
 * `config.branding` (defaults = the maker's, ADR-032); the hrefs are referral-tagged
 * so clone-driven traffic is traceable. Paired with the always-on disclosure of where
 * donations actually go (DESIGN.md §Copy). Full-width and outside the layout grid; the
 * inner width tracks the page shell.
 */
export function Footer(): JSX.Element {
  const { maker, project } = config.branding;
  return (
    <footer className="border-t border-chai-line">
      <div className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-2 px-4 py-8 text-center text-chai-muted lg:max-w-[1040px]">
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px]">
          <a
            href={withReferral(project.repoUrl, 'footer', project.name)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={strings.externalLink(strings.poweredBy(project.name))}
            className="font-medium text-chai-ink underline-offset-2 hover:text-chai-accent-strong hover:underline"
          >
            {strings.poweredBy(project.name)}
          </a>
          <span aria-hidden="true">·</span>
          <a
            href={withReferral(maker.supportUrl, 'footer', project.name)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={strings.externalLink(strings.supportMaker(maker.name))}
            className="font-medium text-chai-ink underline-offset-2 hover:text-chai-accent-strong hover:underline"
          >
            {strings.supportMaker(maker.name)}
          </a>
        </p>
        <p className="text-[11px]">{strings.poweredByTagline}</p>
        <p className="text-[11px] opacity-80">{strings.footerDisclosure}</p>
      </div>
    </footer>
  );
}
