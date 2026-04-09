import { useState, useEffect } from 'react';
import type { CakeEntry, User } from '../types';
import { useApp } from '../context/AppContext';
import { verifyPin } from '../auth';
import * as db from '../db';

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','⌫','0','✓'];

function pad(n: number) { return String(n).padStart(2, '0'); }

/** Returns true if this user participates in cake tracking */
function hasCakeConfig(user: User): boolean {
  return !!user.useDefaultCakeRate || user.cakeRatePerCake != null;
}

export default function CakeScreen() {
  const { state, addCakeEntry, deleteCakeEntry } = useApp();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [entries, setEntries] = useState<CakeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [addDialog, setAddDialog] = useState<{ user: User; count: string; saving: boolean; error: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CakeEntry | null>(null);

  // Manage dialog for password-protected employees
  const [manageDialog, setManageDialog] = useState<{ user: User } | null>(null);
  const [manageDeleteConfirm, setManageDeleteConfirm] = useState<CakeEntry | null>(null);

  // Password gate for password-protected users
  const [pinGate, setPinGate] = useState<{ user: User; pin: string; error: string; checking: boolean; reason: 'add' | 'manage' } | null>(null);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());

  function lockUser(userId: string) {
    setUnlockedIds(prev => { const next = new Set(prev); next.delete(userId); return next; });
  }

  async function reload() {
    setLoading(true);
    try {
      const data = await db.getCakeEntriesForMonth(year, month);
      setEntries(data.sort((a, b) => b.timestamp - a.timestamp));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  function openAddDialog(user: User) {
    if (user.passwordHash && !unlockedIds.has(user.id) && !state.isAdminMode) {
      setPinGate({ user, pin: '', error: '', checking: false, reason: 'add' });
      return;
    }
    setAddDialog({ user, count: '1', saving: false, error: '' });
  }

  function openManageDialog(user: User) {
    if (user.passwordHash && !unlockedIds.has(user.id) && !state.isAdminMode) {
      setPinGate({ user, pin: '', error: '', checking: false, reason: 'manage' });
      return;
    }
    setManageDialog({ user });
  }

  async function handlePinKey(key: string) {
    if (!pinGate || pinGate.checking) return;
    if (key === '⌫') { setPinGate({ ...pinGate, pin: pinGate.pin.slice(0, -1), error: '' }); return; }
    if (key === '✓' || pinGate.pin.length === 3) {
      const next = key === '⌫' || key === '✓' ? pinGate.pin : pinGate.pin + key;
      if (next.length < 4 && key !== '✓') { setPinGate({ ...pinGate, pin: next }); return; }
      const fullPin = key === '✓' ? pinGate.pin : next;
      if (fullPin.length < 4) { setPinGate({ ...pinGate, pin: fullPin }); return; }
      setPinGate({ ...pinGate, pin: fullPin, checking: true, error: '' });
      const ok = await verifyPin(fullPin, pinGate.user.passwordHash!);
      if (ok) {
        setUnlockedIds(prev => new Set([...prev, pinGate.user.id]));
        const user = pinGate.user;
        const reason = pinGate.reason;
        setPinGate(null);
        if (reason === 'add') {
          setAddDialog({ user, count: '1', saving: false, error: '' });
        } else {
          setManageDialog({ user });
        }
      } else {
        setPinGate({ ...pinGate, pin: '', checking: false, error: 'Falscher PIN.' });
      }
      return;
    }
    const next = pinGate.pin + key;
    if (next.length === 4) {
      setPinGate({ ...pinGate, pin: next, checking: true, error: '' });
      const ok = await verifyPin(next, pinGate.user.passwordHash!);
      if (ok) {
        setUnlockedIds(prev => new Set([...prev, pinGate.user.id]));
        const user = pinGate.user;
        const reason = pinGate.reason;
        setPinGate(null);
        if (reason === 'add') {
          setAddDialog({ user, count: '1', saving: false, error: '' });
        } else {
          setManageDialog({ user });
        }
      } else {
        setPinGate({ ...pinGate, pin: '', checking: false, error: 'Falscher PIN.' });
      }
    } else {
      setPinGate({ ...pinGate, pin: next });
    }
  }

  async function handleAdd() {
    if (!addDialog) return;
    const count = parseInt(addDialog.count);
    if (isNaN(count) || count < 1) {
      setAddDialog({ ...addDialog, error: 'Bitte eine gültige Anzahl eingeben.' });
      return;
    }
    setAddDialog({ ...addDialog, saving: true, error: '' });
    try {
      await addCakeEntry(addDialog.user.id, count);
      const userId = addDialog.user.id;
      const wasPasswordProtected = !!addDialog.user.passwordHash;
      setAddDialog(null);
      if (wasPasswordProtected && !state.isAdminMode) lockUser(userId);
      reload();
    } catch (err) {
      setAddDialog({ ...addDialog, saving: false, error: (err as Error).message });
    }
  }

  function closeAddDialog() {
    if (!addDialog) return;
    const wasPasswordProtected = !!addDialog.user.passwordHash;
    const userId = addDialog.user.id;
    setAddDialog(null);
    if (wasPasswordProtected && !state.isAdminMode) lockUser(userId);
  }

  async function handleDelete(entry: CakeEntry) {
    await deleteCakeEntry(entry.id);
    setDeleteConfirm(null);
    reload();
  }

  async function handleManageDelete(entry: CakeEntry) {
    await deleteCakeEntry(entry.id);
    setManageDeleteConfirm(null);
    reload();
  }

  function closeManageDialog() {
    if (!manageDialog) return;
    const wasPasswordProtected = !!manageDialog.user.passwordHash;
    const userId = manageDialog.user.id;
    setManageDialog(null);
    setManageDeleteConfirm(null);
    if (wasPasswordProtected && !state.isAdminMode) lockUser(userId);
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (year === now.getFullYear() && month === now.getMonth()) return;
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  // Only users with cake config
  const cakeUsers = state.users.filter(u => u.isActive && hasCakeConfig(u));

  // Group entries by userId
  const byUser = new Map<string, CakeEntry[]>();
  for (const e of entries) {
    if (!byUser.has(e.userId)) byUser.set(e.userId, []);
    byUser.get(e.userId)!.push(e);
  }

  // Group entries by date (admin view) – all users including password-protected
  const byDate = new Map<string, CakeEntry[]>();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }

  // Effective rate for a user
  function effectiveRate(user: User): number | null {
    if (user.useDefaultCakeRate) return state.defaultCakeRate;
    if (user.cakeRatePerCake != null) return user.cakeRatePerCake;
    return null;
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="screen-header">
        <h1>🎂 Kuchen</h1>
      </div>

      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '8px 16px 16px' }}>
        <button className="btn btn-secondary btn-sm" onClick={prevMonth}>‹</button>
        <span style={{ fontWeight: 600, fontSize: 15, minWidth: 140, textAlign: 'center' }}>
          {MONTHS[month]} {year}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={nextMonth} disabled={isCurrentMonth} style={{ opacity: isCurrentMonth ? 0.3 : 1 }}>›</button>
      </div>

      {loading ? (
        <div className="empty-state"><p>Wird geladen…</p></div>
      ) : cakeUsers.length === 0 ? (
        <div className="empty-state">
          <p>Noch keine Mitarbeiter mit Kuchen-Vergütung.</p>
          {state.isAdminMode && <p style={{ fontSize: 13, marginTop: 6 }}>Vergütung in den Mitarbeiter-Einstellungen aktivieren.</p>}
        </div>
      ) : (
        <>
          {/* Per-employee summary */}
          <div style={{ padding: '0 12px', marginBottom: 20 }}>
            {cakeUsers.map(user => {
              const userEntries = byUser.get(user.id) ?? [];
              const isLocked = !!user.passwordHash && !unlockedIds.has(user.id) && !state.isAdminMode;
const totalCakes = userEntries.reduce((s, e) => s + e.count, 0);
              const rate = effectiveRate(user);
              const totalValue = rate != null ? totalCakes * rate : null;
              const hasEntries = userEntries.length > 0;

              return (
                <div key={user.id} className="card" style={{ padding: '10px 16px', margin: '4px 0', cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        {user.name}
                        {isLocked && <span style={{ marginLeft: 6, fontSize: 14 }}>🔒</span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {isLocked ? (
                          <span style={{ letterSpacing: 2 }}>••••</span>
                        ) : (
                          <>
                            {totalCakes === 0 ? 'Keine Kuchen' : `${totalCakes} Kuchen`}
                            {totalValue !== null && totalCakes > 0 && (
                              <span style={{ marginLeft: 8, color: '#16a34a', fontWeight: 600 }}>
                                = {totalValue.toFixed(2)} €
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      {/* Bearbeiten button for employees with existing entries (non-admin) */}
                      {!state.isAdminMode && hasEntries && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openManageDialog(user)}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          Bearbeiten
                        </button>
                      )}
                      {isCurrentMonth && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => openAddDialog(user)}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          + Kuchen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Daily breakdown (admin only) – password-protected users excluded */}
          {state.isAdminMode && byDate.size > 0 && (
            <div style={{ padding: '0 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Einträge
              </div>
              {[...byDate.entries()]
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, dayEntries]) => {
                  const d = new Date(`${date}T12:00:00`);
                  const dateStr = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
                  return (
                    <div key={date} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{dateStr}</div>
                      {dayEntries.map(entry => {
                        const user = state.users.find(u => u.id === entry.userId);
                        return (
                          <div key={entry.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                            borderRadius: 8, padding: '8px 12px', marginBottom: 4
                          }}>
                            <div>
                              <span style={{ fontWeight: 500 }}>{user?.name ?? '–'}</span>
                              <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontSize: 13 }}>
                                {entry.count}× Kuchen
                              </span>
                              {entry.ratePerCake > 0 && (
                                <span style={{ color: '#16a34a', marginLeft: 8, fontSize: 13 }}>
                                  ({(entry.count * entry.ratePerCake).toFixed(2)} €)
                                </span>
                              )}
                            </div>
                            <button
                              className="btn btn-sm"
                              style={{ background: '#fee2e2', color: '#991b1b', border: 'none' }}
                              onClick={() => setDeleteConfirm(entry)}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          )}

          {entries.length === 0 && (
            <div className="empty-state">
              <p>Noch keine Kuchen im {MONTHS[month]} {year}</p>
            </div>
          )}
        </>
      )}

      {/* PIN gate for password-protected users */}
      {pinGate && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{pinGate.user.name}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
              {pinGate.reason === 'add'
                ? 'Bitte PIN eingeben um Kuchen einzutragen.'
                : 'Bitte PIN eingeben um Einträge zu bearbeiten.'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
              {[0,1,2,3].map(i => (
                <div key={i} style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: pinGate.pin.length > i ? '#2563eb' : 'var(--border-color)',
                  transition: 'background 0.15s'
                }} />
              ))}
            </div>
            {pinGate.error && (
              <p style={{ color: '#dc2626', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>{pinGate.error}</p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
              {PIN_KEYS.map(key => (
                <button
                  key={key}
                  className="btn btn-secondary"
                  onClick={() => handlePinKey(key)}
                  disabled={pinGate.checking}
                  style={{ fontSize: 18, padding: '12px 0', fontWeight: 600 }}
                >
                  {key}
                </button>
              ))}
            </div>
            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setPinGate(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Add dialog */}
      {addDialog && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Kuchen eintragen</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
              Mitarbeiter: <strong>{addDialog.user.name}</strong><br />
              Datum: <strong>{new Date().toLocaleDateString('de-DE')}</strong>
            </p>
            <div className="form-group">
              <label>Anzahl Kuchen</label>
              <input
                type="number"
                min="1"
                autoFocus
                value={addDialog.count}
                onChange={(e) => setAddDialog({ ...addDialog, count: e.target.value, error: '' })}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
            {state.isAdminMode && (() => {
              const rate = effectiveRate(addDialog.user);
              const n = parseInt(addDialog.count);
              if (rate != null && n > 0 && !isNaN(n)) {
                return <p style={{ fontSize: 13, color: '#16a34a', marginBottom: 12 }}>= {(n * rate).toFixed(2)} €</p>;
              }
              return null;
            })()}
            {addDialog.error && (
              <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{addDialog.error}</p>
            )}
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={handleAdd} disabled={addDialog.saving}>
                {addDialog.saving ? 'Wird gespeichert…' : 'Speichern'}
              </button>
              <button className="btn btn-secondary" onClick={closeAddDialog}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage dialog (password-protected employees) */}
      {manageDialog && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Kuchen verwalten</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
              {manageDialog.user.name} – {MONTHS[month]} {year}
            </p>
            {(byUser.get(manageDialog.user.id) ?? []).length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '8px 0 16px' }}>
                Keine Einträge in diesem Monat.
              </p>
            ) : (
              <div style={{ marginBottom: 16 }}>
                {(byUser.get(manageDialog.user.id) ?? []).map(entry => (
                  <div key={entry.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 0', borderBottom: '1px solid var(--border-color)'
                  }}>
                    <div>
                      <span style={{ fontSize: 14 }}>
                        {new Date(`${entry.date}T12:00:00`).toLocaleDateString('de-DE')}
                      </span>
                      <span style={{ marginLeft: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                        {entry.count}× Kuchen
                      </span>
                    </div>
                    {manageDeleteConfirm?.id === entry.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#dc2626', color: '#fff', border: 'none', fontWeight: 600 }}
                          onClick={() => handleManageDelete(entry)}
                        >
                          Löschen
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setManageDeleteConfirm(null)}
                        >
                          Abbrechen
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-sm"
                        style={{ background: '#fee2e2', color: '#991b1b', border: 'none' }}
                        onClick={() => setManageDeleteConfirm(entry)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={closeManageDialog}>
              Schließen
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm (admin only) */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Eintrag löschen?</h2>
            <p style={{ color: 'var(--text-secondary)', margin: '12px 0' }}>
              {state.users.find(u => u.id === deleteConfirm.userId)?.name} – {deleteConfirm.count}× Kuchen am {new Date(`${deleteConfirm.date}T12:00:00`).toLocaleDateString('de-DE')}
            </p>
            <div className="modal-actions">
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Löschen</button>
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
