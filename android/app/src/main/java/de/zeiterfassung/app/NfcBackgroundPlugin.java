package de.zeiterfassung.app;

import android.app.Activity;
import android.content.Intent;
import android.nfc.NfcAdapter;
import android.nfc.Tag;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor-Plugin: NFC Intent-Dispatch für Android.
 *
 * Ermöglicht das Empfangen von NFC-Tags auch dann, wenn die App nicht
 * im Vordergrund geöffnet war. Android startet die App (oder bringt sie
 * in den Vordergrund) sobald ein NFC-Tag erkannt wird, und dieser Plugin
 * leitet die Tag-UID an die JavaScript-Schicht weiter.
 *
 * Verwendung im AndroidManifest.xml:
 *   - <uses-permission android:name="android.permission.NFC" />
 *   - Intent-Filter in der MainActivity (siehe unten)
 *
 * JavaScript-Seite: src/plugins/NfcIntentPlugin.ts
 */
@CapacitorPlugin(name = "NfcBackground")
public class NfcBackgroundPlugin extends Plugin {

    /**
     * UID des Tags, der die App gestartet hat (bevor die Bridge bereit war).
     * Wird über getPendingTag() an JS übergeben und danach geleert.
     */
    private String pendingUid = null;

    @Override
    public void load() {
        // Prüfe ob die Activity durch einen NFC-Intent gestartet wurde
        Activity activity = getActivity();
        if (activity != null) {
            extractUidFromIntent(activity.getIntent(), false);
        }
    }

    /**
     * Wird aufgerufen wenn die App bereits läuft und ein NFC-Tag
     * gescannt wird (Vordergrund oder Hintergrund).
     */
    @Override
    public void handleOnNewIntent(Intent intent) {
        extractUidFromIntent(intent, true);
    }

    /**
     * Extrahiert die UID aus einem NFC-Intent und sendet sie an JS.
     *
     * @param intent    Der zu verarbeitende Intent
     * @param fireEvent true = direkt per notifyListeners senden,
     *                  false = in pendingUid speichern (JS noch nicht bereit)
     */
    private void extractUidFromIntent(Intent intent, boolean fireEvent) {
        if (intent == null) return;

        String action = intent.getAction();
        if (!NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)
                && !NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
                && !NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)) {
            return;
        }

        Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
        if (tag == null) return;

        byte[] id = tag.getId();
        StringBuilder uid = new StringBuilder();
        for (byte b : id) {
            uid.append(String.format("%02X", b));
        }
        String uidStr = uid.toString();

        if (fireEvent) {
            JSObject data = new JSObject();
            data.put("uid", uidStr);
            notifyListeners("tagDetected", data);
        } else {
            pendingUid = uidStr;
        }
    }

    /**
     * JS-Methode: Gibt den NFC-Tag zurück, der den App-Start ausgelöst hat,
     * oder ein leeres Objekt wenn kein solcher Tag vorhanden ist.
     *
     * Muss beim App-Start einmalig aufgerufen werden (siehe HomeScreen.tsx).
     */
    @PluginMethod
    public void getPendingTag(PluginCall call) {
        JSObject result = new JSObject();
        if (pendingUid != null) {
            result.put("uid", pendingUid);
            pendingUid = null;
        }
        call.resolve(result);
    }
}
