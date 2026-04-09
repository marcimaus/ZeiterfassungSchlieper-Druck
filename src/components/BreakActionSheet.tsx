import type { User, WorkSession } from '../types';

interface Props {
  user: User;
  session: WorkSession;
  onStartBreak: () => void;
  onEndBreak: () => void;
  onClockOut: () => void;
  onCancel: () => void;
}

export default function BreakActionSheet({
  user,
  session,
  onStartBreak,
  onEndBreak,
  onClockOut,
  onCancel,
}: Props) {
  const isOnBreak = session.status === 'on_break';

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{user.name}</h2>
        <p style={{ color: '#6b7280', marginBottom: 20, fontSize: 14 }}>
          {isOnBreak ? 'Aktuell in der Pause' : 'Aktuell eingestempelt'} – Was soll passieren?
        </p>
        <div className="modal-actions">
          {isOnBreak ? (
            <button className="btn btn-primary" onClick={onEndBreak}>
              Pause beenden & weiterarbeiten
            </button>
          ) : (
            <button className="btn btn-primary" style={{ background: '#d97706' }} onClick={onStartBreak}>
              Pause starten
            </button>
          )}
          {!isOnBreak && (
            <button className="btn btn-secondary" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={onClockOut}>
              Ausstempeln
            </button>
          )}
          {isOnBreak && (
            <button className="btn btn-secondary" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={onClockOut}>
              Ausstempeln (Pause endet automatisch)
            </button>
          )}
          <button className="btn btn-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
