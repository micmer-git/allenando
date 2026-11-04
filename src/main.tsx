import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { captureInstallPrompt } from './components/Install';
import { RideRecovery } from './pages/RideRecovery';
import './index.css';

// il prompt di installazione di Chrome arriva presto: va preso prima che React monti
captureInstallPrompt();

const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
      {/* il giro interrotto da un crash o da una scheda chiusa: «Riprendi / Salva com'è» (pista 2) */}
      <RideRecovery />
    </BrowserRouter>
  </StrictMode>,
);
