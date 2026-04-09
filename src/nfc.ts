import { Capacitor } from '@capacitor/core';
import NfcIntentPlugin from './plugins/NfcIntentPlugin';
import type { PluginListenerHandle } from '@capacitor/core';

// Web NFC API type declarations
declare global {
  interface NDEFReadingEvent extends Event {
    serialNumber: string;
  }
  interface NDEFRecord {
    recordType: string;
    data?: string | ArrayBuffer | DataView;
  }
  interface NDEFMessage {
    records: NDEFRecord[];
  }
  class NDEFReader extends EventTarget {
    scan(options?: { signal?: AbortSignal }): Promise<void>;
    write(message: NDEFMessage | string): Promise<void>;
    onreading: ((event: NDEFReadingEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
  }
  interface Window {
    NDEFReader?: typeof NDEFReader;
  }
}

/** True wenn die App als native Capacitor-App auf Android läuft. */
export function isCapacitorAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function isNfcSupported(): boolean {
  // In der Capacitor-App: NFC-Intent-Dispatch wird immer unterstützt (Manifest-Permission vorausgesetzt)
  if (isCapacitorAndroid()) return true;
  // Im Browser: Web NFC API prüfen
  return 'NDEFReader' in window;
}

export interface NfcScanHandle {
  /** Resolves with the chip UID (uppercase hex, no separators) */
  result: Promise<string>;
  /** Call to abort the scan early */
  abort: () => void;
}

/**
 * Starts an NFC scan and returns a handle with the result promise and an
 * abort function. The result promise rejects with an AbortError when aborted.
 *
 * In der Capacitor-App wird der Web-NFC-Scan nicht verwendet – stattdessen
 * übernimmt das Android-NFC-Intent-System die Erkennung.
 */
export function startNfcScan(): NfcScanHandle {
  if (isCapacitorAndroid()) {
    // Im Capacitor-Kontext: manuelle Scan-Schaltfläche ist nicht nötig,
    // da Android NFC-Tags automatisch über Intents liefert.
    // Wir geben ein Handle zurück, das nie resolved – der Scan läuft passiv.
    let rejectFn: (reason: DOMException) => void;
    const result = new Promise<string>((_resolve, reject) => {
      rejectFn = reject;
    });
    return {
      result,
      abort: () => rejectFn(new DOMException('Scan abgebrochen.', 'AbortError')),
    };
  }

  if (!('NDEFReader' in window)) {
    return {
      result: Promise.reject(new Error('NFC wird von diesem Browser/Gerät nicht unterstützt.')),
      abort: () => {},
    };
  }

  const controller = new AbortController();

  const result = new Promise<string>((resolve, reject) => {
    const reader = new window.NDEFReader!();

    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Timeout: Kein NFC-Chip erkannt (30 Sek.).'));
    }, 30000);

    controller.signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new DOMException('Scan abgebrochen.', 'AbortError'));
    });

    reader
      .scan({ signal: controller.signal })
      .then(() => {
        reader.onreading = (event: NDEFReadingEvent) => {
          clearTimeout(timeout);
          const uid = event.serialNumber.toUpperCase().replace(/[:\-\s]/g, '');
          resolve(uid);
        };
        reader.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('NFC-Lesefehler. Bitte erneut versuchen.'));
        };
      })
      .catch((err: Error) => {
        clearTimeout(timeout);
        if (err.name !== 'AbortError') reject(err);
      });
  });

  return {
    result,
    abort: () => controller.abort(),
  };
}

/** Zeitstempel des letzten Schreibvorgangs – verhindert sofortiges Einlesen. */
let lastWriteAt = 0;

/**
 * Gibt true zurück wenn der letzte Schreibvorgang weniger als 2 Sekunden her ist.
 * Wird im NFC-Listener geprüft um einen Direktscan nach dem Beschreiben zu verhindern.
 */
export function isPostWriteCooldown(): boolean {
  return Date.now() - lastWriteAt < 2000;
}

/**
 * Beschreibt einen NFC-Chip mit einer URL (NDEF URL Record).
 * Der Chip öffnet die URL automatisch wenn er ans Gerät gehalten wird.
 */
export async function writeNfcUrl(url: string): Promise<void> {
  if (!('NDEFReader' in window)) {
    throw new Error('NFC wird von diesem Browser/Gerät nicht unterstützt.');
  }
  const writer = new window.NDEFReader!();
  await writer.write({
    records: [{ recordType: 'url', data: url }],
  });
  lastWriteAt = Date.now();
}

// ── Capacitor NFC Intent Listener ────────────────────────────────────────────

export type NfcTagHandler = (uid: string) => void;

/**
 * Initialisiert den nativen NFC-Intent-Listener für Capacitor/Android.
 *
 * Prüft beim Start, ob die App durch einen NFC-Intent geöffnet wurde
 * (pendingTag), und registriert dann einen dauerhaften Listener für
 * zukünftige NFC-Tags.
 *
 * Gibt eine Cleanup-Funktion zurück, die den Listener wieder entfernt.
 */
export async function initCapacitorNfcListener(
  onTag: NfcTagHandler
): Promise<() => void> {
  if (!isCapacitorAndroid()) {
    return () => {};
  }

  let listenerHandle: PluginListenerHandle | null = null;

  // 1. Prüfen ob die App durch einen NFC-Intent gestartet wurde
  try {
    const pending = await NfcIntentPlugin.getPendingTag();
    if (pending?.uid) {
      // Kurz verzögern damit React-Kontext (Firebase etc.) initialisiert ist
      setTimeout(() => onTag(pending.uid), 500);
    }
  } catch (err) {
    console.warn('[NFC] Fehler beim Abrufen des pendingTag:', err);
  }

  // 2. Dauerhaften Listener für spätere Tags registrieren
  try {
    listenerHandle = await NfcIntentPlugin.addListener('tagDetected', (event) => {
      onTag(event.uid);
    });
  } catch (err) {
    console.warn('[NFC] Fehler beim Registrieren des tagDetected-Listeners:', err);
  }

  return () => {
    listenerHandle?.remove();
  };
}
