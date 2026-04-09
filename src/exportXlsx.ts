import ExcelJS from 'exceljs';
import type { WorkSession, User } from './types';
import { formatTime, formatDuration } from './utils';

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function getEditNotes(sessions: WorkSession[]): string {
  const EDIT_FIELDS = ['startTime', 'endTime', 'break_add', 'break_edit', 'break_remove'];
  const notes: string[] = [];
  for (const s of sessions) {
    for (const entry of s.correctionLog) {
      if (EDIT_FIELDS.includes(entry.field) && entry.note && !notes.includes(entry.note)) {
        notes.push(entry.note);
      }
    }
  }
  return notes.join(' | ');
}

export async function generateAndDownloadXlsx(
  sessions: WorkSession[],
  users: User[],
  year: number,
  month: number,
  filename: string,
  minimumWage?: number,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  // All calendar days of the month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const allDays: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    allDays.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  }

  // Build per-user session map
  const sessionsByUser = new Map<string, WorkSession[]>();
  for (const user of users) sessionsByUser.set(user.id, []);
  for (const s of sessions) {
    if (sessionsByUser.has(s.userId)) sessionsByUser.get(s.userId)!.push(s);
  }

  // ── Summary sheet ────────────────────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Übersicht');
  summarySheet.columns = [
    { key: 'name',      width: 22 },
    { key: 'stunden',   width: 20 },
    { key: 'verdienst', width: 20 },
  ];

  const monthLabel = new Date(year, month, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  const summaryTitle = summarySheet.addRow([`Monatsübersicht – ${monthLabel}`]);
  summaryTitle.getCell(1).font = { bold: true, size: 14 };
  summarySheet.addRow([]);

  const showEarnings = users.some((u) => {
    const r = u.useMinimumWage ? minimumWage : u.hourlyRate;
    return r != null && r > 0;
  });

  const summaryHeaders: string[] = ['Mitarbeiter', 'Arbeitszeit (h:min)'];
  if (showEarnings) summaryHeaders.push('Gesamtverdienst (€)');

  const summaryHeaderRow = summarySheet.addRow(summaryHeaders);
  summaryHeaderRow.eachCell((cell) => { cell.font = { bold: true }; });

  let grandTotalMinutes = 0;
  let grandTotalEarnings = 0;

  for (const user of users) {
    const userSessions = (sessionsByUser.get(user.id) ?? []).filter((s) => s.endTime !== null);

    const effectiveRate = user.useMinimumWage ? minimumWage : user.hourlyRate;
    const hasRate = effectiveRate != null && effectiveRate > 0;

    const byDay = new Map<string, WorkSession[]>();
    for (const s of userSessions) {
      const key = new Date(s.startTime).toLocaleDateString('sv-SE');
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(s);
    }
    let userMinutes = 0;
    let userEarnings = 0;
    for (const daySessions of byDay.values()) {
      daySessions.sort((a, b) => a.startTime - b.startTime);
      const firstStart = daySessions[0].startTime;
      const lastEnd = Math.max(...daySessions.map((s) => s.endTime!));
      let pauseMinutes = daySessions.reduce((sum, s) => sum + s.totalBreakMinutes, 0);
      for (let i = 1; i < daySessions.length; i++) {
        pauseMinutes += Math.max(0, Math.floor((daySessions[i].startTime - daySessions[i - 1].endTime!) / 60000));
      }
      const net = Math.max(0, Math.floor((lastEnd - firstStart) / 60000) - pauseMinutes);
      userMinutes += net;
      if (hasRate) userEarnings += (net / 60) * effectiveRate!;
    }

    grandTotalMinutes += userMinutes;
    grandTotalEarnings += userEarnings;

    const summaryRowData: (string | number)[] = [user.name, formatDuration(userMinutes)];
    if (showEarnings) summaryRowData.push(parseFloat(userEarnings.toFixed(2)));
    summarySheet.addRow(summaryRowData);
  }

  // Summary totals row
  summarySheet.addRow([]);
  const summaryTotalData: (string | number)[] = ['Gesamt', formatDuration(grandTotalMinutes)];
  if (showEarnings) summaryTotalData.push(parseFloat(grandTotalEarnings.toFixed(2)));
  const summaryTotalRow = summarySheet.addRow(summaryTotalData);
  summaryTotalRow.eachCell((cell) => { if (cell.value) cell.font = { bold: true }; });

  // ── Detail sheet ─────────────────────────────────────────────────────────────
  const sheet = workbook.addWorksheet('Monatsdetails');
  sheet.columns = [
    { key: 'datum',     width: 14 },
    { key: 'wochentag', width: 13 },
    { key: 'beginn',    width: 14 },
    { key: 'ende',      width: 14 },
    { key: 'pause',     width: 14 },
    { key: 'gesamt',    width: 20 },
    { key: 'dezimal',   width: 16 },
    { key: 'verdienst', width: 18 },
    { key: 'notiz',     width: 40 },
  ];

  let firstUser = true;

  for (const user of users) {
    if (!firstUser) sheet.addRow([]);
    firstUser = false;

    const effectiveRate = user.useMinimumWage ? minimumWage : user.hourlyRate;
    const hasRate = effectiveRate != null && effectiveRate > 0;
    const showUserEarnings = hasRate;

    // ── Mitarbeiter-Namenszeile ────────────────────────────────────────────────
    const nameRow = sheet.addRow([`Mitarbeiter: ${user.name}`]);
    nameRow.getCell(1).font = { bold: true, size: 13 };

    // ── Spalten-Kopfzeile ──────────────────────────────────────────────────────
    const headers = [
      'Datum', 'Wochentag', 'Arbeitsbeginn', 'Arbeitsende',
      'Pause', 'Arbeitszeit gesamt', 'Zeit in Dezimal',
      ...(showUserEarnings ? ['Gesamtverdienst (€)'] : []),
      'Notiz',
    ];
    const headerRow = sheet.addRow(headers);
    headerRow.eachCell((cell) => { cell.font = { underline: true, bold: false }; });

    const userSessions = (sessionsByUser.get(user.id) ?? [])
      .filter((s) => s.endTime !== null)
      .sort((a, b) => a.startTime - b.startTime);

    const byDay = new Map<string, WorkSession[]>();
    for (const s of userSessions) {
      const key = new Date(s.startTime).toLocaleDateString('sv-SE');
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(s);
    }

    let monthlyTotalMinutes = 0;
    let monthlyEarnings = 0;

    for (const dayKey of allDays) {
      const date = new Date(`${dayKey}T12:00:00`);
      const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const weekday = WEEKDAYS[date.getDay()];
      const daySessions = byDay.get(dayKey);

      if (!daySessions || daySessions.length === 0) {
        sheet.addRow([
          dateStr, weekday, '', '', '', '', '',
          ...(showUserEarnings ? [''] : []),
          '',
        ]);
        continue;
      }

      daySessions.sort((a, b) => a.startTime - b.startTime);
      const firstStart = daySessions[0].startTime;
      const lastEnd = Math.max(...daySessions.map((s) => s.endTime!));

      let pauseMinutes = daySessions.reduce((sum, s) => sum + s.totalBreakMinutes, 0);
      for (let i = 1; i < daySessions.length; i++) {
        const gap = Math.floor((daySessions[i].startTime - daySessions[i - 1].endTime!) / 60000);
        if (gap > 0) pauseMinutes += gap;
      }

      const netMinutes = Math.max(0, Math.floor((lastEnd - firstStart) / 60000) - pauseMinutes);
      monthlyTotalMinutes += netMinutes;
      const decimalHours = parseFloat((netMinutes / 60).toFixed(2));
      const notiz = getEditNotes(daySessions);

      let dayEarnings: number | string = '';
      if (hasRate) {
        const val = parseFloat((decimalHours * effectiveRate!).toFixed(2));
        monthlyEarnings += val;
        dayEarnings = val;
      }

      sheet.addRow([
        dateStr,
        weekday,
        formatTime(firstStart),
        formatTime(lastEnd),
        pauseMinutes > 0 ? formatDuration(pauseMinutes) : '-',
        formatDuration(netMinutes),
        decimalHours,
        ...(showUserEarnings ? [dayEarnings] : []),
        notiz,
      ]);
    }

    // ── Monatssumme ──────────────────────────────────────────────────────────
    const monthlyDecimal = parseFloat((monthlyTotalMinutes / 60).toFixed(2));
    const totalRow = sheet.addRow([
      '', '', '', '', 'Monatssumme:',
      formatDuration(monthlyTotalMinutes),
      monthlyDecimal,
      ...(showUserEarnings ? [parseFloat(monthlyEarnings.toFixed(2))] : []),
      '',
    ]);
    totalRow.eachCell((cell) => { if (cell.value) cell.font = { bold: true }; });
  }

  // Generate and download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
