import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { captureInstallPrompt } from './components/Install';
import './index.css';

// il prompt di installazione di Chrome arriva presto: va preso prima che React monti
captureInstallPrompt();

// L'app installata tiene il pacchetto vecchio finché il service worker nuovo non prende il
// controllo (skipWaiting). Se la pagina è appena aperta, si ricarica: il rilascio si vede senza
// svuotare i dati del sito. A metà di un giro, con la pagina aperta da un po', non si interrompe.
const swBoot = performance.now();
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || performance.now() - swBoot > 15_000) return;
    reloading = true;
    window.location.reload();
  });
}

const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
