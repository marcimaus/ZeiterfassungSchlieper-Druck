import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface NfcTagEvent {
  /** NFC-Chip-UID als Hex-String in Großbuchstaben, z.B. "04A1B2C3" */
  uid: string;
}

export interface NfcIntentPlugin {
  /**
   * Gibt einen NFC-Tag zurück, der den App-Start ausgelöst hat (Intent-Launch),
   * oder null wenn die App normal gestartet wurde.
   * Muss beim App-Start einmalig aufgerufen werden.
   */
  getPendingTag(): Promise<NfcTagEvent | null>;

  /**
   * Registriert einen Listener für NFC-Tags, die erkannt werden,
   * während die App im Vordergrund oder Hintergrund läuft.
   */
  addListener(
    eventName: 'tagDetected',
    listener: (event: NfcTagEvent) => void
  ): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;
}

/**
 * Capacitor-Plugin für Android NFC-Intent-Dispatch.
 * Im Browser (Web) sind alle Methoden No-ops – die App nutzt dort
 * weiterhin die Web NFC API (NDEFReader).
 */
const NfcIntentPlugin = registerPlugin<NfcIntentPlugin>('NfcBackground', {
  web: {
    getPendingTag: async () => null,
    addListener: async (_event: string, _listener: unknown) => ({
      remove: async () => {},
    }),
    removeAllListeners: async () => {},
  },
});

export default NfcIntentPlugin;
