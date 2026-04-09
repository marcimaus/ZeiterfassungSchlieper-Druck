import type { WorkSession, User } from './types';

export function getAge(birthDate: string): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

/** Returns true if this employee's manually set rate is below the minimum wage (adult check). */
export function hasWageConflict(user: User, minimumWage: number | null): boolean {
  if (!minimumWage || user.useMinimumWage) return false;
  if (!user.hourlyRate) return false;
  const age = user.birthDate ? getAge(user.birthDate) : null;
  if (age !== null && age < 18) return false; // under 18 is allowed to be below minimum
  return user.hourlyRate < minimumWage;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} Min.`;
  if (m === 0) return `${h} Std.`;
  return `${h} Std. ${m} Min.`;
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatMonth(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
  });
}

export function netDurationMinutes(
  startTime: number,
  endTime: number,
  totalBreakMinutes: number
): number {
  return Math.max(0, Math.floor((endTime - startTime) / 60000) - totalBreakMinutes);
}

export function elapsedMinutes(startTime: number): number {
  return Math.floor((Date.now() - startTime) / 60000);
}

/** Formats a timestamp to a datetime-local input value (YYYY-MM-DDTHH:MM) */
export function toDatetimeLocal(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses a datetime-local input value back to a Unix timestamp */
export function fromDatetimeLocal(val: string): number {
  return new Date(val).getTime();
}

/** Returns the max datetime-local string (current moment, 1-minute tolerance) */
export function nowDatetimeLocal(): string {
  return toDatetimeLocal(Date.now());
}

/** Generates a structured CSV: one section per employee, all calendar days of the month listed */
export function generateCsv(sessions: WorkSession[], users: User[], year: number, month: number): string {
  const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const pad = (n: number) => String(n).padStart(2, '0');
  const cell = (v: string | number) => `"${v}"`;
  const row = (cols: (string | number)[]) => cols.map(cell).join(';');

  // All calendar days of the selected month as YYYY-MM-DD strings
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const allDays: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    allDays.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  }

  const lines: string[] = [];

  // Build per-user session map
  const sessionsByUser = new Map<string, WorkSession[]>();
  for (const user of users) sessionsByUser.set(user.id, []);
  for (const s of sessions) {
    if (sessionsByUser.has(s.userId)) sessionsByUser.get(s.userId)!.push(s);
  }

  let firstUser = true;

  for (const user of users) {
    const userSessions = (sessionsByUser.get(user.id) ?? [])
      .filter((s) => s.endTime !== null)
      .sort((a, b) => a.startTime - b.startTime);

    if (!firstUser) lines.push(''); // blank line between employees
    firstUser = false;

    // Employee heading
    lines.push(cell(`Mitarbeiter: ${user.name}`));

    // Column headers
    lines.push(row(['Datum', 'Wochentag', 'Arbeitsbeginn', 'Arbeitsende', 'Pause', 'Arbeitszeit gesamt', 'Zeit in Dezimal']));

    // Group sessions by calendar day
    const byDay = new Map<string, WorkSession[]>();
    for (const s of userSessions) {
      const key = new Date(s.startTime).toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(s);
    }

    let monthlyTotalMinutes = 0;

    for (const dayKey of allDays) {
      const date = new Date(`${dayKey}T12:00:00`);
      const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const weekday = WEEKDAYS[date.getDay()];

      const daySessions = byDay.get(dayKey);

      if (!daySessions || daySessions.length === 0) {
        // Day without work — show date and weekday, leave rest empty
        lines.push(row([dateStr, weekday, '', '', '', '', '']));
        continue;
      }

      daySessions.sort((a, b) => a.startTime - b.startTime);

      const firstStart = daySessions[0].startTime;
      const lastEnd = Math.max(...daySessions.map((s) => s.endTime!));

      // Pause = session break minutes + gaps between consecutive sessions
      let pauseMinutes = daySessions.reduce((sum, s) => sum + s.totalBreakMinutes, 0);
      for (let i = 1; i < daySessions.length; i++) {
        const gap = Math.floor((daySessions[i].startTime - daySessions[i - 1].endTime!) / 60000);
        if (gap > 0) pauseMinutes += gap;
      }

      const netMinutes = Math.max(0, Math.floor((lastEnd - firstStart) / 60000) - pauseMinutes);
      monthlyTotalMinutes += netMinutes;

      const decimalHours = (netMinutes / 60).toFixed(2).replace('.', ',');

      lines.push(row([
        dateStr,
        weekday,
        formatTime(firstStart),
        formatTime(lastEnd),
        pauseMinutes > 0 ? formatDuration(pauseMinutes) : '-',
        formatDuration(netMinutes),
        decimalHours,
      ]));
    }

    // Monthly total row
    const monthlyDecimal = (monthlyTotalMinutes / 60).toFixed(2).replace('.', ',');
    lines.push(row(['', '', '', '', 'Monatssumme:', formatDuration(monthlyTotalMinutes), monthlyDecimal]));
  }

  return lines.join('\n');
}

export function downloadCsv(content: string, filename: string): void {
  const bom = '\uFEFF'; // UTF-8 BOM for Excel
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
