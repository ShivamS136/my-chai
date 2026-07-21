import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { track } from './analytics/index.ts';
// The validated config — a plain object the chai-config plugin built from
// chai.config.yaml at build time (ADR-030). An invalid config fails earlier: at
// build in chai-config-validator, in dev as Vite's overlay when the plugin's load
// hook throws.
import { config } from './config/config.ts';
import './index.css';
import { readInboundSource } from './lib/referral.ts';
import { applyTheme } from './lib/theme.ts';

// `<title>`, `<html lang>` and a forced `data-theme` are baked into the served HTML
// by the chai-head plugin (flash-free, and visible to crawlers). This applies the
// accent override — which is purely visual, so runtime injection is fine — and
// re-affirms the mode. Must run after `import './index.css'` so the injected accent
// stylesheet lands after the base tokens and wins.
applyTheme(config.theme);

// `page_view` lives here, not in an effect: React 18 StrictMode runs effects twice
// in development, and a hook that has to defend against its own framework is a worse
// contract than one call at the one place the page is known to have loaded exactly
// once. With analytics off this is the noop adapter and costs nothing.
//
// The inbound `?ref=` rides along when there is one, so the same signal the
// ReferralNote chip shows the visitor is also the one that makes clone-driven
// traffic countable (ADR-027). Spread rather than `source: undefined` because
// `exactOptionalPropertyTypes` treats those as different shapes — and an explicit
// `undefined` would reach PostHog as a real, empty property.
const inboundSource = readInboundSource();
track({ name: 'page_view', ...(inboundSource !== null && { source: inboundSource }) });

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root is missing from index.html');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
