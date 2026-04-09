import { useState } from 'react';
import { isNfcSupported, writeNfcUrl } from '../nfc';
import type { User } from '../types';
import { useApp } from '../context/AppContext';
import { getAge, hasWageConflict } from '../utils';
import DateScrollPicker from '../components/DateScrollPicker';

type AddStep = 'name' | 'write';

interface AddDialog {
  step: AddStep;
  name: string;
  createdUser: User | null;
  writing: boolean;
  writeSuccess: boolean;
  error: string;
}

interface EditDialog {
  user: User;
  name: string;
  birthDate: string;
  useMinimumWage: boolean;
  hourlyRate: string;
  error: string;
}

type WriteState = 'idle' | 'writing' | 'success' | 'error';

export default function UsersScreen() {
  const { state, addUser, deactivateUser, reactivateUser, deleteUser, updateUser } = useApp();
  const minimumWage = state.minimumWage;
  const [addDialog, setAddDialog] = useState<AddDialog | null>(null);
  const [deactivateConfirm, setDeactivateConfirm] = useState<User | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<User | null>(null);
  const [editDialog, setEditDialog] = useState<EditDialog | null>(null);

  // Write chip state for existing users
  const [writeChipUser, setWriteChipUser] = useState<User | null>(null);
  const [writeState, setWriteState] = useState<WriteState>('idle');
  const [writeError, setWriteError] = useState('');

  function openAdd() {
    setAddDialog({ step: 'name', name: '', createdUser: null, writing: false, writeSuccess: false, error: '' });
  }

  async function handleNameNext() {
    if (!addDialog?.name.trim()) return;
    // Generate a random UID (used only as internal identifier, URL-approach doesn't rely on it)
    const randomUid = Array.from({ length: 4 }, () =>
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()
    ).join('');
    try {
      const user = await addUser(addDialog.name.trim(), randomUid);
      setAddDialog({ ...addDialog, step: 'write', createdUser: user });
    } catch (err) {
      setAddDialog({ ...addDialog, error: (err as Error).message });
    }
  }

  async function handleWriteNewChip() {
    if (!addDialog?.createdUser) return;
    const url = `${window.location.origin}/id/${addDialog.createdUser.id}`;
    setAddDialog({ ...addDialog, writing: true, error: '' });
    try {
      await writeNfcUrl(url);
      setAddDialog({ ...addDialog, writing: false, writeSuccess: true });
    } catch (err) {
      setAddDialog({ ...addDialog, writing: false, error: (err as Error).message });
    }
  }

  async function handleWriteExistingChip() {
    if (!writeChipUser) return;
    const url = `${window.location.origin}/id/${writeChipUser.id}`;
    setWriteState('writing');
    setWriteError('');
    try {
      await writeNfcUrl(url);
      setWriteState('success');
    } catch (err) {
      setWriteError((err as Error).message);
      setWriteState('error');
    }
  }

  async function handleEditSave() {
    if (!editDialog || !editDialog.name.trim()) return;
    const rate = editDialog.hourlyRate.trim();
    const hadRate = editDialog.user.hourlyRate != null || editDialog.user.useMinimumWage;

    // Validation
    if (!editDialog.useMinimumWage && rate !== '') {
      const parsed = parseFloat(rate.replace(',', '.'));
      if (isNaN(parsed) || parsed < 0) {
        setEditDialog({ ...editDialog, error: 'Bitte einen gültigen Lohn eingeben.' });
        return;
      }
      const age = getAge(editDialog.birthDate);
      if ((age === null || age >= 18) && minimumWage !== null && parsed < minimumWage) {
        setEditDialog({ ...editDialog, error: `Lohn darf bei Personen ab 18 Jahren nicht unter dem Mindestlohn (${minimumWage.toFixed(2)} €/Std) liegen.` });
        return;
      }
    }

    const changes: Parameters<typeof updateUser>[1] = { name: editDialog.name.trim() };
    if (editDialog.birthDate) {
      changes.birthDate = editDialog.birthDate;
    } else if (editDialog.user.birthDate) {
      changes.clearBirthDate = true;
    }
    changes.useMinimumWage = editDialog.useMinimumWage;

    if (editDialog.useMinimumWage) {
      if (hadRate) changes.clearHourlyRate = true;
    } else if (rate === '') {
      if (hadRate) changes.clearHourlyRate = true;
    } else {
      changes.hourlyRate = parseFloat(rate.replace(',', '.'));
    }

    await updateUser(editDialog.user.id, changes);
    setEditDialog(null);
  }

  async function handleDeactivate(user: User) {
    await deactivateUser(user.id);
    setDeactivateConfirm(null);
  }

  async function handleReactivate(user: User) {
    await reactivateUser(user.id);
  }

  async function handleDelete(user: User) {
    await deleteUser(user.id);
    setDeleteConfirm(null);
  }

  function openWriteChip(user: User) {
    setWriteChipUser(user);
    setWriteState('idle');
    setWriteError('');
  }

  function closeWriteChip() {
    setWriteChipUser(null);
    setWriteState('idle');
    setWriteError('');
  }

  const nfcSupported = isNfcSupported();

  return (
    <>

      {(() => {
        const activeUsers = state.users.filter(u => u.isActive).sort((a, b) => {
          const aWarn = hasWageConflict(a, minimumWage) && !(a.birthDate && getAge(a.birthDate)! < 18);
          const bWarn = hasWageConflict(b, minimumWage) && !(b.birthDate && getAge(b.birthDate)! < 18);
          return Number(bWarn) - Number(aWarn);
        });
        const inactiveUsers = state.users.filter(u => !u.isActive);

        const renderCard = (user: User) => (
          <div key={user.id} className="card" style={{ cursor: 'default', padding: '6px 16px', margin: '4px 12px' }}>
            <div className="card-row">
              <div>
                <div className="card-name">{user.name}</div>
                {state.isAdminMode && (() => {
                  const age = user.birthDate ? getAge(user.birthDate) : null;
                  return age !== null && age < 18 ? (
                    <div style={{ fontSize: 12, color: '#b45309', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 6px', display: 'inline-block', marginTop: 2, fontWeight: 600 }}>
                      Minderjährig ({age} Jahre)
                    </div>
                  ) : null;
                })()}
                {state.isAdminMode && (
                  <>
                    {user.useMinimumWage && (
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Mindestlohn{minimumWage !== null ? ` (${minimumWage.toFixed(2)} €/Std)` : ''}
                      </div>
                    )}
                    {!user.useMinimumWage && user.hourlyRate != null && (() => {
                      const conflict = hasWageConflict(user, minimumWage);
                      return (
                        <div style={{ fontSize: 13, marginTop: 2, color: conflict ? '#ef4444' : 'var(--text-secondary)', fontWeight: conflict ? 600 : 400 }}>
                          {user.hourlyRate.toFixed(2)} €/Std
                          {conflict && <><br />⚠ unter Mindestlohn</>}
                        </div>
                      );
                    })()}
                  </>
                )}
              {state.isAdminMode && user.isActive && (
                  <button
                    onClick={() => openWriteChip(user)}
                    style={{ background: 'none', border: 'none', color: '#6B78C4', fontSize: 12, padding: '10px 0 0', cursor: 'pointer', textAlign: 'left', display: 'block' }}
                  >
                    Chip neu beschreiben
                  </button>
                )}
              </div>
              {state.isAdminMode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'stretch', justifyContent: 'center' }}>
                  {user.isActive ? (
                    <>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditDialog({ user, name: user.name, birthDate: user.birthDate ?? '', useMinimumWage: user.useMinimumWage ?? false, hourlyRate: user.hourlyRate != null ? String(user.hourlyRate) : '', error: '' })}
                      >
                        Bearbeiten
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => setDeactivateConfirm(user)}
                      >
                        Deaktivieren
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleReactivate(user)}
                      >
                        Aktivieren
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => setDeleteConfirm(user)}
                      >
                        Löschen
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );

        if (activeUsers.length === 0 && inactiveUsers.length === 0) {
          return (
            <div className="empty-state">
              <p>Noch keine Mitarbeiter vorhanden.</p>
              <p style={{ marginTop: 8 }}>Tippe auf "+" um jemanden hinzuzufügen.</p>
            </div>
          );
        }

        return (
          <>
            {activeUsers.length > 0 && (
              <>
                {inactiveUsers.length > 0 && (
                  <div style={{ padding: '8px 16px 4px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Aktiv
                  </div>
                )}
                {activeUsers.map(renderCard)}
              </>
            )}
            {inactiveUsers.length > 0 && (
              <>
                <div style={{ padding: '16px 16px 4px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Inaktiv
                </div>
                {inactiveUsers.map(renderCard)}
              </>
            )}
          </>
        );
      })()}

      {state.isAdminMode && (
        <button className="fab" onClick={openAdd} title="Mitarbeiter hinzufügen">
          +
        </button>
      )}
      {!state.isAdminMode && state.users.filter(u => u.isActive).length === 0 && (
        <div className="empty-state" style={{ paddingTop: 20 }}>
          <p style={{ fontSize: 13 }}>Mitarbeiter können nur vom Admin angelegt werden.</p>
        </div>
      )}

      {/* Add dialog */}
      {addDialog && (
        <div className="modal-overlay">
          <div className="modal">
            {addDialog.step === 'name' ? (
              <>
                <h2>Neuer Mitarbeiter</h2>
                <div className="form-group">
                  <label>Name</label>
                  <input
                    autoFocus
                    value={addDialog.name}
                    onChange={(e) => setAddDialog({ ...addDialog, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && addDialog.name.trim()) handleNameNext();
                    }}
                    placeholder="z.B. Max Mustermann"
                  />
                </div>
                {addDialog.error && (
                  <p style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{addDialog.error}</p>
                )}
                <div className="modal-actions">
                  <button
                    className="btn btn-primary"
                    disabled={!addDialog.name.trim()}
                    onClick={handleNameNext}
                  >
                    Weiter
                  </button>
                  <button className="btn btn-secondary" onClick={() => setAddDialog(null)}>
                    Abbrechen
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>Chip beschreiben</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14, lineHeight: 1.5 }}>
                  <strong>{addDialog.createdUser?.name}</strong> wurde angelegt.
                  {nfcSupported
                    ? ' Halte jetzt den NFC-Chip ans Gerät um ihn mit der Stempel-URL zu beschreiben.'
                    : ' NFC ist auf diesem Gerät nicht verfügbar – du kannst den Schritt überspringen.'}
                </p>

                {addDialog.writeSuccess ? (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div style={{ fontSize: 48 }}>✅</div>
                    <p style={{ marginTop: 8, fontWeight: 600, color: '#10b981' }}>Chip erfolgreich beschrieben!</p>
                  </div>
                ) : addDialog.writing ? (
                  <div className="nfc-scanning">
                    <div className="nfc-icon">📡</div>
                    <p style={{ marginTop: 12, color: 'var(--text-secondary)' }}>Halte den Chip ans Gerät…</p>
                  </div>
                ) : (
                  <>
                    {addDialog.error && (
                      <p style={{ color: '#f87171', marginBottom: 12, fontSize: 13 }}>{addDialog.error}</p>
                    )}
                  </>
                )}

                <div className="modal-actions" style={{ marginTop: addDialog.writing ? 16 : 20 }}>
                  {!addDialog.writing && !addDialog.writeSuccess && nfcSupported && (
                    <button className="btn btn-primary" onClick={handleWriteNewChip}>
                      Chip jetzt beschreiben
                    </button>
                  )}
                  <button className="btn btn-secondary" onClick={() => setAddDialog(null)}>
                    {addDialog.writeSuccess ? 'Fertig' : 'Überspringen'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit dialog */}
      {editDialog && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Mitarbeiter bearbeiten</h2>
            <div className="form-group">
              <label>Name</label>
              <input
                autoFocus
                value={editDialog.name}
                onChange={(e) => setEditDialog({ ...editDialog, name: e.target.value, error: '' })}
              />
            </div>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ marginBottom: 0 }}>Geburtsdatum</label>
                {editDialog.birthDate && (
                  <button
                    type="button"
                    onClick={() => setEditDialog({ ...editDialog, birthDate: '', error: '' })}
                    style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 13, cursor: 'pointer', padding: 0 }}
                  >
                    Entfernen
                  </button>
                )}
              </div>
              {editDialog.birthDate ? (
                <DateScrollPicker
                  value={editDialog.birthDate}
                  onChange={(v) => setEditDialog({ ...editDialog, birthDate: v, error: '' })}
                />
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: 13 }}
                  onClick={() => setEditDialog({ ...editDialog, birthDate: '1990-01-01', error: '' })}
                >
                  Geburtsdatum hinzufügen
                </button>
              )}
            </div>

            {/* Minimum wage checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 12px' }}>
              <input
                type="checkbox"
                id="useMinWage"
                checked={editDialog.useMinimumWage}
                onChange={(e) => setEditDialog({ ...editDialog, useMinimumWage: e.target.checked, hourlyRate: '', error: '' })}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <label htmlFor="useMinWage" style={{ cursor: 'pointer', fontSize: 14, color: 'var(--text-primary)', userSelect: 'none' }}>
                Nach Mindestlohn bezahlen
                {minimumWage !== null && (
                  <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>({minimumWage.toFixed(2)} €/Std)</span>
                )}
              </label>
            </div>

            {!editDialog.useMinimumWage && (
              <div className="form-group">
                <label>Stundenlohn (€) <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="z.B. 14.50"
                  value={editDialog.hourlyRate}
                  onChange={(e) => setEditDialog({ ...editDialog, hourlyRate: e.target.value, error: '' })}
                />
              </div>
            )}

            {editDialog.error && (
              <p style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{editDialog.error}</p>
            )}

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                disabled={!editDialog.name.trim()}
                onClick={handleEditSave}
              >
                Speichern
              </button>
              <button className="btn btn-secondary" onClick={() => setEditDialog(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Write chip dialog for existing users */}
      {writeChipUser && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Chip neu beschreiben</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14, lineHeight: 1.5 }}>
              Mitarbeiter: <strong>{writeChipUser.name}</strong><br />
              {nfcSupported
                ? 'Halte den NFC-Chip ans Gerät um ihn mit der Stempel-URL zu beschreiben.'
                : 'NFC ist auf diesem Gerät nicht verfügbar.'}
            </p>

            {writeState === 'writing' && (
              <div className="nfc-scanning">
                <div className="nfc-icon">📡</div>
                <p style={{ marginTop: 12, color: 'var(--text-secondary)' }}>Halte den Chip ans Gerät…</p>
              </div>
            )}
            {writeState === 'success' && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 48 }}>✅</div>
                <p style={{ marginTop: 8, fontWeight: 600, color: '#10b981' }}>Chip erfolgreich beschrieben!</p>
              </div>
            )}
            {writeState === 'error' && (
              <p style={{ color: '#f87171', marginBottom: 12, fontSize: 13 }}>{writeError}</p>
            )}

            <div className="modal-actions">
              {writeState !== 'writing' && writeState !== 'success' && nfcSupported && (
                <button className="btn btn-primary" onClick={handleWriteExistingChip}>
                  Chip beschreiben
                </button>
              )}
              <button className="btn btn-secondary" onClick={closeWriteChip}>
                {writeState === 'success' ? 'Fertig' : 'Abbrechen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate confirm */}
      {deactivateConfirm && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Mitarbeiter deaktivieren?</h2>
            <p style={{ color: 'var(--text-secondary)', margin: '12px 0' }}>
              "{deactivateConfirm.name}" wird deaktiviert und erscheint nicht mehr in der Übersicht.
              Alle bisherigen Zeiteinträge bleiben erhalten. Die Person kann jederzeit wieder aktiviert werden.
            </p>
            <div className="modal-actions">
              <button className="btn btn-danger" onClick={() => handleDeactivate(deactivateConfirm)}>
                Deaktivieren
              </button>
              <button className="btn btn-secondary" onClick={() => setDeactivateConfirm(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Mitarbeiter löschen?</h2>
            <p style={{ color: 'var(--text-secondary)', margin: '12px 0' }}>
              "{deleteConfirm.name}" wird unwiderruflich gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            <div className="modal-actions">
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>
                Endgültig löschen
              </button>
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
