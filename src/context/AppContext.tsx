import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { User, WorkSession, ScanResult, EntrySource, AdminInfo, BreakPeriod } from '../types';
import * as db from '../db';
import { verifyPin, hashPin } from '../auth';

// ── State ─────────────────────────────────────────────────────────────────────

interface AppState {
  users: User[];
  activeSessions: WorkSession[];
  isAdminMode: boolean;
  isOnline: boolean;
  adminName: string;
  sessionsUpdatedAt: number;
  minimumWage: number | null;
  defaultCakeRate: number | null;
}

type Action =
  | { type: 'SET_USERS'; users: User[] }
  | { type: 'SET_ACTIVE_SESSIONS'; sessions: WorkSession[] }
  | { type: 'SET_ADMIN'; name: string }
  | { type: 'LOGOUT_ADMIN' }
  | { type: 'SET_ONLINE'; online: boolean }
  | { type: 'SESSION_UPDATED' }
  | { type: 'SET_MINIMUM_WAGE'; minimumWage: number | null }
  | { type: 'SET_DEFAULT_CAKE_RATE'; defaultCakeRate: number | null };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_USERS':
      return { ...state, users: action.users };
    case 'SET_ACTIVE_SESSIONS':
      return { ...state, activeSessions: action.sessions };
    case 'SET_ADMIN':
      return { ...state, isAdminMode: true, adminName: action.name };
    case 'LOGOUT_ADMIN':
      return { ...state, isAdminMode: false, adminName: '' };
    case 'SET_ONLINE':
      return { ...state, isOnline: action.online };
    case 'SESSION_UPDATED':
      return { ...state, sessionsUpdatedAt: Date.now() };
    case 'SET_MINIMUM_WAGE':
      return { ...state, minimumWage: action.minimumWage };
    case 'SET_DEFAULT_CAKE_RATE':
      return { ...state, defaultCakeRate: action.defaultCakeRate };
    default:
      return state;
  }
}

const initialState: AppState = {
  users: [],
  activeSessions: [],
  isAdminMode: false,
  isOnline: navigator.onLine,
  adminName: '',
  sessionsUpdatedAt: 0,
  minimumWage: null,
  defaultCakeRate: null,
};

