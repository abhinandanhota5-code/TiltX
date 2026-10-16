import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { GameContext } from './gameContext.js';
import { GameSession } from './lib/gameSession.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const session = new GameSession();
session.start();

window.addEventListener('pagehide', () => session.destroy());

createRoot(container).render(
  <StrictMode>
    <GameContext.Provider value={session}>
      <App />
    </GameContext.Provider>
  </StrictMode>,
);
