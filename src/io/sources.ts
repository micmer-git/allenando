import type { Ride } from '@/domain/types';
import { parseUpload, type ImportContext, type ParsedUpload } from './import';

/**
 * Sorgente di attività. L'import da file è l'unica implementazione in v1.
 * Un connettore Garmin Connect (OAuth) può aggiungere un'altra ActivitySource
 * senza cambiare diario e carico: deve solo produrre oggetti Ride.
 */
export interface ActivitySource {
  id: string;
  labelKey: string;
  importBytes?(name: string, data: Uint8Array, ctx: ImportContext): ParsedUpload;
  /** Riservato a un futuro connettore che scarica attività da un account. */
  pull?(ctx: ImportContext & { since?: string }): Promise<Ride[]>;
}

export const fileActivitySource: ActivitySource = {
  id: 'file',
  labelKey: 'import.sourceFile',
  importBytes(name, data, ctx) {
    return parseUpload(name, data, ctx);
  },
};

export const activitySources: ActivitySource[] = [fileActivitySource];
