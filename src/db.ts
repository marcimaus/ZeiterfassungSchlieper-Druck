import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
} from 'firebase/firestore';
import type { Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type {
  User,
  WorkSession,
  AdminConfig,
  EntrySource,
  BreakPeriod,
  CorrectionEntry,
  AdminInfo,
} from './types';


// ── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function calcTotalBreakMinutes(breaks: BreakPeriod[]): number {
  return breaks.reduce((sum, b) => {
    if (b.endTime === null) return sum;
    return sum + Math.floor((b.endTime - b.startTime) / 60000);
  }, 0);
}

function makeCorrectionEntry(
  field: CorrectionEntry['field'],
  oldValue: string | null,
  newValue: string | null,
  note: string,
  adminInfo: AdminInfo
): CorrectionEntry {
  return {
    id: uuid(),
    timestamp: Date.now(),
    adminName: adminInfo.name,
    field,
    oldValue,
    newValue,
    note,
  };
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<User[]> {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => d.data() as User);
}

export async function addUser(name: string, nfcUid: string): Promise<User> {
  const user: User = {
    id: uuid(),
    name,
    nfcUid: nfcUid.toUpperCase(),
    createdAt: Date.now(),
    isActive: true,
  };
  await setDoc(doc(db, 'users', user.id), user);
  return user;
}

export async function updateUser(
  userId: string,
  changes: Partial<Pick<User, 'name' | 'nfcUid' | 'isActive' | 'hourlyRate' | 'useMinimumWage' | 'birthDate' | 'cakeRatePerCake' | 'useDefaultCakeRate'>> & { clearHourlyRate?: boolean; clearBirthDate?: boolean; clearCakeRate?: boolean; clearUseDefaultCakeRate?: boolean }
): Promise<void> {
  const { clearHourlyRate, clearBirthDate, clearCakeRate, clearUseDefaultCakeRate, ...rest } = changes;
  await updateDoc(doc(db, 'users', userId), {
    ...rest,
    ...(clearHourlyRate ? { hourlyRate: deleteField() } : {}),
    ...(clearBirthDate ? { birthDate: deleteField() } : {}),
    ...(clearCakeRate ? { cakeRatePerCake: deleteField() } : {}),
    ...(clearUseDefaultCakeRate ? { useDefaultCakeRate: deleteField() } : {}),
  });
}

/** Soft-delete: sets isActive = false. Historical sessions remain intact. */
export async function deactivateUser(userId: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId), { isActive: false });
}

export async function reactivateUser(userId: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId), { isActive: true });
}

export async function deleteUser(userId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', userId));
}

export async function getUserById(id: string): Promise<User | undefined> {
  const snap = await getDoc(doc(db, 'users', id));
  if (!snap.exists()) return undefined;
  const user = snap.data() as User;
  if (!user.isActive) return undefined;
  return user;
}

export async function getUserByNfcUid(uid: string): Promise<User | undefined> {
  const q = query(
    collection(db, 'users'),
    where('nfcUid', '==', uid.toUpperCase()),
    where('isActive', '==', true)
  );
  const snap = await getDocs(q);
  if (snap.empty) return undefined;
  return snap.docs[0].data() as User;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function getActiveSession(userId: string): Promise<WorkSession | undefined> {
  const q = query(
    collection(db, 'sessions'),
    where('userId', '==', userId),
    where('status', 'in', ['active', 'on_break'])
  );
  const snap = await getDocs(q);
  if (snap.empty) return undefined;
  return snap.docs[0].data() as WorkSession;
}

export async function getSessionsForUserAndMonth(
  userId: string,
  year: number,
  month: number
): Promise<WorkSession[]> {
  const from = new Date(year, month, 1).getTime();
  const to = new Date(year, month + 1, 1).getTime();
  const q = query(
    collection(db, 'sessions'),
    where('userId', '==', userId),
    where('startTime', '>=', from),
    where('startTime', '<', to)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as WorkSession)
    .sort((a, b) => b.startTime - a.startTime);
}

export async function getAllSessionsForMonth(
  year: number,
  month: number
): Promise<WorkSession[]> {
  const from = new Date(year, month, 1).getTime();
  const to = new Date(year, month + 1, 1).getTime();
  const q = query(
    collection(db, 'sessions'),
    where('startTime', '>=', from),
    where('startTime', '<', to)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as WorkSession);
}

export async function startSession(userId: string, source: EntrySource): Promise<WorkSession> {
  const now = Date.now();
  const session: WorkSession = {
    id: uuid(),
    userId,
    startTime: now,
    endTime: null,
    source,
    status: 'active',
    breaks: [],
    totalBreakMinutes: 0,
    correctionLog: [],
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'sessions', session.id), session);
  return session;
}

