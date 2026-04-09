import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as db from '../db';
import { formatTime, formatDuration } from '../utils';
import type { User, WorkSession } from '../types';

type State =
  | { phase: 'loading' }
  | { phase: 'notFound' }
  | { phase: 'forgot_clockout'; user: User; missedSession: WorkSession }
  | { phase: 'clocked_out'; user: User }
  | { phase: 'clocked_in'; user: User; session: WorkSession }
  | { phase: 'on_break'; user: User; session: WorkSession }
  | { phase: 'done'; message: string; sub: string; color: string };

export default function StampScreen() {
  const { userId } = useParams<{ userId: string }>();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [busy, setBusy] = useState(false);
  const [correctedTime, setCorrectedTime] = useState('18:00');

  useEffect(() => {
    if (!userId) { setState({ phase: 'notFound' }); return; }
    load();
  }, [userId]);

  async function load() {
    setState({ phase: 'loading' });
    const user = await db.getUserById(userId!);
    if (!user) { setState({ phase: 'notFound' }); return; }

    // Auto-close any sessions from previous days
    await db.autoCloseOldActiveSessions();

    const session = await db.getActiveSession(user.id);
    if (!session) {
      // Check if there's an unacknowledged auto-closed session
      const missedSession = await db.getLastAutoClosedSession(user.id);
      if (missedSession) {
        // Pre-fill corrected time to start time + 8h, capped at 23:59
        const startDate = new Date(missedSession.startTime);
        const defaultHour = Math.min(startDate.getHours() + 8, 23);
        const defaultMin = startDate.getMinutes();
        setCorrectedTime(
          `${String(defaultHour).padStart(2, '0')}:${String(defaultMin).padStart(2, '0')}`
        );
        setState({ phase: 'forgot_clockout', user, missedSession });
      } else {
        setState({ phase: 'clocked_out', user });
      }
    } else if (session.status === 'on_break') {
      setState({ phase: 'on_break', user, session });
    } else {
      setState({ phase: 'clocked_in', user, session });
    }
  }

  async function handleAcknowledgeForgot() {
    if (state.phase !== 'forgot_clockout' || busy) return;
    setBusy(true);
    try {
      const { missedSession, user } = state;
      const sessionDay = new Date(missedSession.startTime);
      const [hours, minutes] = correctedTime.split(':').map(Number);
      const correctedEnd = new Date(
        sessionDay.getFullYear(),
        sessionDay.getMonth(),
        sessionDay.getDate(),
        hours,
        minutes,
        0
      ).getTime();

      // Make sure corrected end is after start
      if (correctedEnd <= missedSession.startTime) {
        alert('Die Endzeit muss nach der Startzeit liegen.');
        return;
      }

      await db.acknowledgeAutoClosedSession(missedSession.id, correctedEnd);
      setState({ phase: 'clocked_out', user });
    } finally {
      setBusy(false);
    }
  }

  async function handleClockIn() {
    if (state.phase !== 'clocked_out' || busy) return;
    setBusy(true);
    try {
      await db.startSession(state.user.id, 'nfc');
      setState({ phase: 'done', message: `Eingestempelt`, sub: `Guten Start, ${state.user.name}!`, color: '#10b981' });
    } finally { setBusy(false); }
  }

  async function handleClockOut() {
    if ((state.phase !== 'clocked_in' && state.phase !== 'on_break') || busy) return;
    const { user, session } = state;
    setBusy(true);
    try {
      const stopped = await db.stopSession(session.id);
      const net = Math.max(0, Math.floor((stopped.endTime! - stopped.startTime) / 60000) - stopped.totalBreakMinutes);
      setState({ phase: 'done', message: `Ausgestempelt`, sub: `${formatDuration(net)} gearbeitet – Tschüss, ${user.name}!`, color: '#6B78C4' });
    } finally { setBusy(false); }
  }

  async function handleStartBreak() {
    if (state.phase !== 'clocked_in' || busy) return;
    const { session } = state;
    setBusy(true);
    try {
      await db.startBreak(session.id, 'nfc');
      setState({ phase: 'done', message: `Pause gestartet`, sub: `Erholsame Pause!`, color: '#f59e0b' });
    } finally { setBusy(false); }
  }

  async function handleEndBreak() {
    if (state.phase !== 'on_break' || busy) return;
    const { session } = state;
    setBusy(true);
    try {
      await db.endBreak(session.id, 'nfc');
      setState({ phase: 'done', message: `Pause beendet`, sub: `Weiter so!`, color: '#10b981' });
    } finally { setBusy(false); }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (state.phase === 'loading') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
          <p style={styles.sub}>Wird geladen…</p>
        </div>
      </div>
    );
  }

  if (state.phase === 'notFound') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>❌</div>
          <h1 style={styles.name}>Unbekannter Mitarbeiter</h1>
          <p style={styles.sub}>Dieser Link ist nicht gültig.</p>
          <HomeButton />
        </div>
      </div>
    );
  }

  if (state.phase === 'forgot_clockout') {
    const { user, missedSession } = state;
    const sessionDate = new Date(missedSession.startTime);
    const dateStr = sessionDate.toLocaleDateString('de-DE', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    const startStr = formatTime(missedSession.startTime);
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ ...styles.name, fontSize: 20 }}>Vergessen auszustempeln</h1>
          <p style={{ ...styles.sub, marginBottom: 24 }}>
            Hallo {user.name}, am <strong>{dateStr}</strong> wurde das Ausstempeln vergessen.
            <br />
            <span style={{ fontSize: 13 }}>Eingestempelt: {startStr} Uhr</span>
          </p>

          <p style={{ ...styles.sub, fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            Bis wann hast du an diesem Tag gearbeitet?
          </p>
          <input
            type="time"
            value={correctedTime}
            onChange={(e) => setCorrectedTime(e.target.value)}
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 12,
              border: '2px solid var(--border, #e2e8f0)',
              fontSize: 22,
              fontWeight: 700,
              textAlign: 'center',
              color: 'var(--text-primary, #1e2a3b)',
              background: 'var(--bg-secondary, #f7f9ff)',
              marginBottom: 20,
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />

          <button
            style={{ ...styles.btn, background: '#6B78C4', marginBottom: 10 }}
            onClick={handleAcknowledgeForgot}
            disabled={busy}
          >
            {busy ? 'Bitte warten…' : 'Speichern & weiter'}
          </button>
          <button
            style={{ ...styles.btn, background: 'var(--bg-secondary, #eef0fa)', color: 'var(--text-label, #4a5568)', fontSize: 15 }}
            onClick={() => {
              // Skip correction, just mark it acknowledged with the auto-close time
              db.acknowledgeAutoClosedSession(missedSession.id, missedSession.endTime!).catch(console.error);
              setState({ phase: 'clocked_out', user });
            }}
            disabled={busy}
          >
            Überspringen
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'done') {
    return (
      <div style={{ ...styles.page, background: state.color }}>
        <div style={styles.card}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>✓</div>
          <h1 style={{ ...styles.name, fontSize: 26 }}>{state.message}</h1>
          <p style={styles.sub}>{state.sub}</p>
          <HomeButton />
        </div>
      </div>
    );
  }

  if (state.phase === 'clocked_out') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>👋</div>
          <h1 style={styles.name}>{state.user.name}</h1>
          <p style={{ ...styles.sub, marginBottom: 32 }}>Noch nicht eingestempelt</p>
          <button style={{ ...styles.btn, background: '#10b981' }} onClick={handleClockIn} disabled={busy}>
            {busy ? 'Bitte warten…' : 'Einstempeln'}
          </button>
          <HomeButton />
        </div>
      </div>
    );
  }

  if (state.phase === 'clocked_in') {
    const { user, session } = state;
    const mins = Math.floor((Date.now() - session.startTime) / 60000);
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>💼</div>
          <h1 style={styles.name}>{user.name}</h1>
          <p style={styles.sub}>
            Eingestempelt seit {formatTime(session.startTime)}<br />
            <span style={{ fontSize: 13 }}>{formatDuration(mins)} gearbeitet</span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 32, width: '100%' }}>
            <button style={{ ...styles.btn, background: '#f59e0b' }} onClick={handleStartBreak} disabled={busy}>
              Pause starten
            </button>
            <button style={{ ...styles.btn, background: '#6B78C4' }} onClick={handleClockOut} disabled={busy}>
              Ausstempeln
            </button>
          </div>
          <HomeButton />
        </div>
      </div>
    );
  }

  if (state.phase === 'on_break') {
    const { user, session } = state;
    const currentBreak = session.breaks.find((b) => b.endTime === null);
    const breakMins = currentBreak ? Math.floor((Date.now() - currentBreak.startTime) / 60000) : 0;
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>☕</div>
          <h1 style={styles.name}>{user.name}</h1>
          <p style={styles.sub}>
            In der Pause seit {currentBreak ? formatTime(currentBreak.startTime) : '–'}<br />
            <span style={{ fontSize: 13 }}>{formatDuration(breakMins)} Pause</span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 32, width: '100%' }}>
            <button style={{ ...styles.btn, background: '#10b981' }} onClick={handleEndBreak} disabled={busy}>
              Pause beenden
            </button>
            <button style={{ ...styles.btn, background: '#6B78C4' }} onClick={handleClockOut} disabled={busy}>
              Ausstempeln
            </button>
          </div>
          <HomeButton />
        </div>
      </div>
    );
  }

  return null;
}

