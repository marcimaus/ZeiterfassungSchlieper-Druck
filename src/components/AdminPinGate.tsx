import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useApp } from '../context/AppContext';
import { hashPin } from '../auth';
import * as db from '../db';

interface Props {
  children: ReactNode;
}

const PIN_LENGTH = 4;

function PinDots({ value, maxLen }: { value: string; maxLen: number }) {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '24px 0 8px' }}>
      {Array.from({ length: maxLen }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: i < value.length ? '#6B78C4' : 'var(--border, #dde2f0)',
            transition: 'background 0.15s',
          }}
        />
      ))}
    </div>
  );
}

function NumPad({ onPress }: { onPress: (key: string) => void }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 12,
      marginTop: 24,
    }}>
      {keys.map((key, i) => {
        if (key === '') return <div key={i} />;
        return (
          <button
            key={key}
            onClick={() => onPress(key)}
            style={{
              height: 64,
              borderRadius: 16,
              border: 'none',
              background: key === '⌫' ? 'var(--bg-secondary, #eef0fa)' : 'var(--bg-card, #fff)',
              color: 'var(--text-primary, #1e2a3b)',
              fontSize: key === '⌫' ? 22 : 24,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(99,102,241,0.08)',
              transition: 'transform 0.08s, opacity 0.08s',
              WebkitTapHighlightColor: 'transparent',
            }}
            onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.93)')}
            onPointerUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            onPointerLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminPinGate({ children }: Props) {
  const { state, loginAdmin } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupMode, setSetupMode] = useState(false);
  const [confirmPin, setConfirmPin] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!state.isAdminMode) {
      setPin('');
      setError('');
      setConfirmPin(null);
    }
  }, [state.isAdminMode]);

  useEffect(() => {
    const timeout = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 8000)
    );
    Promise.race([db.getAdminConfig(), timeout])
      .then((config) => {
        setChecking(false);
        if (!config?.pinHash) setSetupMode(true);
      })
      .catch(() => {
        setChecking(false);
        setSetupMode(true);
      });
  }, []);

  useEffect(() => {
    if (pin.length < PIN_LENGTH || submittingRef.current) return;
    if (setupMode) {
      if (confirmPin === null) {
        setConfirmPin('');
        setError('');
      } else if (confirmPin.length === PIN_LENGTH) {
        handleSetup();
      }
    } else {
      handleLogin();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, confirmPin]);

  function handleNumPress(key: string) {
    if (loading) return;
    if (key === '⌫') {
      if (setupMode && confirmPin !== null) {
        setConfirmPin((p) => (p ?? '').slice(0, -1));
      } else {
        setPin((p) => p.slice(0, -1));
      }
      setError('');
      return;
    }
    if (setupMode && confirmPin !== null) {
      if (confirmPin.length >= PIN_LENGTH) return;
      setConfirmPin((p) => (p ?? '') + key);
    } else {
      if (pin.length >= PIN_LENGTH) return;
      setPin((p) => p + key);
    }
    setError('');
  }

  async function handleSetup() {
    if (submittingRef.current) return;
    const first = pin;
    const second = confirmPin ?? '';
    if (first !== second) {
      setError('PINs stimmen nicht überein. Erneut versuchen.');
      setPin('');
      setConfirmPin(null);
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      const pinHash = await hashPin(first);
      await db.setAdminConfig({ pinHash, lastExportAt: null });
      setSetupMode(false);
      setPin('');
      setConfirmPin(null);
      setError('');
    } catch {
      setError('Fehler beim Einrichten. Bitte erneut versuchen.');
      setPin('');
      setConfirmPin(null);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  async function handleLogin() {
    if (submittingRef.current || !pin) return;
    submittingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const ok = await loginAdmin(pin);
      if (!ok) {
        setError('Falscher PIN.');
        setPin('');
      }
    } catch {
      setError('Fehler beim Anmelden.');
      setPin('');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  if (state.isAdminMode) return <>{children}</>;
  if (checking) return <div className="empty-state"><p>Laden…</p></div>;

  const activePin = setupMode && confirmPin !== null ? confirmPin : pin;
  const title = setupMode
    ? (confirmPin === null ? 'Admin einrichten' : 'PIN bestätigen')
    : 'Admin-Bereich';
  const subtitle = setupMode
    ? (confirmPin === null ? `${PIN_LENGTH}-stelligen PIN eingeben` : 'PIN zur Bestätigung wiederholen')
    : 'PIN eingeben';

  return (
    <div style={{ padding: '32px 24px 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        {title}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 0 }}>
        {subtitle}
      </p>

      <PinDots value={activePin} maxLen={PIN_LENGTH} />

      {error && (
        <p style={{ color: '#f87171', fontSize: 13, textAlign: 'center', marginTop: 8, minHeight: 20 }}>
          {error}
        </p>
      )}
      {!error && <div style={{ minHeight: 28 }} />}

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 24 }}>Wird geprüft…</div>
      ) : (
        <NumPad onPress={handleNumPress} />
      )}
    </div>
  );
}