export async function stopSession(
  sessionId: string,
  adminInfo?: AdminInfo
): Promise<WorkSession> {
  const ref = doc(db, 'sessions', sessionId);
  const snap = await getDoc(ref);
  const session = snap.data() as WorkSession;

  const now = Date.now();
  const changes: Partial<WorkSession> = {
    endTime: now,
    status: 'completed',
    updatedAt: now,
  };

  // Auto-close any open break
  let breaks = session.breaks;
  const openBreakIdx = breaks.findIndex((b) => b.endTime === null);
  if (openBreakIdx !== -1) {
    breaks = breaks.map((b, i) =>
      i === openBreakIdx ? { ...b, endTime: now } : b
    );
    changes.breaks = breaks;
    changes.totalBreakMinutes = calcTotalBreakMinutes(breaks);
    if (adminInfo) {
      changes.correctionLog = [
        ...session.correctionLog,
        makeCorrectionEntry(
          'break_edit',
          null,
          new Date(now).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
          'Automatisch geschlossen beim Ausstempeln',
          adminInfo
        ),
      ];
    }
  }

  await updateDoc(ref, changes);
  return { ...session, ...changes };
}

export async function startBreak(
  sessionId: string,
  source: EntrySource
): Promise<WorkSession> {
  const ref = doc(db, 'sessions', sessionId);
  const snap = await getDoc(ref);
  const session = snap.data() as WorkSession;
  const now = Date.now();

  const newBreak: BreakPeriod = {
    id: uuid(),
    startTime: now,
    endTime: null,
    source,
  };

  const breaks = [...session.breaks, newBreak];
  const changes = {
    breaks,
    status: 'on_break' as const,
    updatedAt: now,
  };
  await updateDoc(ref, changes);
  return { ...session, ...changes };
}

export async function endBreak(
  sessionId: string,
  source: EntrySource,
  customEndTime?: number
): Promise<WorkSession> {
  const ref = doc(db, 'sessions', sessionId);
  const snap = await getDoc(ref);
  const session = snap.data() as WorkSession;
  const endAt = customEndTime ?? Date.now();

  const breaks = session.breaks.map((b) =>
    b.endTime === null ? { ...b, endTime: endAt, source } : b
  );
  const totalBreakMinutes = calcTotalBreakMinutes(breaks);
  const changes = {
    breaks,
    totalBreakMinutes,
    status: 'active' as const,
    updatedAt: endAt,
  };
  await updateDoc(ref, changes);
  return { ...session, ...changes };
}

export async function addManualSession(
  userId: string,
  startTime: number,
  endTime: number | null,
  breaks: Omit<BreakPeriod, 'id'>[],
  adminInfo: AdminInfo,
  note: string
): Promise<WorkSession> {
  const now = Date.now();
  const fullBreaks: BreakPeriod[] = breaks.map((b) => ({ ...b, id: uuid() }));
  const session: WorkSession = {
    id: uuid(),
    userId,
    startTime,
    endTime,
    source: 'manual',
    status: endTime ? 'completed' : 'active',
    breaks: fullBreaks,
    totalBreakMinutes: calcTotalBreakMinutes(fullBreaks),
    correctionLog: [
      makeCorrectionEntry('session_add', null, new Date(startTime).toLocaleString('de-DE'), note, adminInfo),
    ],
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'sessions', session.id), session);
  return session;
}

