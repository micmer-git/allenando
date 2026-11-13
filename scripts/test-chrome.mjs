import { spawn } from 'node:child_process';
import { mkdtempSync, statfsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Lascia margine sopra i 5 GiB richiesti anche mentre Chrome scrive il profilo.
export function startTestChrome(executable, args) {
  const temp = tmpdir();
  const disk = statfsSync(temp, { bigint: true });
  const free = disk.bavail * disk.bsize;
  if (free < 8n * 1024n ** 3n) {
    throw new Error(`Collaudo sospeso: ${(Number(free) / 1024 ** 3).toFixed(1)} GiB liberi in ${temp}. Ne servono 8.`);
  }
  const profile = mkdtempSync(join(temp, 'allenando-ui-'));
  let child;
  const cleanup = async () => {
    for (const wait of [0, 500, 1500, 3000]) {
      if (wait) await delay(wait);
      try {
        await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
        return;
      } catch (error) {
        if (wait === 3000) throw error;
      }
    }
  };
  try {
    child = spawn(executable, [`--user-data-dir=${profile}`, ...args], { stdio: 'ignore' });
  } catch (error) {
    void cleanup().catch(e => console.warn(e.message));
    throw error;
  }
  child.on('error', error => console.error(error.message));
  const ended = new Promise(resolve => child.once('close', resolve));
  const closed = ended.then(cleanup);
  // Il codice che attende closed riceve comunque l'errore.
  closed.catch(() => {});
  const finish = async () => {
    const exited = await Promise.race([ended.then(() => true), delay(3000, false, { ref: false })]);
    if (!exited) child.kill();
    await closed;
  };
  return { child, closed, finish };
}
