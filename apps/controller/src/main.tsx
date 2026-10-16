import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ControllerSession } from './lib/session.js';
import { SessionContext } from './sessionContext.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const session = new ControllerSession();
session.start();

window.addEventListener('pagehide', () => session.destroy());

createRoot(container).render(
  <StrictMode>
    <SessionContext.Provider value={session}>
      <App />
    </SessionContext.Provider>
  </StrictMode>,
);
