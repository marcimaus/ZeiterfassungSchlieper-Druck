import { useState } from 'react';
import type { User } from '../types';
import { useApp } from '../context/AppContext';
import { validateSessionTimes } from '../validation';
import { verifyPin } from '../auth';
import * as db from '../db';
import DateScrollPicker, { TimeScrollPicker } from './DateScrollPicker';

interface Props {
  users: User[];
  onSaved: () => void;
  onCancel: () => void;
}

/** "YYYY-MM-DD" für heute */
function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLabel(dateVal: string, today: string): string | null {
  const d = new Date(today);
  const yesterday = new Date(d); yesterday.setDate(d.getDate() - 1);
  const dayBefore = new Date(d); dayBefore.setDate(d.getDate() - 2);
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  if (dateVal === today) return 'Heute';
  if (dateVal === fmt(yesterday)) return 'Gestern';
  if (dateVal === fmt(dayBefore)) return 'Vorgestern';
  return null;
}

/** Kombiniert Datum + Uhrzeit zu einem Timestamp */
function combine(date: string, time: string): number {
  return new Date(`${date}T${time}:00`).getTime();
}

export default function ManualEntryForm({ users, onSaved, onCancel }: Props) {
  const { state, addManualSession } = useApp();
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [dateVal, setDateVal] = useState(todayDateString());
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');
  const [noEndTime, setNoEndTime] = useState(false); // only relevant when dateVal === today
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Password gate
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [unlockedUserIds, setUnlockedUserIds] = useState<Set<string>>(new Set());

  const today = todayDateString();
  const selectedUser = users.find((u) => u.id === userId);
  const needsPassword = !state.isAdminMode && !!selectedUser?.passwordHash && !unlockedUserIds.has(userId);

  function handleUserChange(newId: string) {
    setUserId(newId);
    setPasswordInput('');
    setPasswordError('');
  }

  async function handleUnlock() {
    if (!selectedUser?.passwordHash) return;
    const ok = await verifyPin(passwordInput, selectedUser.passwordHash);
    if (ok) {
      setUnlockedUserIds((prev) => new Set([...prev, userId]));
      setPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('Falsches Passwort. Bitte erneut versuchen.');
      setPasswordInput('');
    }
  }

  async function handleSave() {
    setErrors([]);
    setWarnings([]);

    if (!userId || !dateVal) {
      setErrors(['Bitte Datum auswählen.']);
      return;
    }

    if (dateVal > today) {
      setErrors(['Das Datum darf nicht in der Zukunft liegen.']);
      return;
    }

    const isToday = dateVal === today;
    const useEndTime = !isToday || !noEndTime;

    const start = combine(dateVal, startTime);
    const end = useEndTime ? combine(dateVal, endTime) : null;

    // Bestehende Sessions des Monats laden für Überlappungsprüfung
    const date = new Date(start);
    const existingSessions = await db.getSessionsForUserAndMonth(userId, date.getFullYear(), date.getMonth());

    const result = validateSessionTimes(start, end, userId, existingSessions);
    setErrors(result.errors);
    setWarnings(result.warnings);
    if (!result.valid) return;

    setSaving(true);
    try {
      await addManualSession(userId, start, end, 'Manuell nachgetragen');
      onSaved();
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxHeight: '96vh' }}>
        <h2>Zeit manuell nachtragen</h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
          Für vergessene Ein- oder Ausbuchungen. Der Eintrag wird als "Manuell" gekennzeichnet.
        </p>

        {users.length > 1 && (
          <div className="form-group">
            <label>Mitarbeiter</label>
            <select value={userId} onChange={(e) => handleUserChange(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.passwordHash && !state.isAdminMode ? '🔒 ' : ''}{u.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {needsPassword ? (
          <>
            <div style={{
              background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10,
              padding: '12px 14px', marginBottom: 16, fontSize: 13, color: '#1e40af',
            }}>
              🔒 Bitte gib das Passwort von <strong>{selectedUser?.name}</strong> ein,
              um Zeiten für diese Person nachzutragen.
            </div>
            <div className="form-group">
              <label>Passwort</label>
              <input
                type="password"
                autoFocus
                value={passwordInput}
                onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                placeholder="Passwort eingeben"
              />
            </div>
            {passwordError && (
              <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{passwordError}</p>
            )}
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={handleUnlock} disabled={!passwordInput}>
                Entsperren
              </button>
              <button className="btn btn-secondary" onClick={onCancel}>Abbrechen</button>
            </div>
          </>
        ) : (
          <>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Datum
                {dateLabel(dateVal, today) && (
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    background: 'var(--primary, #6366f1)', color: '#fff',
                    borderRadius: 6, padding: '2px 8px',
                  }}>
                    {dateLabel(dateVal, today)}
                  </span>
                )}
              </label>
              <DateScrollPicker
                value={dateVal}
                maxDate={today}
                visibleItems={3}
                onChange={(v) => {
                  setDateVal(v);
                  if (v !== today) setNoEndTime(false);
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 4 }}>
                <label>Arbeitsbeginn</label>
                <TimeScrollPicker value={startTime} onChange={setStartTime} visibleItems={3} />
              </div>
              <div className="form-group" style={{ flex: 1, marginBottom: 4 }}>
                <label>Arbeitsende</label>
                {dateVal === today && noEndTime ? (
                  <div style={{
                    height: 44 * 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <span style={{
                      padding: '6px 12px',
                      background: 'var(--bg-secondary)',
                      borderRadius: 8,
                      color: '#6b7280',
                      fontSize: 13,
                    }}>
                      Läuft noch
                    </span>
                  </div>
                ) : (
                  <TimeScrollPicker value={endTime} onChange={setEndTime} visibleItems={3} />
                )}
              </div>
            </div>
            {dateVal === today && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 6, marginTop: 2, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={noEndTime}
                  onChange={(e) => setNoEndTime(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                Schicht läuft noch (kein Arbeitsende)
              </label>
            )}

            {errors.map((e) => (
              <div key={e} style={{ background: '#fee2e2', borderRadius: 8, padding: '10px 14px', marginBottom: 8, fontSize: 13, color: '#991b1b' }}>
                {e}
              </div>
            ))}
            {warnings.map((w) => (
              <div key={w} style={{ background: '#fef3c7', borderRadius: 8, padding: '10px 14px', marginBottom: 8, fontSize: 13, color: '#92400e' }}>
                ⚠ {w}
              </div>
            ))}

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !dateVal || !userId}
              >
                {saving ? 'Wird gespeichert…' : 'Zeit eintragen'}
              </button>
              <button className="btn btn-secondary" onClick={onCancel}>Abbrechen</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
