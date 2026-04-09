export type EntrySource = 'nfc' | 'manual';
export type SessionStatus = 'active' | 'on_break' | 'completed';

export interface BreakPeriod {
  id: string;
  startTime: number;
  endTime: number | null;
  source: EntrySource;
}

export interface CorrectionEntry {
  id: string;
  timestamp: number;
  adminName: string;
  field:
    | 'startTime'
    | 'endTime'
    | 'break_add'
    | 'break_edit'
    | 'break_remove'
    | 'session_add'
    | 'session_delete';
  oldValue: string | null;
  newValue: string | null;
  note: string;
}

export interface WorkSession {
  id: string;
  userId: string;
  startTime: number;
  endTime: number | null;
  source: EntrySource;
  status: SessionStatus;
  breaks: BreakPeriod[];
  totalBreakMinutes: number;
  correctionLog: CorrectionEntry[];
  createdAt: number;
  updatedAt: number;
  autoClosedAtMidnight?: boolean; // set when session was auto-closed at 00:00
}

export interface User {
  id: string;
  name: string;
  nfcUid: string;
  createdAt: number;
  isActive: boolean;
  passwordHash?: string;    // optional – if set, user must enter password to view own data
  hourlyRate?: number;      // optional – only visible in admin mode
  useMinimumWage?: boolean; // if true, hourlyRate is ignored; effective rate = AdminConfig.minimumWage
  birthDate?: string;       // "YYYY-MM-DD" – required when useMinimumWage is false and hourlyRate is set
}

export interface AdminConfig {
  pinHash: string;
  businessName: string;
  lastExportAt: number | null;
  reportEmail?: string;
  reportTime?: string;
  minimumWage?: number;
}

export type ScanResult =
  | { type: 'clockedIn'; user: User; session: WorkSession }
  | { type: 'clockedOut'; user: User; session: WorkSession; netMinutes: number }
  | { type: 'breakStarted'; user: User; session: WorkSession }
  | { type: 'breakEnded'; user: User; session: WorkSession }
  | { type: 'userNotFound'; uid: string }
  | { type: 'needsChoice'; user: User; session: WorkSession }
  | { type: 'forgotToClockOut'; user: User; missedSession: WorkSession; newSession: WorkSession };

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AdminInfo {
  name: string;
}
