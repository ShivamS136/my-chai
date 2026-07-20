import type { JSX } from 'react';
import { PaymentCard } from './components/PaymentCard.tsx';
import { config } from './config/config.ts';

/**
 * Session 2 mounts the payment card only. Header, bio, works and footer land in
 * Session 4, and Session 3 replaces the card's inline QR with the device-adaptive
 * PayZone (see docs/ROADMAP.md).
 *
 * Default export is permitted here — CLAUDE.md allows it for route components.
 */
export default function App(): JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10 sm:py-14">
      <PaymentCard config={config} />
    </main>
  );
}