function HomeButton() {
  return (
    <a
      href="/"
      style={{
        display: 'block',
        width: '100%',
        padding: '14px 20px',
        borderRadius: 14,
        border: 'none',
        background: 'var(--bg-secondary, #eef0fa)',
        color: 'var(--text-label, #4a5568)',
        fontSize: 15,
        fontWeight: 600,
        textAlign: 'center',
        textDecoration: 'none',
        marginTop: 12,
      }}
    >
      Zur Startseite
    </a>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-base, #eef1f8)',
    padding: 24,
    transition: 'background 0.3s',
  },
  card: {
    background: 'var(--bg-card, #fff)',
    borderRadius: 24,
    padding: '40px 32px',
    width: '100%',
    maxWidth: 360,
    textAlign: 'center',
    boxShadow: '0 8px 40px rgba(99,102,241,0.12)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  name: {
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--text-primary, #1e2a3b)',
    letterSpacing: '-0.3px',
    marginBottom: 8,
  },
  sub: {
    fontSize: 15,
    color: 'var(--text-secondary, #7c8db0)',
    lineHeight: 1.5,
  },
  btn: {
    width: '100%',
    padding: '16px 20px',
    borderRadius: 14,
    border: 'none',
    color: '#fff',
    fontSize: 17,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'opacity 0.15s, transform 0.1s',
  },
};
