import { useState } from 'react';
import type { User } from '../types';
import { useApp } from '../context/AppContext';
import * as db from '../db';
import { fromDatetimeLocal, nowDatetimeLocal } from '../utils';
import { validateSessionTimes } from '../validation';

interface Props {
  users: User[];
  onSaved: () => void;
  onCancel: () => void;
}

export default function CorrectionForm({ users, onSaved, onCancel }: Props) {
  const { state } = useApp();
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [startVal, setStartVal] = useState('');
  const [endVal, setEndVal] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const adminInfo = { name: state.adminName || 'Admin' };
  const now = nowDatetimeLocal();

  async function handleSave() {
    setErrors([]);
    setWarnings([]);

    if (!userId || !startVal) {
      setErrors(['Mitarbeiter und Beginn sind Pflichtfelder.']);
      return;
    }
    if (!note.trim()) {
      setErrors(['Bitte einen Bemerkungstext eingeben.']);
      return;
    }

    const startTime = fromDatetimeLocal(startVal);
    const endTime = endVal ? fromDatetimeLocal(endVal) : null;

    const result = validateSessionTimes(startTime, endTime, userId, []);
    setErrors(result.errors);
    setWarnings(result.warnings);
    if (!result.valid) return;

    setSaving(true);
    try {
      await db.addManualSession(userId, startTime, endTime, [], adminInfo, note.trim());
      onSaved();
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Sitzung manuell eintragen</h2>

        <div className="form-group">
          <label>Mitarbeiter</label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            style={{ width: '100%', padding: '13px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 16, background: '#fff', appearance: 'none' }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Beginn</label>
          <input
            type="datetime-local"
            max={now}
            value={startVal}
            onChange={(e) => setStartVal(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Ende (leer lassen wenn noch aktiv)</label>
          <input
            type="datetime-local"
            max={now}
            value={endVal}
            onChange={(e) => setEndVal(e.target.value)}
          />
        </div>

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

        <div className="form-group">
          <label>Bemerkung (Pflichtfeld)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z.B. Mitarbeiter hat vergessen einzustempeln"
          />
        </div>

        <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
          Diese Sitzung wird als "Manuell" gekennzeichnet und mit Ihrer Admin-Kennung protokolliert.
        </p>

        <div className="modal-actions">
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !startVal || !note.trim()}
          >
            {saving ? 'Wird gespeichert…' : 'Sitzung eintragen'}
          </button>
          <button className="btn btn-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
