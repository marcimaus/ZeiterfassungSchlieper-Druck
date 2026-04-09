import type { WorkSession, User } from './types';
import { formatTime, formatDuration } from './utils';

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

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

function monthName(month: number): string {
  return new Date(2000, month, 1).toLocaleDateString('de-DE', { month: 'long' });
}

function buildUserPage(
  user: User,
  sessions: WorkSession[],
  year: number,
  month: number,
  minimumWage?: number,
): string {
  const effectiveRate = user.useMinimumWage ? minimumWage : user.hourlyRate;
  const hasRate = effectiveRate != null && effectiveRate > 0;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const allDays: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    allDays.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  }

  const byDay = new Map<string, WorkSession[]>();
  for (const s of sessions.filter((s) => s.endTime !== null).sort((a, b) => a.startTime - b.startTime)) {
    const key = new Date(s.startTime).toLocaleDateString('sv-SE');
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(s);
  }

  let monthlyMinutes = 0;
  let monthlyWorkEarnings = 0;

  const rows: string[] = [];

  for (const dayKey of allDays) {
    const date = new Date(`${dayKey}T12:00:00`);
    const dateStr = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
    const weekday = WEEKDAYS[date.getDay()];
    const isSunday = date.getDay() === 0;
    const isSaturday = date.getDay() === 6;
    const weekendClass = isSunday ? 'sunday' : isSaturday ? 'saturday' : '';

    const daySessions = byDay.get(dayKey);

    if (!daySessions || daySessions.length === 0) {
      rows.push(`<tr class="${weekendClass}">
        <td>${dateStr}</td><td>${weekday}</td>
        <td></td><td></td><td></td><td></td><td></td>${hasRate ? '<td></td>' : ''}<td></td>
      </tr>`);
      continue;
    }

    daySessions.sort((a, b) => a.startTime - b.startTime);
    const firstStart = daySessions[0].startTime;
    const lastEnd = Math.max(...daySessions.map((s) => s.endTime!));
    let pauseMinutes = daySessions.reduce((sum, s) => sum + s.totalBreakMinutes, 0);
    for (let i = 1; i < daySessions.length; i++) {
      pauseMinutes += Math.max(0, Math.floor((daySessions[i].startTime - daySessions[i - 1].endTime!) / 60000));
    }
    const netMinutes = Math.max(0, Math.floor((lastEnd - firstStart) / 60000) - pauseMinutes);
    monthlyMinutes += netMinutes;
    const decimalHours = (netMinutes / 60).toFixed(2);
    const notiz = getEditNotes(daySessions);

    let dayEarningsCell = '';
    if (hasRate) {
      const dayEarnings = parseFloat(((netMinutes / 60) * effectiveRate!).toFixed(2));
      monthlyWorkEarnings += dayEarnings;
      dayEarningsCell = `<td class="right">${dayEarnings.toFixed(2)} €</td>`;
    }

    rows.push(`<tr class="${weekendClass}">
      <td>${dateStr}</td>
      <td>${weekday}</td>
      <td class="center">${formatTime(firstStart)}</td>
      <td class="center">${formatTime(lastEnd)}</td>
      <td class="center">${pauseMinutes > 0 ? formatDuration(pauseMinutes) : '–'}</td>
      <td class="center">${formatDuration(netMinutes)}</td>
      <td class="right">${decimalHours}</td>
      ${dayEarningsCell}
      <td class="note">${notiz}</td>
    </tr>`);
  }

  const monthlyDecimal = (monthlyMinutes / 60).toFixed(2);
  const rateInfo = hasRate
    ? `${effectiveRate!.toFixed(2)} €/Std${user.useMinimumWage ? ' (Mindestlohn)' : ''}`
    : '';

  return `
    <div class="page">
      <div class="page-header">
        <div class="employee-name">${user.name}</div>
        <div class="month-label">${monthName(month)} ${year}</div>
        ${rateInfo ? `<div class="rate-info">${rateInfo}</div>` : ''}
      </div>
      <table>
        <thead>
          <tr>
            <th>Datum</th>
            <th>Tag</th>
            <th class="center">Beginn</th>
            <th class="center">Ende</th>
            <th class="center">Pause</th>
            <th class="center">Arbeitszeit</th>
            <th class="right">Dez.</th>
            ${hasRate ? '<th class="right">Verdienst</th>' : ''}
            <th class="note">Notiz</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join('\n')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" class="total-label">Monatssumme</td>
            <td class="center total">${formatDuration(monthlyMinutes)}</td>
            <td class="right total">${monthlyDecimal}</td>
            ${hasRate ? `<td class="right total">${monthlyWorkEarnings.toFixed(2)} €</td>` : ''}
            <td></td>
          </tr>
        </tfoot>
      </table>
      <div class="signature-row">
        <div class="signature-block">
          <div class="signature-line"></div>
          <div class="signature-label">Datum, Unterschrift Mitarbeiter/in</div>
        </div>
        <div class="signature-block">
          <div class="signature-line"></div>
          <div class="signature-label">Datum, Unterschrift Arbeitgeber/in</div>
        </div>
      </div>
    </div>
  `;
}

