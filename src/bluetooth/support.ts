export interface BluetoothHost {
  bluetooth?: unknown;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

export interface BluetoothAvailability {
  available: boolean;
  reason?: 'ios' | 'missing';
}

export function bluetoothSupport(host?: BluetoothHost): BluetoothAvailability {
  const nav: BluetoothHost | undefined =
    host ?? (typeof navigator === 'undefined' ? undefined : navigator);
  if (!nav) return { available: false, reason: 'missing' };
  if (nav.bluetooth) return { available: true };
  const ua = nav.userAgent ?? '';
  const iOS =
    /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  return { available: false, reason: iOS ? 'ios' : 'missing' };
}
