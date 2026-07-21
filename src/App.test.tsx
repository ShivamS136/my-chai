import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App.tsx';
import { track } from './analytics/index.ts';
import { config } from './config/config.ts';
import { strings } from './strings.ts';

const { maker, project } = config.branding;

/**
 * Page-assembly smoke test (P0.2, P0.10): the example config drives a page with the
 * right landmarks, a locked-brand masthead, a skip link straight to payment, and the
 * template links in both masthead and footer. The individual sections have their own
 * unit tests; this one guards the wiring and the landmark contract.
 */
describe('App', () => {
  it('assembles masthead, identity, payment and footer behind proper landmarks', () => {
    render(<App />);

    expect(screen.getByRole('link', { name: strings.skipToPayment })).toHaveAttribute(
      'href',
      '#chai-pay',
    );

    // The masthead is the banner and carries the locked wordmark; the creator name is
    // the page's single h1; main and contentinfo complete the landmark set.
    expect(screen.getByRole('banner')).toHaveTextContent(strings.brandName);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();

    // The payment card is present; the repo is credited in the footer (and linked
    // as the masthead CTA), and the maker support link lives in the footer only.
    expect(screen.getByRole('heading', { name: strings.paymentCardTitle })).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: strings.externalLink(strings.poweredBy(project.name)),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: strings.externalLink(strings.supportMaker(maker.name)) }),
    ).toBeInTheDocument();
  });

  it('makes no network call at all with analytics disabled (hard rule 4)', async () => {
    // The example config declares no analytics block, which is what every fresh fork
    // ships. `track` here is the real module, not a mock — this asserts the whole
    // page, adapter included, is inert. The static counterpart (no `fetch(` anywhere
    // in src) lives in src/analytics/contract.test.ts.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const beaconSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', Object.assign(globalThis.navigator, { sendBeacon: beaconSpy }));

    render(<App />);
    track({ name: 'page_view' });
    await userEvent.click(screen.getAllByRole('radio')[1] ?? screen.getByRole('main'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    fetchSpy.mockRestore();
  });
});
