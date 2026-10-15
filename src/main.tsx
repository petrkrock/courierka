import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import './index.css';
import { registerSW } from './lib/registerSW';

// Любая ошибка в приложении → dataLayer для GTM-подобной аналитики (если подключена).
window.addEventListener('error', (e) => {
  (window as unknown as { dataLayer?: Record<string, unknown>[] }).dataLayer =
    (window as unknown as { dataLayer?: Record<string, unknown>[] }).dataLayer || [];
  (window as unknown as { dataLayer: Record<string, unknown>[] }).dataLayer.push({
    event: 'app_error',
    message: e.message,
    source: e.filename,
    lineno: e.lineno,
  });
});

registerSW();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster richColors position="top-right" closeButton />
  </StrictMode>,
);