export async function updateSession(
  sessionId: string,
  changes: { startTime?: number; endTime?: number | null; breaks?: BreakPeriod[] },
  adminInfo: AdminInfo,
  note: string
): Promise<WorkSession> {
  const ref = doc(db, 'sessions', sessionId);
  const snap = await getDoc(ref);
  const session = snap.data() as WorkSession;
  const now = Date.now();

  const correctionEntries: CorrectionEntry[] = [];

  if (changes.startTime !== undefined && changes.startTime !== session.startTime) {
    correctionEntries.push(
      makeCorrectionEntry(
        'startTime',
        new Date(session.startTime).toLocaleString('de-DE'),
        new Date(changes.startTime).toLocaleString('de-DE'),
        note,
        adminInfo
      )
    );
  }

  if (changes.endTime !== undefined && changes.endTime !== session.endTime) {
    correctionEntries.push(
      makeCorrectionEntry(
        'endTime',
        session.endTime ? new Date(session.endTime).toLocaleString('de-DE') : null,
        changes.endTime ? new Date(changes.endTime).toLocaleString('de-DE') : null,
        note,
        adminInfo
      )
    );
  }

  const breaks = changes.breaks ?? session.breaks;
  const totalBreakMinutes = calcTotalBreakMinutes(breaks);

  // Log break changes
  if (changes.breaks !== undefined) {
    const oldBreaks = session.breaks;
    const newBreaks = changes.breaks;

    // Added breaks
    for (const nb of newBreaks) {
      const existed = oldBreaks.find((ob) => ob.id === nb.id);
      if (!existed) {
        const mins = nb.endTime ? Math.floor((nb.endTime - nb.startTime) / 60000) : null;
        correctionEntries.push(
          makeCorrectionEntry(
            'break_add',
            null,
            mins !== null ? `${mins} Min. Pause` : 'Pause (offen)',
            note,
            adminInfo
          )
        );
      }
    }

    // Removed breaks
    for (const ob of oldBreaks) {
      const stillExists = newBreaks.find((nb) => nb.id === ob.id);
      if (!stillExists) {
        const mins = ob.endTime ? Math.floor((ob.endTime - ob.startTime) / 60000) : null;
        correctionEntries.push(
          makeCorrectionEntry(
            'break_remove',
            mins !== null ? `${mins} Min. Pause` : 'Pause (offen)',
            null,
            note,
            adminInfo
          )
        );
      }
    }
  }

  const updated: Partial<WorkSession> = {
    ...changes,
    breaks,
    totalBreakMinutes,
    source: 'manual',
    correctionLog: [...session.correctionLog, ...correctionEntries],
    updatedAt: now,
  };

  if (changes.endTime !== undefined) {
    updated.status = changes.endTime ? 'completed' : 'active';
  }

  await updateDoc(ref, updated);
  return { ...session, ...updated };
}

export async function deleteSession(sessionId: string, adminInfo: AdminInfo, note: string): Promise<void> {
  // We keep a log by just adding a correction entry before deletion is not feasible
  // in pure Firestore without a separate audit log collection.
  // For MVP: log deletion in a top-level audit collection.
  const ref = doc(db, 'sessions', sessionId);
  const snap = await getDoc(ref);
  const session = snap.data() as WorkSession;

  await addDoc(collection(db, 'audit'), {
    type: 'session_deleted',
    sessionId,
    userId: session.userId,
    startTime: session.startTime,
    adminName: adminInfo.name,
    note,
    timestamp: Date.now(),
  });

  await deleteDoc(ref);
}

// ── Auto-close sessions at midnight ──────────────────────────────────────────

/** Returns midnight (00:00:00.000) of the day a timestamp falls on */
function midnightOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Today's midnight timestamp */
function todayMidnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Checks all active sessions. Any session that started before today's midnight
 * gets auto-closed at the midnight of the day it started (23:59:59 of that day).
 * Sets autoClosedAtMidnight = true on the document.
 * Returns the list of sessions that were auto-closed.
 */
export async function autoCloseOldActiveSessions(): Promise<WorkSession[]> {
  const today = todayMidnight();
  const snap = await getDocs(
    query(collection(db, 'sessions'), where('status', 'in', ['active', 'on_break']))
  );

  const closed: WorkSession[] = [];

  for (const d of snap.docs) {
    const session = d.data() as WorkSession;
    const sessionMidnight = midnightOf(session.startTime);

    if (sessionMidnight < today) {
      // Close at 23:59:59 of the day the session started
      const closeAt = sessionMidnight + 24 * 60 * 60 * 1000 - 1000;

      // Close any open break at same time
      const breaks = session.breaks.map((b) =>
        b.endTime === null ? { ...b, endTime: closeAt } : b
      );
      const totalBreakMinutes = breaks.reduce((sum, b) => {
        if (!b.endTime) return sum;
        return sum + Math.floor((b.endTime - b.startTime) / 60000);
      }, 0);

      const updated: Partial<WorkSession> = {
        endTime: closeAt,
        status: 'completed',
        breaks,
        totalBreakMinutes,
        autoClosedAtMidnight: true,
        updatedAt: Date.now(),
      };

      await updateDoc(doc(db, 'sessions', session.id), updated);
      closed.push({ ...session, ...updated });
    }
  }

  return closed;
}

/**
 * Corrects the end time of an auto-closed session and marks it as acknowledged
 * (sets autoClosedAtMidnight = false so it won't be shown again).
 */
export async function acknowledgeAutoClosedSession(
  sessionId: string,
  correctedEndTime: number
): Promise<void> {
  const ref = doc(db, 'sessions', sessionId);
  const snap = await getDoc(ref);
  const session = snap.data() as WorkSession;

  // Also recalculate breaks that were auto-closed at midnight
  const breaks = session.breaks.map((b) => {
    if (b.endTime === null) return { ...b, endTime: correctedEndTime };
    // If break was extended to midnight, cap it to correctedEndTime
    if (b.endTime > correctedEndTime) return { ...b, endTime: correctedEndTime };
    return b;
  });
  const totalBreakMinutes = calcTotalBreakMinutes(breaks);

  await updateDoc(ref, {
    endTime: correctedEndTime,
    breaks,
    totalBreakMinutes,
    autoClosedAtMidnight: false,
    updatedAt: Date.now(),
  });
}

