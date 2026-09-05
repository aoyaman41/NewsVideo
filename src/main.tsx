import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeProjectEvents, projectClient } from './stores/projectStore';
initializeProjectEvents();
window.electronAPI.project.onFlushRequested(async () => {
  try { await projectClient.flushAll(); window.electronAPI.project.finishFlush(true); }
  catch { window.electronAPI.project.finishFlush(false); }
});
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
