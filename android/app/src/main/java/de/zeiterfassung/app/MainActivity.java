package de.zeiterfassung.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Haupt-Activity der Zeiterfassungs-App.
 *
 * Erbt von BridgeActivity (Capacitor). Die NFC-Intent-Verarbeitung
 * erfolgt vollständig im NfcBackgroundPlugin:
 *   - onCreate/load():      NFC-Intent beim ersten App-Start -> pendingUid
 *   - onNewIntent():        NFC-Intent wenn App bereits läuft -> notifyListeners
 *
 * Wichtig: android:launchMode="singleTask" im Manifest sorgt dafür, dass
 * bei einem erneuten NFC-Scan keine neue Activity gestartet wird, sondern
 * onNewIntent() in der bestehenden Instanz aufgerufen wird.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // NfcBackgroundPlugin registrieren BEVOR super.onCreate() aufgerufen wird
        registerPlugin(NfcBackgroundPlugin.class);
        super.onCreate(savedInstanceState);
        // Der NFC-Intent (falls vorhanden) wird in NfcBackgroundPlugin.load()
        // über getActivity().getIntent() ausgelesen.
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Notwendig damit der neue Intent für getIntent() verfügbar ist
        setIntent(intent);
        // Capacitor leitet onNewIntent an alle registrierten Plugins weiter,
        // also auch an NfcBackgroundPlugin.handleOnNewIntent()
    }
}
