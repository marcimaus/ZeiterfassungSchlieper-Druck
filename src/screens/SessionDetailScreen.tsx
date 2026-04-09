import { useState } from 'react';
import type { WorkSession, BreakPeriod } from '../types';
import { useApp } from '../context/AppContext';
import { toDatetimeLocal, fromDatetimeLocal, nowDatetimeLocal, formatTime, formatDate } from '../utils';
import { validateSessionTimes } from '../validation';

interface Props {
  session: WorkSession;
  onSaved: () => void;
  onCancel: () => void;
}

export default function SessionDetailScreen({ session, onSaved, onCancel }: Props) {
  const { updateSession } = useApp();

  const [startVal, setStartVal] = useState(toDatetimeLocal(session.startTime));
  const [endVal, setEndVal] = useState(session.endTime ? toDatetimeLocal(session.endTime) : '');
  const [breaks, setBreaks] = useState<BreakPeriod[]>(session.breaks);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Break editing – only duration in minutes needed
  const [newBreakMinutes, setNewBreakMinutes] = useState('');
  const [breakErrors, setBreakErrors] = useState<string[]>([]);

  const now = nowDatetimeLocal();

  function validate(): boolean {
    const startTime = fromDatetimeLocal(startVal);
    const endTime = endVal ? fromDatetimeLocal(endVal) : null;
    const result = validateSessionTimes(startTime, endTime, session.userId, [], session.id);
    setErrors(result.errors);
    setWarnings(result.warnings);
    return result.valid;
  }

  async function handleSave() {
    setErrors([]);
    if (!validate()) return;

    setSaving(true);
    try {
      await updateSession(
        session.id,
        {
          startTime: fromDatetimeLocal(startVal),
          endTime: endVal ? fromDatetimeLocal(endVal) : null,
          breaks,
        },
        note.trim()
      );
      onSaved();
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  function addBreak() {
    setBreakErrors([]);
    const mins = parseInt(newBreakMinutes, 10);
    if (!mins || mins <= 0) {
      setBreakErrors(['Bitte eine gültige Pausendauer in Minuten eingeben.']);
      return;
    }

    const sessionStart = fromDatetimeLocal(startVal);
    const sessionEnd = endVal ? fromDatetimeLocal(endVal) : null;

    // Place break right after last completed break, or at session start
    const lastEnd = breaks
      .filter((b) => b.endTime !== null)
      .map((b) => b.endTime!)
      .sort((a, b) => b - a)[0] ?? sessionStart;

    const bpStart = lastEnd;
    const bpEnd = bpStart + mins * 60000;

    if (sessionEnd && bpEnd > sessionEnd) {
      setBreakErrors(['Pause ist länger als die verbleibende Arbeitszeit.']);
      return;
    }

    const newBp: BreakPeriod = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      startTime: bpStart,
      endTime: bpEnd,
      source: 'manual',
    };
    setBreaks((prev) => [...prev, newBp].sort((a, b) => a.startTime - b.startTime));
    setNewBreakMinutes('');
  }

  function removeBreak(id: string) {
    setBreaks((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <>
      <div className="screen-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22,
              padding: '0 4px', minHeight: 44, minWidth: 44 }}
          >
            ←
          </button>
          <div>
            <h1>Eintrag bearbeiten</h1>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              {formatDate(session.startTime)} · Erfasst via{' '}
              {session.source === 'nfc' ? 'NFC' : 'Manuell'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 16px 100px' }}>


        {/* Zeiten */}
        <div className="form-group">
          <label>Arbeitsbeginn</label>
          <input
            type="datetime-local"
            max={now}
            value={startVal}
            onChange={(e) => { setStartVal(e.target.value); setErrors([]); }}
          />
        </div>

        <div className="form-group">
          <label>
            Arbeitsende{' '}
            <span style={{ fontWeight: 400, color: '#9ca3af' }}>
              (leer lassen wenn noch aktiv)
            </span>
          </label>
          <input
            type="datetime-local"
            max={now}
            value={endVal}
            onChange={(e) => { setEndVal(e.target.value); setErrors([]); }}
          />
          {endVal && (
            <button
              onClick={() => setEndVal('')}
              style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 12,
                padding: '4px 0', cursor: 'pointer' }}
            >
              Ende entfernen
            </button>
          )}
        </div>

        {/* Pausen */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 600,
            color: '#374151', marginBottom: 8 }}>
            Pausen
          </label>

          {breaks.length === 0 && (
            <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 8 }}>
              Keine Pausen eingetragen.
            </p>
          )}

          {breaks.map((b) => {
            const durationMins = b.endTime ? Math.floor((b.endTime - b.startTime) / 60000) : null;
            return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 6, background: '#fff8ed', borderRadius: 8, padding: '8px 12px' }}>
              <span style={{ flex: 1, fontSize: 14 }}>
                {b.source === 'manual' ? (
                  <>
                    {durationMins !== null ? `${durationMins} Min. Pause` : <span style={{ color: '#059669' }}>laufend</span>}
                    <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>(manuell)</span>
                  </>
                ) : (
                  <>
                    {formatTime(b.startTime)}
                    {' – '}
                    {b.endTime ? formatTime(b.endTime) : <span style={{ color: '#059669' }}>offen</span>}
                  </>
                )}
              </span>
              <button
                onClick={() => removeBreak(b.id)}
                style={{ background: 'none', border: 'none', color: '#ef4444',
                  cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px',
                  minWidth: 36, minHeight: 36 }}
                title="Pause entfernen"
              >
                ×
              </button>
            </div>
            );
          })}

          {/* Pause hinzufügen */}
          <div style={{ background: '#f9fafb', borderRadius: 10, padding: '12px', marginTop: 8 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#374151' }}>
              Pause hinzufügen
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label style={{ fontSize: 12 }}>Dauer (Minuten)</label>
                <input
                  type="number"
                  min="1"
                  max="480"
                  value={newBreakMinutes}
                  onChange={(e) => setNewBreakMinutes(e.target.value)}
                  placeholder="z.B. 30"
                  onKeyDown={(e) => e.key === 'Enter' && addBreak()}
                />
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={addBreak}
                style={{ whiteSpace: 'nowrap', marginBottom: 0 }}
              >
                + Hinzufügen
              </button>
            </div>
            {breakErrors.map((e) => (
              <p key={e} style={{ color: '#dc2626', fontSize: 13, marginBottom: 6 }}>{e}</p>
            ))}
          </div>
        </div>

        {/* Validierungsfeedback */}
        {errors.map((e) => (
          <div key={e} style={{ background: '#fee2e2', borderRadius: 8, padding: '10px 14px',
            marginBottom: 8, fontSize: 13, color: '#991b1b' }}>
            ⚠ {e}
          </div>
        ))}
        {warnings.map((w) => (
          <div key={w} style={{ background: '#fef3c7', borderRadius: 8, padding: '10px 14px',
            marginBottom: 8, fontSize: 13, color: '#92400e' }}>
            ⚠ {w}
          </div>
        ))}

        {/* Begründung */}
        <div className="form-group">
          <label>Grund der Änderung (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z.B. Vergessen auszustempeln"
            autoComplete="off"
          />
        </div>

        <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || newBreakMinutes.trim() !== ''}
          >
            {saving ? 'Wird gespeichert…' : 'Änderungen speichern'}
          </button>
          <button className="btn btn-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>

        {/* Korrektur-Verlauf */}
        {session.correctionLog.length > 0 && (
          <div style={{ marginTop: 28, borderTop: '1px solid #e8eaed', paddingTop: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 12 }}>
              Änderungsverlauf
            </p>
            {[...session.correctionLog]
              .reverse()
              .map((entry) => (
              <div key={entry.id} style={{ borderLeft: '3px solid #dbeafe', paddingLeft: 12,
                marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  {new Date(entry.timestamp).toLocaleString('de-DE', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {' · '}
                  <span style={{ color: '#2563eb' }}>
                    {entry.adminName === 'Mitarbeiter' ? 'Mitarbeiter' : 'Admin'}
                  </span>
                </div>
                {/* Zeitänderung: alt → neu */}
                {entry.oldValue && entry.newValue && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    <span style={{ background: '#fee2e2', borderRadius: 3, padding: '1px 5px' }}>
                      {entry.oldValue}
                    </span>
                    {' → '}
                    <span style={{ background: '#d1fae5', borderRadius: 3, padding: '1px 5px' }}>
                      {entry.newValue}
                    </span>
                  </div>
                )}
                {/* Pause hinzugefügt */}
                {entry.field === 'break_add' && entry.newValue && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    Pause hinzugefügt:{' '}
                    <span style={{ background: '#d1fae5', borderRadius: 3, padding: '1px 5px' }}>
                      {entry.newValue}
                    </span>
                  </div>
                )}
                {/* Pause entfernt */}
                {entry.field === 'break_remove' && entry.oldValue && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    Pause entfernt:{' '}
                    <span style={{ background: '#fee2e2', borderRadius: 3, padding: '1px 5px' }}>
                      {entry.oldValue}
                    </span>
                  </div>
                )}
                {/* Erstanlage */}
                {entry.field === 'session_add' && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    Eintrag erstellt
                  </div>
                )}
                {entry.note && (
                  <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginTop: 2 }}>
                    „{entry.note}"
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
