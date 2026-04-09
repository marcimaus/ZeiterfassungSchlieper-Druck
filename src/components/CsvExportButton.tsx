import { useState } from 'react';
import { formatMonth } from '../utils';
import { generateAndDownloadXlsx } from '../exportXlsx';
import { generateAndPrintPdf } from '../exportPdf';
import type { User } from '../types';
import * as db from '../db';

interface Props {
  users: User[];
  year: number;
  month: number;
}

export default function CsvExportButton({ users, year, month }: Props) {
  const [loadingXlsx, setLoadingXlsx] = useState(false);
  const [loadingPdf, setLoadingPdf] = useState(false);

  async function handleExportXlsx() {
    setLoadingXlsx(true);
    try {
      const [sessions, config] = await Promise.all([
        db.getAllSessionsForMonth(year, month),
        db.getAdminConfig(),
      ]);
      const label = formatMonth(year, month);
      await generateAndDownloadXlsx(sessions, users, year, month, `Arbeitszeiten ${label}.xlsx`, config?.minimumWage);
      await db.setAdminConfig({ lastExportAt: Date.now() });
    } catch (err) {
      alert('Export fehlgeschlagen: ' + (err as Error).message);
    } finally {
      setLoadingXlsx(false);
    }
  }

  async function handleExportPdf() {
    // Open window synchronously (before any await) so the browser doesn't block it as a popup
    const win = window.open('', '_blank');
    if (!win) {
      alert('Bitte Pop-ups für diese Seite erlauben, um den PDF-Export zu nutzen.');
      return;
    }
    win.document.write('<html><body style="font-family:sans-serif;padding:20px">Daten werden geladen…</body></html>');
    setLoadingPdf(true);
    try {
      const [sessions, config] = await Promise.all([
        db.getAllSessionsForMonth(year, month),
        db.getAdminConfig(),
      ]);
      generateAndPrintPdf(win, sessions, users.filter(u => u.isActive), year, month, config?.minimumWage);
    } catch (err) {
      win.close();
      alert('PDF-Export fehlgeschlagen: ' + (err as Error).message);
    } finally {
      setLoadingPdf(false);
    }
  }

  const label = formatMonth(year, month);
  const busy = loadingXlsx || loadingPdf;

  return (
    <div style={{ margin: '12px 12px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        className="btn btn-secondary"
        style={{ width: '100%' }}
        onClick={handleExportXlsx}
        disabled={busy}
      >
        {loadingXlsx ? 'Wird exportiert…' : `Excel – ${label}`}
      </button>
      <button
        className="btn btn-secondary"
        style={{ width: '100%' }}
        onClick={handleExportPdf}
        disabled={busy}
      >
        {loadingPdf ? 'Wird erstellt…' : `PDF – ${label}`}
      </button>
    </div>
  );
}
