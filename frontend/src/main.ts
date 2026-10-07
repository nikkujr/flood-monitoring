import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

let theme = 'system';
try {
  const saved = localStorage.getItem('bantay-baha-theme');
  if (saved && ['system', 'light', 'dark'].includes(saved)) theme = saved;
} catch { /* Use the system preference when storage is unavailable. */ }
document.documentElement.dataset['theme'] = theme;

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