// ── Context ───────────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  processNfcScan: (uid: string) => Promise<ScanResult>;
  clockIn: (userId: string, source?: EntrySource) => Promise<WorkSession>;
  clockOut: (sessionId: string) => Promise<WorkSession>;
  startBreak: (sessionId: string, source?: EntrySource) => Promise<WorkSession>;
  endBreak: (sessionId: string, source?: EntrySource, customEndTime?: number) => Promise<WorkSession>;
  addUser: (name: string, nfcUid: string) => Promise<User>;
  deactivateUser: (userId: string) => Promise<void>;
  reactivateUser: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  updateUser: (userId: string, changes: Parameters<typeof db.updateUser>[1]) => Promise<void>;
  setUserPassword: (userId: string, password: string) => Promise<void>;
  removeUserPassword: (userId: string) => Promise<void>;
  addManualSession: (userId: string, startTime: number, endTime: number | null, note: string) => Promise<WorkSession>;
  updateSession: (sessionId: string, changes: { startTime?: number; endTime?: number | null; breaks?: BreakPeriod[] }, note: string) => Promise<WorkSession>;
  deleteSession: (sessionId: string, note: string) => Promise<void>;
  loginAdmin: (pin: string) => Promise<boolean>;
  logoutAdmin: () => void;
  getAdminInfo: () => AdminInfo;
  notifyMinimumWageChanged: (wage: number | null) => void;
  addCakeEntry: (userId: string, count: number) => Promise<void>;
  deleteCakeEntry: (entryId: string) => Promise<void>;
  notifyDefaultCakeRateChanged: (rate: number | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    // Restore admin session across hot-reloads (sessionStorage persists tab lifetime)
    isAdminMode: sessionStorage.getItem('admin_mode') === '1',
    adminName: sessionStorage.getItem('admin_name') ?? '',
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // Online/offline tracking
  useEffect(() => {
    const onOnline = () => dispatch({ type: 'SET_ONLINE', online: true });
    const onOffline = () => dispatch({ type: 'SET_ONLINE', online: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Real-time Firestore listeners
  useEffect(() => {
    const unsubUsers = db.subscribeToUsers((users) =>
      dispatch({ type: 'SET_USERS', users })
    );
    const unsubSessions = db.subscribeToActiveSessions((sessions) =>
      dispatch({ type: 'SET_ACTIVE_SESSIONS', sessions })
    );

    // Load minimum wage and default cake rate from AdminConfig
    db.getAdminConfig().then((config) => {
      dispatch({ type: 'SET_MINIMUM_WAGE', minimumWage: config?.minimumWage ?? null });
      dispatch({ type: 'SET_DEFAULT_CAKE_RATE', defaultCakeRate: config?.defaultCakeRate ?? null });
    }).catch(console.error);

    // One-time migration from localStorage
    db.migrateFromLocalStorage().catch(console.error);

    // Auto-close any sessions that were left open past midnight
    db.autoCloseOldActiveSessions().catch(console.error);

    return () => {
      unsubUsers();
      unsubSessions();
    };
  }, []);

  const getAdminInfo = useCallback((): AdminInfo => ({
    name: stateRef.current.adminName || 'Admin',
  }), []);

  const processNfcScan = useCallback(async (uid: string): Promise<ScanResult> => {
    const user = await db.getUserByNfcUid(uid);
    if (!user) return { type: 'userNotFound', uid };

    const active = stateRef.current.activeSessions.find((s) => s.userId === user.id);

    if (!active) {
      // Check if this user has a session that was auto-closed at midnight
      const missedSession = await db.getLastAutoClosedSession(user.id);
      const newSession = await db.startSession(user.id, 'nfc');
      dispatch({ type: 'SESSION_UPDATED' });
      if (missedSession) {
        return { type: 'forgotToClockOut', user, missedSession, newSession };
      }
      return { type: 'clockedIn', user, session: newSession };
    }

    // status === 'active' or 'on_break' → show action sheet
    return { type: 'needsChoice', user, session: active };
  }, []);

  const clockIn = useCallback(async (userId: string, source: EntrySource = 'nfc') => {
    const session = await db.startSession(userId, source);
    dispatch({ type: 'SESSION_UPDATED' });
    return session;
  }, []);

  const clockOut = useCallback(async (sessionId: string) => {
    const session = await db.stopSession(sessionId);
    dispatch({ type: 'SESSION_UPDATED' });
    return session;
  }, []);

  const startBreak = useCallback(async (sessionId: string, source: EntrySource = 'nfc') => {
    const session = await db.startBreak(sessionId, source);
    dispatch({ type: 'SESSION_UPDATED' });
    return session;
  }, []);

  const endBreak = useCallback(async (sessionId: string, source: EntrySource = 'nfc', customEndTime?: number) => {
    const session = await db.endBreak(sessionId, source, customEndTime);
    dispatch({ type: 'SESSION_UPDATED' });
    return session;
  }, []);

  const addUser = useCallback(async (name: string, nfcUid: string) => {
    return db.addUser(name, nfcUid);
  }, []);

  const addManualSession = useCallback(async (
    userId: string,
    startTime: number,
    endTime: number | null,
    note: string
  ) => {
    const adminInfo = { name: stateRef.current.isAdminMode ? (stateRef.current.adminName || 'Admin') : 'Mitarbeiter' };
    const session = await db.addManualSession(userId, startTime, endTime, [], adminInfo, note);
    dispatch({ type: 'SESSION_UPDATED' });
    return session;
  }, []);

  const updateSession = useCallback(async (
    sessionId: string,
    changes: { startTime?: number; endTime?: number | null; breaks?: BreakPeriod[] },
    note: string
  ) => {
    const adminInfo: AdminInfo = {
      name: stateRef.current.isAdminMode
        ? (stateRef.current.adminName || 'Admin')
        : 'Mitarbeiter',
    };
    const session = await db.updateSession(sessionId, changes, adminInfo, note);
    dispatch({ type: 'SESSION_UPDATED' });
    return session;
  }, []);

  const deleteSession = useCallback(async (sessionId: string, note: string) => {
    const adminInfo: AdminInfo = {
      name: stateRef.current.isAdminMode
        ? (stateRef.current.adminName || 'Admin')
        : 'Mitarbeiter',
    };
    await db.deleteSession(sessionId, adminInfo, note);
    dispatch({ type: 'SESSION_UPDATED' });
  }, []);

  const deactivateUser = useCallback(async (userId: string) => {
    return db.deactivateUser(userId);
  }, []);

  const reactivateUser = useCallback(async (userId: string) => {
    return db.reactivateUser(userId);
  }, []);

  const deleteUser = useCallback(async (userId: string) => {
    return db.deleteUser(userId);
  }, []);

  const updateUser = useCallback(async (userId: string, changes: Parameters<typeof db.updateUser>[1]) => {
    return db.updateUser(userId, changes);
  }, []);

  const setUserPassword = useCallback(async (userId: string, password: string) => {
    const hash = await hashPin(password);
    return db.setUserPassword(userId, hash);
  }, []);

  const removeUserPassword = useCallback(async (userId: string) => {
    return db.removeUserPassword(userId);
  }, []);

  const loginAdmin = useCallback(async (pin: string): Promise<boolean> => {
    const config = await db.getAdminConfig();
    if (!config?.pinHash) {
      // First login: no PIN set yet — accept anything (setup flow)
      return false;
    }
    const ok = await verifyPin(pin, config.pinHash);
    if (ok) {
      dispatch({ type: 'SET_ADMIN', name: 'Admin' });
      sessionStorage.setItem('admin_mode', '1');
      sessionStorage.setItem('admin_name', 'Admin');
    }
    return ok;
  }, []);

  const logoutAdmin = useCallback(() => {
    dispatch({ type: 'LOGOUT_ADMIN' });
    sessionStorage.removeItem('admin_mode');
    sessionStorage.removeItem('admin_name');
  }, []);

  const notifyMinimumWageChanged = useCallback((wage: number | null) => {
    dispatch({ type: 'SET_MINIMUM_WAGE', minimumWage: wage });
  }, []);

  const notifyDefaultCakeRateChanged = useCallback((rate: number | null) => {
    dispatch({ type: 'SET_DEFAULT_CAKE_RATE', defaultCakeRate: rate });
  }, []);

  const addCakeEntry = useCallback(async (userId: string, count: number) => {
    const user = stateRef.current.users.find((u) => u.id === userId);
    let ratePerCake = 0;
    if (user?.useDefaultCakeRate) {
      ratePerCake = stateRef.current.defaultCakeRate ?? 0;
    } else if (user?.cakeRatePerCake != null) {
      ratePerCake = user.cakeRatePerCake;
    }
    await db.addCakeEntry(userId, count, ratePerCake);
  }, []);

  const deleteCakeEntry = useCallback(async (entryId: string) => {
    await db.deleteCakeEntry(entryId);
  }, []);

  return (
    <AppContext.Provider
      value={{
        state,
        processNfcScan,
        clockIn,
        clockOut,
        startBreak,
        endBreak,
        addUser,
        deactivateUser,
        reactivateUser,
        deleteUser,
        updateUser,
        addManualSession,
        updateSession,
        deleteSession,
        setUserPassword,
        removeUserPassword,
        loginAdmin,
        logoutAdmin,
        getAdminInfo,
        notifyMinimumWageChanged,
        addCakeEntry,
        deleteCakeEntry,
        notifyDefaultCakeRateChanged,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
