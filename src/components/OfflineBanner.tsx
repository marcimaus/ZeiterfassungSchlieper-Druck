interface Props {
  isOnline: boolean;
}

export default function OfflineBanner({ isOnline }: Props) {
  if (isOnline) return null;
  return (
    <div className="offline-banner">
      Offline – Änderungen werden synchronisiert, sobald die Verbindung wiederhergestellt ist.
    </div>
  );
}