/**
 * Returns the most recent auto-closed-at-midnight session for a user,
 * but only if it hasn't been acknowledged yet (endTime is still the midnight value).
 * Used to prompt the user to correct their forgotten clock-out.
 */
export async function getLastAutoClosedSession(userId: string): Promise<WorkSession | null> {
  const snap = await getDocs(
    query(
      collection(db, 'sessions'),
      where('userId', '==', userId),
      where('autoClosedAtMidnight', '==', true),
      orderBy('startTime', 'desc'),
      limit(1)
    )
  );
  if (snap.empty) return null;
  return snap.docs[0].data() as WorkSession;
}

// ── User Password ─────────────────────────────────────────────────────────────

export async function setUserPassword(userId: string, passwordHash: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId), { passwordHash });
}

export async function removeUserPassword(userId: string): Promise<void> {
  const { deleteField } = await import('firebase/firestore');
  await updateDoc(doc(db, 'users', userId), { passwordHash: deleteField() });
}

// ── Admin Config ──────────────────────────────────────────────────────────────

export async function getAdminConfig(): Promise<AdminConfig | null> {
  const snap = await getDoc(doc(db, 'meta', 'config'));
  if (!snap.exists()) return null;
  return snap.data() as AdminConfig;
}

export async function setAdminConfig(config: Partial<AdminConfig>): Promise<void> {
  const ref = doc(db, 'meta', 'config');
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { ...config });
  } else {
    await setDoc(ref, {
      pinHash: '',
      businessName: 'Mein Betrieb',
      lastExportAt: null,
      ...config,
    });
  }
}

// ── Real-time listeners ───────────────────────────────────────────────────────

export function subscribeToUsers(cb: (users: User[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'users'),
    (snap) => cb(snap.docs.map((d) => d.data() as User))
  );
}

export function subscribeToActiveSessions(cb: (sessions: WorkSession[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'sessions'), where('status', 'in', ['active', 'on_break'])),
    (snap) => cb(snap.docs.map((d) => d.data() as WorkSession))
  );
}

// ── localStorage Migration (one-time) ────────────────────────────────────────

interface LegacyUser {
  id: number;
  name: string;
  nfcUid: string;
  createdAt: number;
}

interface LegacySession {
  id: number;
  userId: number;
  startTime: number;
  endTime: number | null;
  breakMinutes: number;
}

export async function migrateFromLocalStorage(): Promise<void> {
  if (localStorage.getItem('zeit_migrated')) return;

  const rawUsers = localStorage.getItem('zeit_users');
  const rawSessions = localStorage.getItem('zeit_sessions');
  if (!rawUsers && !rawSessions) {
    localStorage.setItem('zeit_migrated', '1');
    return;
  }

  try {
    const legacyUsers: LegacyUser[] = rawUsers ? JSON.parse(rawUsers) : [];
    const legacySessions: LegacySession[] = rawSessions ? JSON.parse(rawSessions) : [];

    // Map old numeric IDs to string IDs
    const userIdMap = new Map<number, string>();

    for (const lu of legacyUsers) {
      const id = String(lu.id);
      userIdMap.set(lu.id, id);
      const user: User = {
        id,
        name: lu.name,
        nfcUid: lu.nfcUid.toUpperCase(),
        createdAt: lu.createdAt,
        isActive: true,
      };
      await setDoc(doc(db, 'users', id), user);
    }

    for (const ls of legacySessions) {
      const id = String(ls.id);
      const userId = userIdMap.get(ls.userId) ?? String(ls.userId);
      const now = Date.now();
      const session: WorkSession = {
        id,
        userId,
        startTime: ls.startTime,
        endTime: ls.endTime,
        source: 'nfc',
        status: ls.endTime ? 'completed' : 'active',
        breaks: ls.breakMinutes > 0
          ? [{
              id: uuid(),
              startTime: ls.startTime,
              endTime: ls.startTime + ls.breakMinutes * 60000,
              source: 'manual' as EntrySource,
            }]
          : [],
        totalBreakMinutes: ls.breakMinutes,
        correctionLog: [],
        createdAt: ls.startTime,
        updatedAt: now,
      };
      await setDoc(doc(db, 'sessions', id), session);
    }

    localStorage.setItem('zeit_migrated', '1');
    console.log(`Migration: ${legacyUsers.length} Mitarbeiter, ${legacySessions.length} Sitzungen übertragen.`);
  } catch (err) {
    console.error('Migration fehlgeschlagen:', err);
  }
}
