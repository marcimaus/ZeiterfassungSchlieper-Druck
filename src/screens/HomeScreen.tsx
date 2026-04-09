import { useState, useEffect, useCallback, useRef } from 'react';
import { isCapacitorAndroid, initCapacitorNfcListener, isPostWriteCooldown } from '../nfc';
import { formatTime, formatDuration, elapsedMinutes, toDatetimeLocal, fromDatetimeLocal, formatDate, nowDatetimeLocal } from '../utils';
import type { User, WorkSession, ScanResult } from '../types';
import { useApp } from '../context/AppContext';
import BreakActionSheet from '../components/BreakActionSheet';
import OfflineBanner from '../components/OfflineBanner';
import { TimeScrollPicker } from '../components/DateScrollPicker';


interface Props {
  onOpenSessions: (userId: string) => void;
}

interface SnackbarState {
  message: string;
  type: 'success' | 'warning' | 'error';
}

interface UnknownChipState {
  uid: string;
  newName: string;
}

interface BreakChoice {
  user: User;
  session: WorkSession;
}

interface ForgotClockOut {
  user: User;
  missedSession: WorkSession;
  newSession: WorkSession;
  endVal: string;
  saving: boolean;
  error: string;
}

export default function HomeScreen({ onOpenSessions }: Props) {
  const { state, processNfcScan, clockOut, startBreak, endBreak, addUser, clockIn, updateSession } = useApp();
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const [unknownChip, setUnknownChip] = useState<UnknownChipState | null>(null);
  const [breakChoice, setBreakChoice] = useState<BreakChoice | null>(null);

  const [forgotClockOut, setForgotClockOut] = useState<ForgotClockOut | null>(null);
  const [forgotBreakEnd, setForgotBreakEnd] = useState<{ user: User; session: WorkSession; breakEndTime: string; saving: boolean; error: string } | null>(null);
  const [, setTick] = useState(0);
  const lastScanRef = useRef<Map<string, number>>(new Map());

  function isDuplicateScan(uid: string): boolean {
    const last = lastScanRef.current.get(uid) ?? 0;
    if (Date.now() - last < 2000) return true;
    lastScanRef.current.set(uid, Date.now());
    return false;
  }

  // Tick every 30s to update elapsed times
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  function showSnackbar(message: string, type: SnackbarState['type']) {
    setSnackbar({ message, type });
    setTimeout(() => setSnackbar(null), 4000);
  }

  const handleScanResult = useCallback(
    (result: ScanResult, uid: string) => {
      if (result.type === 'clockedIn') {
        showSnackbar(`✓ ${result.user.name} eingestempelt`, 'success');
      } else if (result.type === 'clockedOut') {
        showSnackbar(
          `${result.user.name} ausgestempelt · ${formatDuration(result.netMinutes)}`,
          'warning'
        );
      } else if (result.type === 'breakEnded') {
        showSnackbar(`${result.user.name} – Pause beendet`, 'success');
      } else if (result.type === 'breakStarted') {
        showSnackbar(`${result.user.name} – Pause gestartet`, 'warning');
      } else if (result.type === 'needsChoice') {
        setBreakChoice({ user: result.user, session: result.session });
      } else if (result.type === 'forgotToClockOut') {
        setForgotClockOut({
          user: result.user,
          missedSession: result.missedSession,
          newSession: result.newSession,
          endVal: toDatetimeLocal(result.missedSession.endTime!),
          saving: false,
          error: '',
        });
      } else {
        setUnknownChip({ uid, newName: '' });
      }
    },
    []
  );

  // Capacitor NFC Intent Listener (Android-Hintergrund-Scan)
  // Refs müssen NACH handleScanResult und showSnackbar deklariert werden
  const processNfcScanRef = useRef(processNfcScan);
  processNfcScanRef.current = processNfcScan;
  const handleScanResultRef = useRef(handleScanResult);
  handleScanResultRef.current = handleScanResult;
  const showSnackbarRef = useRef(showSnackbar);
  showSnackbarRef.current = showSnackbar;

  useEffect(() => {
    if (!isCapacitorAndroid()) return;

    let cleanup = () => {};

    initCapacitorNfcListener(async (uid: string) => {
      if (isPostWriteCooldown()) return;
      if (isDuplicateScan(uid)) return;
      try {
        const result = await processNfcScanRef.current(uid);
        handleScanResultRef.current(result, uid);
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          showSnackbarRef.current((err as Error).message, 'error');
        }
      }
    }).then((fn) => {
      cleanup = fn;
    });

    return () => cleanup();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function registerUnknownChip() {
    if (!unknownChip?.newName.trim()) return;
    const name = unknownChip.newName.trim();
    try {
      const user = await addUser(name, unknownChip.uid);
      await clockIn(user.id, 'nfc');
      showSnackbar(`✓ ${name} registriert & eingestempelt`, 'success');
      setUnknownChip(null);
    } catch (err) {
      showSnackbar((err as Error).message, 'error');
    }
  }

  async function handleBreakStart() {
    if (!breakChoice) return;
    try {
      await startBreak(breakChoice.session.id, 'nfc');
      showSnackbar(`${breakChoice.user.name} – Pause gestartet`, 'warning');
    } catch (err) {
      showSnackbar((err as Error).message, 'error');
    } finally {
      setBreakChoice(null);
    }
  }

  async function handleBreakEnd() {
    if (!breakChoice) return;
    try {
      await endBreak(breakChoice.session.id, 'nfc');
      showSnackbar(`${breakChoice.user.name} – Pause beendet`, 'success');
    } catch (err) {
      showSnackbar((err as Error).message, 'error');
    } finally {
      setBreakChoice(null);
    }
  }

  async function handleClockOut() {
    if (!breakChoice) return;
    if (breakChoice.session.status === 'on_break') {
      const breakStart = breakChoice.session.breaks.find(b => b.endTime === null)?.startTime ?? Date.now();
      const defaultEnd = new Date(Math.min(breakStart + 30 * 60000, Date.now()));
      const defaultTime = `${String(defaultEnd.getHours()).padStart(2, '0')}:${String(defaultEnd.getMinutes()).padStart(2, '0')}`;
      setBreakChoice(null);
      setForgotBreakEnd({ user: breakChoice.user, session: breakChoice.session, breakEndTime: defaultTime, saving: false, error: '' });
      return;
    }
    try {
      const stopped = await clockOut(breakChoice.session.id);
      const net = Math.max(
        0,
        Math.floor((stopped.endTime! - stopped.startTime) / 60000) - stopped.totalBreakMinutes
      );
      showSnackbar(
        `${breakChoice.user.name} ausgestempelt · ${formatDuration(net)}`,
        'warning'
      );
    } catch (err) {
      showSnackbar((err as Error).message, 'error');
    } finally {
      setBreakChoice(null);
    }
  }

  async function handleForgotBreakSave() {
    if (!forgotBreakEnd) return;
    const { user, session, breakEndTime } = forgotBreakEnd;
    const breakStart = session.breaks.find(b => b.endTime === null)?.startTime ?? 0;
    const [h, m] = breakEndTime.split(':').map(Number);
    const breakEndDate = new Date(breakStart);
    breakEndDate.setHours(h, m, 0, 0);
    const breakEndTs = breakEndDate.getTime();
    if (breakEndTs <= breakStart) {
      setForgotBreakEnd({ ...forgotBreakEnd, error: 'Pausenende muss nach dem Pausenbeginn liegen.' });
      return;
    }
    if (breakEndTs > Date.now()) {
      setForgotBreakEnd({ ...forgotBreakEnd, error: 'Pausenende darf nicht in der Zukunft liegen.' });
      return;
    }
    setForgotBreakEnd({ ...forgotBreakEnd, saving: true, error: '' });
    try {
      await endBreak(session.id, 'manual', breakEndTs);
      const stopped = await clockOut(session.id);
      const net = Math.max(0, Math.floor((stopped.endTime! - stopped.startTime) / 60000) - stopped.totalBreakMinutes);
      showSnackbar(`${user.name} ausgestempelt · ${formatDuration(net)}`, 'warning');
      setForgotBreakEnd(null);
    } catch (err) {
      setForgotBreakEnd({ ...forgotBreakEnd, saving: false, error: (err as Error).message });
    }
  }

  async function handleForgotSave() {
    if (!forgotClockOut) return;
    const endTime = fromDatetimeLocal(forgotClockOut.endVal);
    if (endTime <= forgotClockOut.missedSession.startTime) {
      setForgotClockOut({ ...forgotClockOut, error: 'Arbeitsende muss nach dem Arbeitsbeginn liegen.' });
      return;
    }
    if (endTime > Date.now()) {
      setForgotClockOut({ ...forgotClockOut, error: 'Arbeitsende darf nicht in der Zukunft liegen.' });
      return;
    }
    setForgotClockOut({ ...forgotClockOut, saving: true, error: '' });
    try {
      await updateSession(
        forgotClockOut.missedSession.id,
        { endTime },
        'Vergessen auszustempeln – nachträglich korrigiert'
      );
      showSnackbar(`✓ ${forgotClockOut.user.name} eingestempelt`, 'success');
      setForgotClockOut(null);
    } catch (err) {
      setForgotClockOut({ ...forgotClockOut, saving: false, error: (err as Error).message });
    }
  }

  function handleForgotSkip() {
    if (!forgotClockOut) return;
    showSnackbar(`✓ ${forgotClockOut.user.name} eingestempelt`, 'success');
    setForgotClockOut(null);
  }

  // Build display list from context (users + activeSessions)
  const activeEntries = state.users
    .map((user) => {
      const session = state.activeSessions.find((s) => s.userId === user.id);
      return session ? { user, session } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a!.session.startTime - b!.session.startTime) as Array<{
    user: User;
    session: WorkSession;
  }>;

  const capacitorAndroid = isCapacitorAndroid();

  return (
    <div style={{ position: 'relative' }}>
      {/* Logo background – portrait filling */}
      <div aria-hidden="true" style={{
        position: 'fixed', inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}>
        <img
          src="/Schlieper-Druck-Logo.png"
          alt=""
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            width: '80vh',
            height: '100vw',
            objectFit: 'contain',
            objectPosition: '50% 100%',
            transform: 'translate(-50%, -50%) rotate(-90deg)',
            opacity: 0.13,
            mixBlendMode: 'multiply',
          }}
        />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
      <OfflineBanner isOnline={state.isOnline} />

      <div className="screen-header">
        <h1>Zeiterfassung</h1>
        {capacitorAndroid && (
          <p className="nfc-hint" style={{ color: '#2563eb' }}>
            NFC aktiv – Chip ans Gerät halten
          </p>
        )}
      </div>

      <div style={{ paddingTop: 8, paddingBottom: 16 }}>
        {activeEntries.length === 0 ? (
          <div className="empty-state">
            <p>Keine Mitarbeiter eingestempelt</p>
          </div>
        ) : (
          activeEntries.map(({ user, session }) => {
            const isOnBreak = session.status === 'on_break';
            const currentBreak = session.breaks.find((b) => b.endTime === null);
            return (
              <div
                key={session.id}
                className="card"
                style={{ cursor: 'pointer' }}
                onClick={() => onOpenSessions(user.id)}
              >
                <div className="card-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span className="card-name">{user.name}</span>
                      {isOnBreak ? (
                        <span className="badge badge-orange">● Pause</span>
                      ) : (
                        <span className="badge badge-green">● Aktiv</span>
                      )}
                    </div>
                    <div className="card-sub" style={{ marginBottom: 0 }}>
                      Seit {formatTime(session.startTime)} ·{' '}
                      {formatDuration(elapsedMinutes(session.startTime))}
                      {isOnBreak && currentBreak && (
                        <> · Pause seit {formatTime(currentBreak.startTime)}</>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>


      {/* Unknown chip dialog */}
      {unknownChip && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Unbekannter Chip</h2>
            <p style={{ color: '#6b7280', marginBottom: 16, fontSize: 14 }}>
              Chip-ID:{' '}
              <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>
                {unknownChip.uid}
              </code>
            </p>
            <div className="form-group">
              <label>Name des Mitarbeiters</label>
              <input
                autoFocus
                value={unknownChip.newName}
                onChange={(e) => setUnknownChip({ ...unknownChip, newName: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && registerUnknownChip()}
                placeholder="z.B. Max Mustermann"
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={registerUnknownChip}
                disabled={!unknownChip.newName.trim()}
              >
                Registrieren & Einstempeln
              </button>
              <button className="btn btn-secondary" onClick={() => setUnknownChip(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Break action sheet */}
      {breakChoice && (
        <BreakActionSheet
          user={breakChoice.user}
          session={breakChoice.session}
          onStartBreak={handleBreakStart}
          onEndBreak={handleBreakEnd}
          onClockOut={handleClockOut}
          onCancel={() => setBreakChoice(null)}
        />
      )}


      {/* Forgot to end break modal */}
      {forgotBreakEnd && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Pause vergessen zu beenden?</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 12, lineHeight: 1.5 }}>
              <strong>{forgotBreakEnd.user.name}</strong> ist seit{' '}
              <strong>{formatTime(forgotBreakEnd.session.breaks.find(b => b.endTime === null)?.startTime ?? 0)}</strong>{' '}
              in der Pause.
            </p>
            <div className="form-group" style={{ marginBottom: 4 }}>
              <label style={{ fontSize: 13 }}>Pause endete um</label>
              <TimeScrollPicker
                value={forgotBreakEnd.breakEndTime}
                onChange={(v) => setForgotBreakEnd({ ...forgotBreakEnd, breakEndTime: v, error: '' })}
                visibleItems={3}
              />
            </div>
            {forgotBreakEnd.error && (
              <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{forgotBreakEnd.error}</p>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleForgotBreakSave}
                disabled={forgotBreakEnd.saving}
                style={{ background: '#2563eb' }}
              >
                {forgotBreakEnd.saving ? 'Wird gespeichert…' : 'Ausstempeln (Pause korrigieren)'}
              </button>
              <button
                className="btn btn-secondary"
                disabled={forgotBreakEnd.saving}
                onClick={async () => {
                  const snap = forgotBreakEnd;
                  setForgotBreakEnd(null);
                  try {
                    const stopped = await clockOut(snap.session.id);
                    const net = Math.max(0, Math.floor((stopped.endTime! - stopped.startTime) / 60000) - stopped.totalBreakMinutes);
                    showSnackbar(`${snap.user.name} ausgestempelt · ${formatDuration(net)}`, 'warning');
                  } catch (err) {
                    showSnackbar((err as Error).message, 'error');
                  }
                }}
              >
                Ausstempeln (Pause bis jetzt)
              </button>
              <button
                className="btn btn-secondary"
                disabled={forgotBreakEnd.saving}
                onClick={async () => {
                  const snap = forgotBreakEnd;
                  setForgotBreakEnd(null);
                  try {
                    await endBreak(snap.session.id, 'nfc');
                    showSnackbar(`${snap.user.name} – Pause beendet`, 'success');
                  } catch (err) {
                    showSnackbar((err as Error).message, 'error');
                  }
                }}
              >
                Nur Pause beenden & weiterarbeiten
              </button>
              <button className="btn btn-secondary" onClick={() => setForgotBreakEnd(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forgot to clock out modal */}
      {forgotClockOut && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>⚠️ Vergessen auszustempeln</h2>
            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>
              <strong>{forgotClockOut.user.name}</strong> war am{' '}
              <strong>{formatDate(forgotClockOut.missedSession.startTime)}</strong> noch eingestempelt
              und wurde automatisch um 23:59 Uhr ausgestempelt.
              Bitte trage die tatsächliche Arbeitsendzeit ein.
            </p>
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#374151' }}>
              Arbeitsbeginn: <strong>{formatTime(forgotClockOut.missedSession.startTime)}</strong>
            </div>
            <div className="form-group">
              <label>Tatsächliches Arbeitsende</label>
              <input
                type="datetime-local"
                max={nowDatetimeLocal()}
                value={forgotClockOut.endVal}
                onChange={(e) => setForgotClockOut({ ...forgotClockOut, endVal: e.target.value, error: '' })}
              />
            </div>
            {forgotClockOut.error && (
              <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{forgotClockOut.error}</p>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleForgotSave}
                disabled={forgotClockOut.saving || !forgotClockOut.endVal}
              >
                {forgotClockOut.saving ? 'Wird gespeichert…' : 'Speichern'}
              </button>
              <button className="btn btn-secondary" onClick={handleForgotSkip}>
                Überspringen
              </button>
            </div>
          </div>
        </div>
      )}

      {snackbar && (
        <div className={`snackbar snackbar-${snackbar.type}`}>{snackbar.message}</div>
      )}
      </div>
    </div>
  );
}
