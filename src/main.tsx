import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
// Parses chai.config.ts at module load and throws the formatted error on an invalid
// config, so `pnpm dev` surfaces it in Vite's overlay. Build-time enforcement is
// separate — see the chai-config-validator plugin in vite.config.ts.
import { config } from './config/config.ts';
import './index.css';

document.title = config.meta.title;
document.documentElement.lang = config.meta.language;

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root is missing from index.html');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
