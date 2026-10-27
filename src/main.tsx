import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Keep links to existing choice sessions working after the home page changes.
const choice = location.pathname.startsWith('/choice') || /^#session\//.test(location.hash);
const module = choice ? import('./choice') : import('./written-app');
void module.then(({ default: App }) => {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
});
