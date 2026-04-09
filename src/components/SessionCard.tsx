import { useState } from 'react';
import { formatDate, formatTime, formatDuration, netDurationMinutes, elapsedMinutes } from '../utils';
import type { WorkSession } from '../types';

interface Props {
  session: WorkSession;
  isAdminMode: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

export default function SessionCard({ session, isAdminMode, onEdit, onDelete }: Props) {
  const [showLog, setShowLog] = useState(false);

  const ended = session.endTime !== null;
  const isActive = session.status === 'active';
  const isOnBreak = session.status === 'on_break';

  const net = ended
    ? netDurationMinutes(session.startTime, session.endTime!, session.totalBreakMinutes)
    : null;

  const currentBreak = session.breaks.find((b) => b.endTime === null);

  return (
    <div className="session-item">
      <div className="session-item-content">
        <div className="card-row">
          <span className="card-name">{formatDate(session.startTime)}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {session.source === 'manual' && (
              <span className="badge badge-gray" style={{ fontSize: 11, padding: '2px 8px' }}>Manuell</span>
            )}
            {ended ? (
              <span className="badge badge-gray">{formatDuration(net!)}</span>
            ) : isOnBreak ? (
              <span className="badge badge-orange">● Pause</span>
            ) : (
              <span className="badge badge-green">● Aktiv</span>
            )}
          </div>
        </div>

        <div className="card-sub">
          {formatTime(session.startTime)}
          {session.endTime ? ` – ${formatTime(session.endTime)}` : isActive ? ' – laufend' : ' – in Pause'}
          {session.totalBreakMinutes > 0 && ` · Pause: ${session.totalBreakMinutes} Min.`}
        </div>

        {/* Individual break periods */}
        {session.breaks.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {session.breaks.map((b) => (
              <div key={b.id} style={{ fontSize: 12, color: '#9a3412', marginTop: 2 }}>
                Pause: {formatTime(b.startTime)} – {b.endTime ? formatTime(b.endTime) : 'laufend'}
                {b.source === 'manual' && ' (manuell)'}
                {currentBreak?.id === b.id && (
                  <span style={{ marginLeft: 6 }}>
                    ({elapsedMinutes(b.startTime)} Min.)
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Correction log toggle */}
        {session.correctionLog.length > 0 && (
          <button
            onClick={() => setShowLog(!showLog)}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              fontSize: 12,
              padding: '4px 0',
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            {showLog ? '▲' : '▼'} {session.correctionLog.length} Korrektur{session.correctionLog.length !== 1 ? 'en' : ''}
          </button>
        )}

        {showLog && (
          <div style={{ marginTop: 6, borderTop: '1px solid #f0f0f0', paddingTop: 6 }}>
            {session.correctionLog.map((entry) => (
              <div key={entry.id} style={{ fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 1.4 }}>
                <span style={{ color: '#374151', fontWeight: 600 }}>
                  {new Date(entry.timestamp).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>{' '}
                · {entry.adminName}
                {entry.oldValue && entry.newValue && (
                  <> · {entry.oldValue} → {entry.newValue}</>
                )}
                {entry.note && <> · "{entry.note}"</>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="session-actions">
        {isAdminMode && onEdit && (
          <button onClick={onEdit}>Bearbeiten</button>
        )}
        {isAdminMode && onDelete && (
          <button
            className="danger"
            onClick={() => {
              if (confirm('Sitzung löschen?')) onDelete();
            }}
          >
            Löschen
          </button>
        )}
        {!isAdminMode && (
          <span style={{ flex: 1, padding: '13px 8px', fontSize: 13, color: '#d1d5db', textAlign: 'center' }}>
            Admin-Modus für Bearbeitung erforderlich
          </span>
        )}
      </div>
    </div>
  );
}
