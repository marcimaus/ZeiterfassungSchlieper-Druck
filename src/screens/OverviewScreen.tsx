import { useState, useEffect } from 'react';
import { formatMonth, formatDuration, formatDate, formatTime, netDurationMinutes } from '../utils';
import type { User, WorkSession } from '../types';
import { useApp } from '../context/AppContext';
import * as db from '../db';
import { verifyPin } from '../auth';
import SessionDetailScreen from './SessionDetailScreen';
import ManualEntryForm from '../components/ManualEntryForm';

interface Props {
  initialUserId: string | null;
  onClose: () => void;
}

/** Groups sessions by calendar day (YYYY-MM-DD) */
function groupByDay(sessions: WorkSession[]): Map<string, WorkSession[]> {
  const map = new Map<string, WorkSession[]>();
  for (const s of sessions) {
    const key = new Date(s.startTime).toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  // Sort keys descending (newest day first)
  return new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

/** Total net minutes for a list of sessions */
function totalMinutes(sessions: WorkSession[]): number {
  return sessions
    .filter((s) => s.endTime !== null)
    .reduce((sum, s) => sum + netDurationMinutes(s.startTime, s.endTime!, s.totalBreakMinutes), 0);
}

export default function OverviewScreen({ initialUserId, onClose }: Props) {
  const { state, deleteSession } = useApp();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [editSession, setEditSession] = useState<WorkSession | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [monthlyTotals, setMonthlyTotals] = useState<Map<string, number>>(new Map());

  // Password gate state
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordChecking, setPasswordChecking] = useState(false);
  const [unlockedUserIds, setUnlockedUserIds] = useState<Set<string>>(new Set());

  // Set initial user from prop
  useEffect(() => {
    if (initialUserId && state.users.length > 0) {
      const u = state.users.find((u) => u.id === initialUserId) ?? null;
      setSelectedUser(u);
    }
  }, [initialUserId, state.users]);

  // Reload sessions whenever user, month or any session write happens
  useEffect(() => {
    if (!selectedUser) return;
    setLoading(true);
    db.getSessionsForUserAndMonth(selectedUser.id, year, month)
      .then(setSessions)
      .finally(() => setLoading(false));
  }, [selectedUser, year, month, state.sessionsUpdatedAt]);

  // Reload monthly totals whenever month, users or any session write happens
  useEffect(() => {
    if (selectedUser) return;
    async function loadTotals() {
      const totals = new Map<string, number>();
      for (const user of state.users.filter(u => u.isActive)) {
        const s = await db.getSessionsForUserAndMonth(user.id, year, month);
        const total = totalMinutes(s);
        totals.set(user.id, total);
      }
      setMonthlyTotals(new Map(totals));
    }
    loadTotals();
  }, [selectedUser, state.users, year, month, state.sessionsUpdatedAt]);

  // Is the currently displayed month the current calendar month?
  const isCurrentMonth = year === currentYear && month === currentMonth;

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }

  function nextMonth() {
    if (isCurrentMonth) return; // don't navigate into the future
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  async function handleDelete(sessionId: string) {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setDeleteConfirmId(null);
    try {
      await deleteSession(sessionId, 'Manuell gelöscht');
    } catch (err) {
      // Bei Fehler: Session wieder einblenden durch Reload
      if (selectedUser) {
        const restored = await db.getSessionsForUserAndMonth(selectedUser.id, year, month);
        setSessions(restored);
      }
      alert('Fehler: ' + (err as Error).message);
    }
  }

  function handleSessionSaved() {
    setEditSession(null);
    // sessionsUpdatedAt in global state will trigger the useEffect to reload
  }

  function handleUserClick(user: User) {
    // Admin always has access
    if (state.isAdminMode) { setSelectedUser(user); return; }
    // Already unlocked this session
    if (unlockedUserIds.has(user.id)) { setSelectedUser(user); return; }
    // No password set → open directly
    if (!user.passwordHash) { setSelectedUser(user); return; }
    // Has password → show gate
    setPendingUser(user);
    setPasswordInput('');
    setPasswordError('');
  }

  async function handlePasswordSubmit(pin: string) {
    if (!pendingUser?.passwordHash || passwordChecking) return;
    setPasswordChecking(true);
    const ok = await verifyPin(pin, pendingUser.passwordHash);
    setPasswordChecking(false);
    if (ok) {
      setUnlockedUserIds((prev) => new Set([...prev, pendingUser.id]));
      setSelectedUser(pendingUser);
      setPendingUser(null);
      setPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('Falscher PIN. Bitte erneut versuchen.');
      setPasswordInput('');
    }
  }

  function handlePinPress(key: string) {
    if (passwordChecking) return;
    setPasswordError('');
    if (key === '⌫') {
      setPasswordInput((p) => p.slice(0, -1));
      return;
    }
    const next = passwordInput + key;
    setPasswordInput(next);
    if (next.length === 4) handlePasswordSubmit(next);
  }

  // ── Detail view for a selected user ─────────────────────────────────────────
  if (selectedUser) {
    if (editSession) {
      return (
        <SessionDetailScreen
          session={editSession}
          onSaved={handleSessionSaved}
          onCancel={() => setEditSession(null)}
        />
      );
    }

    const monthTotal = totalMinutes(sessions);
    const dayGroups = groupByDay(sessions);

    return (
      <>
        <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="screen-header" style={{ position: 'static' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => {
                // Re-lock password-protected users on exit
                if (selectedUser.passwordHash) {
                  setUnlockedUserIds((prev) => {
                    const next = new Set(prev);
                    next.delete(selectedUser.id);
                    return next;
                  });
                }
                setSelectedUser(null);
                onClose();
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, padding: '0 4px', minHeight: 44, minWidth: 44 }}
            >
              ←
            </button>
            <div>
              <h1>{selectedUser.name}</h1>
              <div style={{ fontSize: 13, color: '#6b7280' }}>
                Monatsgesamt: <strong>{formatDuration(monthTotal)}</strong>
              </div>
            </div>
          </div>
        </div>
        <div className="month-picker">
          <button onClick={prevMonth}>‹</button>
          <span>
            {formatMonth(year, month)}
            {loading && <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 6 }}>…</span>}
          </span>
          {isCurrentMonth
            ? <span style={{ width: 44 }} />
            : <button onClick={nextMonth}>›</button>
          }
        </div>
        </div>

        <div style={{ padding: '8px 12px 12px' }}>
          <button
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={() => setShowManualEntry(true)}
          >
            + Zeit manuell nachtragen
          </button>
        </div>

        {loading ? (
          <div className="empty-state"><p>Wird geladen…</p></div>
        ) : sessions.length === 0 ? (
          <div className="empty-state"><p>Keine Einträge in diesem Monat</p></div>
        ) : (
          <div style={{ paddingBottom: 80 }}>
            {[...dayGroups.entries()].map(([dayKey, daySessions]) => {
              const dayTotal = totalMinutes(daySessions);
              const hasManual = daySessions.some((s) => s.source === 'manual');
              const hasCorrections = daySessions.some((s) => s.correctionLog.length > 0);
              const allEnded = daySessions.every((s) => s.endTime !== null);

              return (
                <div key={dayKey} className="day-group">
                  {/* Day header */}
                  <div className="day-header">
                    <span className="day-header-date">
                      {formatDate(new Date(dayKey).getTime() + 12 * 3600 * 1000)}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {hasManual && (
                        <span className="badge badge-gray" style={{ fontSize: 11, padding: '2px 8px' }}>Manuell</span>
                      )}
                      {hasCorrections && (
                        <span className="badge badge-gray" style={{ fontSize: 11, padding: '2px 8px' }}>Korrigiert</span>
                      )}
                      {allEnded ? (
                        <span className="badge badge-blue">{formatDuration(dayTotal)}</span>
                      ) : (
                        <span className="badge badge-green">● Aktiv</span>
                      )}
                    </div>
                  </div>

                  {/* Sessions within this day */}
                  {daySessions.map((session) => {
                    const ended = session.endTime !== null;
                    const net = ended
                      ? netDurationMinutes(session.startTime, session.endTime!, session.totalBreakMinutes)
                      : null;

                    return (
                      <div key={session.id} className="session-item" style={{ margin: '0 12px 6px', borderRadius: '0 0 10px 10px' }}>
                        <div className="session-item-content">
                          {/* Time row */}
                          <div className="card-row">
                            <span style={{ fontSize: 15, color: '#374151' }}>
                              {formatTime(session.startTime)}
                              {' – '}
                              {session.endTime ? formatTime(session.endTime) : <span style={{ color: '#059669' }}>laufend</span>}
                            </span>
                            {net !== null && (
                              <span className="badge badge-gray" style={{ fontSize: 13 }}>
                                {formatDuration(net)}
                              </span>
                            )}
                          </div>

                          {/* Breaks */}
                          {session.totalBreakMinutes > 0 && (
                            <div style={{ fontSize: 13, color: '#9a3412', marginTop: 3 }}>
                              Pause: {session.totalBreakMinutes} Min.
                              {session.breaks.map((b) => {
                                if (!b.endTime) return null;
                                const mins = Math.floor((b.endTime - b.startTime) / 60000);
                                if (b.source === 'manual') {
                                  return (
                                    <span key={b.id} style={{ marginLeft: 6, color: '#b45309' }}>
                                      ({mins} Min.)
                                    </span>
                                  );
                                }
                                return (
                                  <span key={b.id} style={{ marginLeft: 6, color: '#b45309' }}>
                                    ({formatTime(b.startTime)}–{formatTime(b.endTime)})
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {/* Source & correction badges */}
                          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                            {session.source === 'manual' && (
                              <span style={{ fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 4, padding: '1px 6px' }}>
                                Manuell eingetragen
                              </span>
                            )}
                            {session.correctionLog.length > 0 && (
                              <span style={{ fontSize: 11, color: '#6b7280', background: '#f3f4f6', borderRadius: 4, padding: '1px 6px' }}>
                                {session.correctionLog.length}× korrigiert
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions: edit and delete for everyone */}
                        <div className="session-actions">
                          <button onClick={() => setEditSession(session)}>Bearbeiten</button>
                          <button
                            className="danger"
                            onClick={() => setDeleteConfirmId(session.id)}
                          >
                            Löschen
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

          </div>
        )}

        {/* Manuell nachtragen */}
        {showManualEntry && (
          <ManualEntryForm
            users={[selectedUser]}
            onSaved={() => setShowManualEntry(false)}
            onCancel={() => setShowManualEntry(false)}
          />
        )}

        {/* Löschen-Bestätigung */}
        {deleteConfirmId && (
          <div className="modal-overlay">
            <div className="modal">
              <h2>Sitzung löschen?</h2>
              <p style={{ color: 'var(--text-secondary)', margin: '12px 0 20px', fontSize: 14 }}>
                Diese Aktion kann nicht rückgängig gemacht werden.
              </p>
              <div className="modal-actions">
                <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirmId)}>
                  Löschen
                </button>
                <button className="btn btn-secondary" onClick={() => setDeleteConfirmId(null)}>
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── User list view ────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="screen-header" style={{ position: 'static' }}>
          <h1>Übersicht</h1>
        </div>
        <div className="month-picker">
          <button onClick={prevMonth}>‹</button>
          <span>{formatMonth(year, month)}</span>
          {isCurrentMonth
            ? <span style={{ width: 44 }} />
            : <button onClick={nextMonth}>›</button>
          }
        </div>
      </div>

      {state.users.filter(u => u.isActive).length === 0 ? (
        <div className="empty-state"><p>Keine Mitarbeiter vorhanden</p></div>
      ) : (
        <div style={{ paddingBottom: 80 }}>
          {state.users.filter(u => u.isActive).sort((a, b) => (monthlyTotals.get(b.id) ?? 0) - (monthlyTotals.get(a.id) ?? 0)).map((user) => {
            const total = monthlyTotals.get(user.id) ?? 0;
            const isLocked = !!user.passwordHash && !state.isAdminMode && !unlockedUserIds.has(user.id);
            return (
              <div key={user.id} className="card" onClick={() => handleUserClick(user)}>
                <div className="card-row">
                  <span className="card-name">
                    {user.name}
                  </span>
                  {isLocked
                    ? <span style={{ fontSize: 16 }}>🔒</span>
                    : <span className={`badge ${total === 0 ? 'badge-red' : 'badge-blue'}`}>{formatDuration(total)}</span>
                  }
                </div>
                <div className="card-sub">
                  {isLocked
                    ? 'Passwort erforderlich'
                    : 'Tippen für Tagesdetails'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PIN gate – centered card over blurred background */}
      {pendingUser && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px 24px',
        }}>
          <div style={{
            background: 'var(--bg-card, #fff)',
            borderRadius: 24,
            padding: '32px 28px 24px',
            width: '100%',
            maxWidth: 340,
            boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Bereich von
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 24 }}>
              {pendingUser.name}
            </h2>

            {/* PIN dots */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 8 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: i < passwordInput.length ? '#6B78C4' : 'var(--border, #dde2f0)',
                  transition: 'background 0.15s',
                }} />
              ))}
            </div>

            {passwordError && (
              <p style={{ color: '#f87171', fontSize: 13, marginBottom: 4, minHeight: 20 }}>
                {passwordError}
              </p>
            )}
            {!passwordError && <div style={{ minHeight: 20 }} />}

            {/* Numpad */}
            {passwordChecking ? (
              <div style={{ color: 'var(--text-secondary)', marginTop: 24 }}>Wird geprüft…</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 8, width: '100%' }}>
                {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, i) => {
                  if (key === '') return <div key={i} />;
                  return (
                    <button key={key} onClick={() => handlePinPress(key)} style={{
                      height: 58, borderRadius: 14, border: 'none',
                      background: key === '⌫' ? 'var(--bg-secondary, #eef0fa)' : 'var(--bg-base, #f7f9ff)',
                      color: 'var(--text-primary, #1e2a3b)',
                      fontSize: key === '⌫' ? 20 : 22, fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(99,102,241,0.08)',
                      WebkitTapHighlightColor: 'transparent',
                    }}>
                      {key}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => { setPendingUser(null); setPasswordInput(''); setPasswordError(''); }}
              style={{ marginTop: 20, background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer' }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </>
  );
}
