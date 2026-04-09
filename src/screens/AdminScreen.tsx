import { useState, useEffect } from 'react';
import AdminPinGate from '../components/AdminPinGate';

import CsvExportButton from '../components/CsvExportButton';
import UsersScreen from './UsersScreen';
import { useApp } from '../context/AppContext';
import * as db from '../db';
import { hashPin } from '../auth';
import { formatMonth, hasWageConflict } from '../utils';
import { useDarkMode } from '../hooks/useDarkMode';
import type { User } from '../types';

type AdminTab = 'sessions' | 'users' | 'settings' | 'passwords';

interface PasswordDialog {
  user: User;
  step: 'enter' | 'confirm';
  pin: string;    // first PIN entered (saved after step 1)
  input: string;  // current numpad input
  error: string;
  saving: boolean;
}

export default function AdminScreen() {
  const { state, setUserPassword, removeUserPassword, notifyMinimumWageChanged } = useApp();
  const { dark, setDark } = useDarkMode();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const [adminTab, setAdminTab] = useState<AdminTab>('sessions');
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  // Settings state
  const [pinDialog, setPinDialog] = useState<{ step: 'enter' | 'confirm'; pin: string; input: string; error: string; saving: boolean } | null>(null);
  const [pinMessage, setPinMessage] = useState('');

  // Email report settings
  const [reportEmail, setReportEmail] = useState('info@schlieper-druck.com');
  const [reportTime, setReportTime] = useState('07:00');
  const [reportSaving, setReportSaving] = useState(false);
  const [reportMessage, setReportMessage] = useState('');

  // Minimum wage
  const [minimumWage, setMinimumWage] = useState('');
  const [wageSaving, setWageSaving] = useState(false);
  const [wageMessage, setWageMessage] = useState('');



  // Password management state
  const [passwordDialog, setPasswordDialog] = useState<PasswordDialog | null>(null);

  // Load email config on mount
  useEffect(() => {
    db.getAdminConfig().then((config) => {
      if (config?.reportEmail) setReportEmail(config.reportEmail);
      if (config?.reportTime) setReportTime(config.reportTime);
      if (config?.minimumWage != null) setMinimumWage(String(config.minimumWage));
    }).catch(() => {});
  }, []);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }

  const isCurrentMonth = year === currentYear && month === currentMonth;

  function nextMonth() {
    if (isCurrentMonth) return;
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  async function handleSaveReportSettings() {
    setReportSaving(true);
    setReportMessage('');
    try {
      await db.setAdminConfig({ reportEmail, reportTime });
      setReportMessage('Einstellungen gespeichert.');
    } catch {
      setReportMessage('Fehler beim Speichern.');
    } finally {
      setReportSaving(false);
    }
  }

  async function handleSaveMinimumWage() {
    const val = parseFloat(minimumWage.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      setWageMessage('Bitte einen gültigen Betrag eingeben.');
      return;
    }
    setWageSaving(true);
    setWageMessage('');
    try {
      await db.setAdminConfig({ minimumWage: val });
      notifyMinimumWageChanged(val);
      setWageMessage('Mindestlohn gespeichert.');
    } catch {
      setWageMessage('Fehler beim Speichern.');
    } finally {
      setWageSaving(false);
    }
  }

  function handleAdminPinPress(key: string) {
    setPinDialog((d) => {
      if (!d || d.saving) return d;
      if (key === '⌫') return { ...d, input: d.input.slice(0, -1), error: '' };
      const next = d.input + key;
      if (next.length < 4) return { ...d, input: next, error: '' };
      if (d.step === 'enter') {
        return { ...d, pin: next, input: '', step: 'confirm', error: '' };
      }
      if (next !== d.pin) {
        return { ...d, input: '', step: 'enter', pin: '', error: 'PINs stimmen nicht überein. Bitte erneut versuchen.' };
      }
      saveAdminPin(next);
      return { ...d, input: next, saving: true, error: '' };
    });
  }

  async function saveAdminPin(pin: string) {
    try {
      const pinHash = await hashPin(pin);
      await db.setAdminConfig({ pinHash });
      setPinDialog(null);
      setPinMessage('PIN wurde erfolgreich gespeichert.');
    } catch {
      setPinDialog((d) => d ? { ...d, saving: false, error: 'Fehler beim Speichern.' } : d);
    }
  }

  function handlePasswordPinPress(key: string) {
    if (!passwordDialog || passwordDialog.saving) return;
    setPasswordDialog((d) => {
      if (!d) return d;
      if (key === '⌫') return { ...d, input: d.input.slice(0, -1), error: '' };
      const next = d.input + key;
      if (next.length < 4) return { ...d, input: next, error: '' };
      // 4th digit pressed
      if (d.step === 'enter') {
        return { ...d, pin: next, input: '', step: 'confirm', error: '' };
      }
      // confirm step
      if (next !== d.pin) {
        return { ...d, input: '', step: 'enter', pin: '', error: 'PINs stimmen nicht überein. Bitte erneut versuchen.' };
      }
      // match — save asynchronously
      savePassword(d.user.id, next);
      return { ...d, input: next, saving: true, error: '' };
    });
  }

  async function savePassword(userId: string, pin: string) {
    try {
      await setUserPassword(userId, pin);
      setPasswordDialog(null);
    } catch {
      setPasswordDialog((d) => d ? { ...d, saving: false, error: 'Fehler beim Speichern.' } : d);
    }
  }

  async function handleRemovePassword(user: User) {
    await removeUserPassword(user.id);
  }

  return (
    <AdminPinGate>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="screen-header" style={{ position: 'static' }}>
          <h1>Admin-Bereich</h1>
        </div>

        {/* Admin sub-tabs */}
        {(() => {
          const wageWarning = state.users.some(u => u.isActive && hasWageConflict(u, state.minimumWage));
          return (
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-sub-tabs)' }}>
            {(['sessions', 'users', 'passwords', 'settings'] as AdminTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setAdminTab(tab)}
                style={{
                  flex: 1,
                  padding: '12px 4px',
                  background: 'none',
                  border: 'none',
                  borderBottom: adminTab === tab ? '2px solid #6B78C4' : '2px solid transparent',
                  color: adminTab === tab ? '#6B78C4' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                {tab === 'sessions' ? 'Export' : tab === 'users' ? 'Mitarbeiter' : tab === 'passwords' ? 'Passwörter' : 'Einstellungen'}
                {tab === 'users' && wageWarning && (
                  <span style={{
                    position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#ef4444', display: 'inline-block',
                  }} />
                )}
              </button>
            ))}
          </div>
          );
        })()}
      </div>

      {adminTab === 'sessions' && (
        <div style={{ paddingBottom: 80 }}>
          <div className="month-picker">
            <button onClick={prevMonth}>‹</button>
            <span>{formatMonth(year, month)}</span>
            {isCurrentMonth
              ? <span style={{ width: 44 }} />
              : <button onClick={nextMonth}>›</button>
            }
          </div>

          <CsvExportButton users={state.users} year={year} month={month} />

          <div style={{ padding: '16px 16px 8px' }}>
            <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
              Um einzelne Sitzungen zu bearbeiten oder zu löschen, gehe in die{' '}
              <strong>Übersicht</strong> und tippe auf einen Mitarbeiter.
            </p>
          </div>
        </div>
      )}

      {adminTab === 'users' && <UsersScreen />}

      {adminTab === 'settings' && (
        <div style={{ padding: '16px 16px 24px', overflow: 'hidden' }}>

          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
              Mindestlohn
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="z.B. 12.82"
                value={minimumWage}
                onChange={(e) => { setMinimumWage(e.target.value); setWageMessage(''); }}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-input)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 15 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleSaveMinimumWage}
                disabled={wageSaving || !minimumWage}
                style={{ whiteSpace: 'nowrap' }}
              >
                {wageSaving ? '…' : 'Speichern'}
              </button>
            </div>
            {wageMessage && (
              <p style={{ fontSize: 13, marginTop: 6, color: wageMessage.includes('gespeichert') ? '#10b981' : '#f87171' }}>
                {wageMessage}
              </p>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24 }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
              Admin-PIN
            </p>
            {pinMessage && (
              <p style={{
                fontSize: 13, marginBottom: 12,
                color: pinMessage.includes('erfolgreich') || pinMessage.includes('gespeichert') ? '#10b981' : '#f87171',
              }}>
                {pinMessage}
              </p>
            )}
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={() => { setPinMessage(''); setPinDialog({ step: 'enter', pin: '', input: '', error: '', saving: false }); }}
            >
              🔑 Admin-PIN ändern
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginTop: 24 }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
              Darstellung
            </p>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 14,
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                  {dark ? '🌙 Dark Mode' : '☀️ Light Mode'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {dark ? 'Dunkles Design aktiv' : 'Helles Design aktiv'}
                </div>
              </div>
              {/* Toggle switch */}
              <button
                onClick={() => setDark(!dark)}
                style={{
                  width: 52,
                  height: 30,
                  borderRadius: 15,
                  border: 'none',
                  cursor: 'pointer',
                  background: dark ? '#6B78C4' : '#d1d5e8',
                  position: 'relative',
                  transition: 'background 0.25s',
                  flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: 3,
                  left: dark ? 25 : 3,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.25s',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginTop: 24 }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
              📧 Automatischer E-Mail-Bericht
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              Täglich wird eine Excel-Datei mit allen Arbeitszeiten des laufenden Monats per E-Mail versendet.
              Am letzten Tag des Monats wird die Mail als „Endabrechnung" markiert.
            </p>
            <div className="form-group">
              <label>Empfänger-E-Mail</label>
              <input
                type="email"
                value={reportEmail}
                onChange={(e) => setReportEmail(e.target.value)}
                placeholder="info@schlieper-druck.com"
              />
            </div>
            <div className="form-group">
              <label>Sendezeit (täglich)</label>
              <input
                type="time"
                value={reportTime}
                onChange={(e) => setReportTime(e.target.value)}
              />
            </div>
            {reportMessage && (
              <p style={{
                fontSize: 13,
                marginBottom: 12,
                color: reportMessage.includes('gespeichert') ? '#10b981' : '#f87171',
              }}>
                {reportMessage}
              </p>
            )}
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={handleSaveReportSettings}
              disabled={reportSaving || !reportEmail || !reportTime}
            >
              {reportSaving ? 'Wird gespeichert…' : 'E-Mail-Einstellungen speichern'}
            </button>
          </div>

        </div>
      )}

      {adminTab === 'passwords' && (
        <div style={{ padding: '16px 16px 80px' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
            Mitarbeiter mit Passwort sehen in der Übersicht ein Schloss-Symbol.
            Ohne Passwort ist der Bereich für alle einsehbar.
          </p>
          {state.users.length === 0 && (
            <div className="empty-state"><p>Keine Mitarbeiter vorhanden.</p></div>
          )}
          {state.users.map((user) => (
            <div key={user.id} className="card" style={{ cursor: 'default' }}>
              <div className="card-row">
                <div>
                  <div className="card-name">
                    {user.passwordHash ? '🔒 ' : ''}{user.name}
                  </div>
                  <div className="card-sub">
                    {user.passwordHash ? 'Passwort gesetzt' : 'Kein Passwort'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPasswordDialog({ user, step: 'enter', pin: '', input: '', error: '', saving: false })}
                  >
                    {user.passwordHash ? 'Ändern' : 'Setzen'}
                  </button>
                  {user.passwordHash && (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleRemovePassword(user)}
                    >
                      Entfernen
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Password dialog – numpad PIN style */}
      {passwordDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.55)',
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
              {passwordDialog.step === 'enter' ? 'Neues Passwort für' : 'Passwort bestätigen für'}
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 24 }}>
              {passwordDialog.user.name}
            </h2>

            {/* PIN dots */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 8 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: i < passwordDialog.input.length ? '#6B78C4' : 'var(--border, #dde2f0)',
                  transition: 'background 0.15s',
                }} />
              ))}
            </div>

            {passwordDialog.error && (
              <p style={{ color: '#f87171', fontSize: 13, marginBottom: 4, minHeight: 20, textAlign: 'center' }}>
                {passwordDialog.error}
              </p>
            )}
            {!passwordDialog.error && <div style={{ minHeight: 20 }} />}

            {/* Numpad */}
            {passwordDialog.saving ? (
              <div style={{ color: 'var(--text-secondary)', marginTop: 24 }}>Wird gespeichert…</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 8, width: '100%' }}>
                {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, i) => {
                  if (key === '') return <div key={i} />;
                  return (
                    <button key={key} onClick={() => handlePasswordPinPress(key)} style={{
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
              onClick={() => setPasswordDialog(null)}
              style={{ marginTop: 20, background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer' }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Admin PIN change dialog */}
      {pinDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.55)',
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
              {pinDialog.step === 'enter' ? 'Neuen Admin-PIN eingeben' : 'PIN bestätigen'}
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 24 }}>
              Admin-PIN
            </h2>

            {/* PIN dots */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 8 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: i < pinDialog.input.length ? '#6B78C4' : 'var(--border, #dde2f0)',
                  transition: 'background 0.15s',
                }} />
              ))}
            </div>

            {pinDialog.error
              ? <p style={{ color: '#f87171', fontSize: 13, marginBottom: 4, minHeight: 20, textAlign: 'center' }}>{pinDialog.error}</p>
              : <div style={{ minHeight: 20 }} />
            }

            {pinDialog.saving ? (
              <div style={{ color: 'var(--text-secondary)', marginTop: 24 }}>Wird gespeichert…</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 8, width: '100%' }}>
                {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, i) => {
                  if (key === '') return <div key={i} />;
                  return (
                    <button key={key} onClick={() => handleAdminPinPress(key)} style={{
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
              onClick={() => setPinDialog(null)}
              style={{ marginTop: 20, background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer' }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

    </AdminPinGate>
  );
}