function calcUserTotals(
  user: User,
  sessions: WorkSession[],
  minimumWage?: number
): { minutes: number; workEarnings: number | null } {
  const effectiveRate = user.useMinimumWage ? minimumWage : user.hourlyRate;
  const hasRate = effectiveRate != null && effectiveRate > 0;
  let minutes = 0;
  let workEarnings = 0;

  const completed = sessions.filter((s) => s.endTime !== null);
  const byDay = new Map<string, WorkSession[]>();
  for (const s of completed) {
    const key = new Date(s.startTime).toLocaleDateString('sv-SE');
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(s);
  }

  for (const daySessions of byDay.values()) {
    daySessions.sort((a, b) => a.startTime - b.startTime);
    const firstStart = daySessions[0].startTime;
    const lastEnd = Math.max(...daySessions.map((s) => s.endTime!));
    let pauseMinutes = daySessions.reduce((sum, s) => sum + s.totalBreakMinutes, 0);
    for (let i = 1; i < daySessions.length; i++) {
      pauseMinutes += Math.max(0, Math.floor((daySessions[i].startTime - daySessions[i - 1].endTime!) / 60000));
    }
    const net = Math.max(0, Math.floor((lastEnd - firstStart) / 60000) - pauseMinutes);
    minutes += net;
    if (hasRate) workEarnings += (net / 60) * effectiveRate!;
  }

  return { minutes, workEarnings: hasRate ? parseFloat(workEarnings.toFixed(2)) : null };
}

function buildSummaryPage(
  users: User[],
  sessionsByUser: Map<string, WorkSession[]>,
  year: number,
  month: number,
  minimumWage?: number,
): string {
  const anyWorkEarnings = users.some((u) => {
    const r = u.useMinimumWage ? minimumWage : u.hourlyRate;
    return r != null && r > 0;
  });

  let totalMinutes = 0;
  let totalEarnings = 0;

  const rows = users.map((user) => {
    const { minutes, workEarnings } = calcUserTotals(user, sessionsByUser.get(user.id) ?? [], minimumWage);
    totalMinutes += minutes;
    if (workEarnings !== null) totalEarnings += workEarnings;

    const earningsCell = anyWorkEarnings
      ? `<td class="right">${workEarnings !== null ? `${workEarnings.toFixed(2)} €` : '–'}</td>`
      : '';

    return `<tr>
      <td>${user.name}</td>
      <td class="center">${formatDuration(minutes)}</td>
      ${earningsCell}
    </tr>`;
  }).join('\n');

  const totalEarningsCell = anyWorkEarnings
    ? `<td class="right total">${totalEarnings.toFixed(2)} €</td>`
    : '';

  return `
    <div class="page">
      <div class="page-header">
        <div class="employee-name">Monatsübersicht</div>
        <div class="month-label">${monthName(month)} ${year}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Mitarbeiter</th>
            <th class="center">Arbeitszeit</th>
            ${anyWorkEarnings ? '<th class="right">Gesamtverdienst</th>' : ''}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td class="total-label">Gesamt</td>
            <td class="center total">${formatDuration(totalMinutes)}</td>
            ${totalEarningsCell}
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

export function generateAndPrintPdf(
  win: Window,
  sessions: WorkSession[],
  users: User[],
  year: number,
  month: number,
  minimumWage?: number,
): void {
  const sessionsByUser = new Map<string, WorkSession[]>();
  for (const user of users) sessionsByUser.set(user.id, []);
  for (const s of sessions) {
    if (sessionsByUser.has(s.userId)) sessionsByUser.get(s.userId)!.push(s);
  }

  const summaryPage = buildSummaryPage(users, sessionsByUser, year, month, minimumWage);
  const pages = users
    .map((user) => buildUserPage(user, sessionsByUser.get(user.id) ?? [], year, month, minimumWage))
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Arbeitszeiten ${monthName(month)} ${year}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 9pt; color: #111; }

    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 14mm 14mm 12mm;
      page-break-after: always;
      display: flex;
      flex-direction: column;
    }
    .page:last-child { page-break-after: avoid; }

    .page-header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 10px;
      border-bottom: 2px solid #111;
      padding-bottom: 6px;
    }
    .employee-name { font-size: 15pt; font-weight: bold; }
    .month-label { font-size: 11pt; color: #444; }
    .rate-info { font-size: 9pt; color: #555; margin-left: auto; }

    table {
      width: 100%;
      border-collapse: collapse;
      flex: 1;
    }
    th {
      background: #f0f0f0;
      border: 1px solid #ccc;
      padding: 4px 5px;
      font-size: 8pt;
      font-weight: bold;
      white-space: nowrap;
    }
    td {
      border: 1px solid #ddd;
      padding: 3px 5px;
      font-size: 8pt;
      white-space: nowrap;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .note { white-space: normal; font-size: 7.5pt; color: #555; max-width: 60px; }

    tr.saturday td { background: #f8f8f8; }
    tr.sunday td { background: #f0f0f0; color: #888; }

    tfoot td {
      border-top: 2px solid #999;
      font-weight: bold;
      background: #fafafa;
    }
    .total-label { text-align: right; color: #333; }
    .total { color: #111; }

    .signature-row {
      display: flex;
      gap: 20mm;
      margin-top: 14mm;
    }
    .signature-block { flex: 1; }
    .signature-line {
      border-bottom: 1px solid #333;
      height: 12mm;
      margin-bottom: 4px;
    }
    .signature-label { font-size: 7.5pt; color: #555; }

    @media print {
      body { margin: 0; }
      .page { padding: 10mm 12mm; }
    }
  </style>
</head>
<body>
  ${summaryPage}
  ${pages}
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.print(); }, 600);
}
