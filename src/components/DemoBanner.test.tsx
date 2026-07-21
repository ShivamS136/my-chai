import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { config } from '../config/config.ts';
import { strings } from '../strings.ts';
import { DemoBanner } from './DemoBanner.tsx';

/**
 * The demo notice (ADR-034). The component always renders when mounted — whether it
 * appears at all is App's `__CHAI_DEMO__` gate, covered in App.test.tsx. Here we
 * assert it says "example, don't send money" and points at the template.
 */
describe('DemoBanner', () => {
  it('states it is an example and links to the template', () => {
    render(<DemoBanner />);

    expect(screen.getByRole('note')).toHaveTextContent(strings.demoBanner);
    expect(screen.getByRole('link', { name: strings.demoBannerCta })).toHaveAttribute(
      'href',
      config.branding.project.templateUrl,
    );
  });
});
