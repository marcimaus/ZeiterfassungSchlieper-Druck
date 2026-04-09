import type { WorkSession, BreakPeriod, ValidationResult } from './types';

function ok(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

function merge(a: ValidationResult, b: ValidationResult): ValidationResult {
  return {
    valid: a.valid && b.valid,
    errors: [...a.errors, ...b.errors],
    warnings: [...a.warnings, ...b.warnings],
  };
}

/** Returns true if intervals [aStart,aEnd] and [bStart,bEnd] overlap. null = Infinity */
function overlaps(
  aStart: number,
  aEnd: number | null,
  bStart: number,
  bEnd: number | null
): boolean {
  const aE = aEnd ?? Infinity;
  const bE = bEnd ?? Infinity;
  return aStart < bE && aE > bStart;
}

/** Validates a new or updated session (startTime / endTime). */
export function validateSessionTimes(
  startTime: number,
  endTime: number | null,
  userId: string,
  existingSessions: WorkSession[],
  excludeSessionId?: string
): ValidationResult {
  const result = ok();
  const now = Date.now();

  if (startTime > now + 60_000) {
    result.errors.push('Startzeit liegt in der Zukunft.');
    result.valid = false;
  }

  if (endTime !== null) {
    if (endTime > now + 60_000) {
      result.errors.push('Endzeit liegt in der Zukunft.');
      result.valid = false;
    }
    if (endTime <= startTime) {
      result.errors.push('Endzeit liegt vor oder gleich der Startzeit.');
      result.valid = false;
    }
    if (endTime - startTime > 43_200_000) {
      result.warnings.push('Schicht länger als 12 Stunden.');
    }
  }

  // Check for overlaps with other sessions of the same user
  const others = existingSessions.filter(
    (s) => s.userId === userId && s.id !== excludeSessionId
  );
  for (const other of others) {
    if (overlaps(startTime, endTime, other.startTime, other.endTime)) {
      result.errors.push(
        `Überschneidung mit bestehender Schicht am ${new Date(other.startTime).toLocaleDateString('de-DE')}.`
      );
      result.valid = false;
      break;
    }
  }

  return result;
}

/** Validates a single break period within a session. */
export function validateBreakPeriod(
  bp: Omit<BreakPeriod, 'id' | 'source'>,
  session: WorkSession,
  excludeBreakId?: string
): ValidationResult {
  const result = ok();
  const now = Date.now();

  if (bp.startTime > now + 60_000) {
    result.errors.push('Pausenbeginn liegt in der Zukunft.');
    result.valid = false;
  }

  if (bp.startTime < session.startTime) {
    result.errors.push('Pause beginnt vor Schichtbeginn.');
    result.valid = false;
  }

  if (session.endTime !== null && bp.startTime > session.endTime) {
    result.errors.push('Pause beginnt nach Schichtende.');
    result.valid = false;
  }

  if (bp.endTime !== null) {
    if (bp.endTime > now + 60_000) {
      result.errors.push('Pausenende liegt in der Zukunft.');
      result.valid = false;
    }
    if (bp.endTime <= bp.startTime) {
      result.errors.push('Pausenende liegt vor oder gleich Pausenbeginn.');
      result.valid = false;
    }
    if (session.endTime !== null && bp.endTime > session.endTime) {
      result.errors.push('Pause endet nach Schichtende.');
      result.valid = false;
    }
  }

  // Check overlap with other breaks in the same session
  const others = session.breaks.filter((b) => b.id !== excludeBreakId);
  for (const other of others) {
    if (overlaps(bp.startTime, bp.endTime, other.startTime, other.endTime)) {
      result.errors.push('Pausenzeiten überschneiden sich.');
      result.valid = false;
      break;
    }
  }

  return merge(result, ok());
}

export { merge as mergeValidation };
