import { describe, expect, it } from 'vitest';
import { assertCopyStatus, isRestoreWindowOpen, isStrictlyEditable, nextCopyNumber, normalizeMoodTags, validatePageRange, validateStatusTransition } from './domain.js';
import { AppError } from './errors.js';

describe('domain rules', () => {
  it('allows declared status transitions', () => {
    expect(() => validateStatusTransition('READING', 'READ')).not.toThrow();
    expect(() => validateStatusTransition('READ', 'READING')).not.toThrow();
  });

  it('rejects illegal status transitions', () => {
    expect(() => validateStatusTransition('TO_READ', 'READ')).toThrow(AppError);
    expect(() => validateStatusTransition('ABANDONED', 'READING')).toThrow(AppError);
  });

  it('validates page ranges and page count', () => {
    expect(() => validatePageRange(42, 44, 300)).not.toThrow();
    expect(() => validatePageRange(44, 42, 300)).toThrow(AppError);
    expect(() => validatePageRange(42, 301, 300)).toThrow(AppError);
  });

  it('normalizes mood tags and rejects empty or duplicate overrun', () => {
    expect(normalizeMoodTags(['MOVED', 'MOVED', 'CALM'])).toEqual(['MOVED', 'CALM']);
    expect(() => normalizeMoodTags([])).toThrow(AppError);
  });

  it('enforces restore and edit windows', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    expect(isRestoreWindowOpen(new Date('2026-09-24T00:00:00.000Z'), now)).toBe(true);
    expect(isRestoreWindowOpen(new Date('2026-09-22T00:00:00.000Z'), now)).toBe(false);
    expect(isStrictlyEditable(new Date('2026-09-25T00:00:00.000Z'), now)).toBe(true);
    expect(isStrictlyEditable(new Date('2026-09-23T00:00:00.000Z'), now)).toBe(false);
  });

  it('numbers copies from the maximum existing number including soft-deleted ones', () => {
    expect(nextCopyNumber([])).toBe(1);
    expect(nextCopyNumber([1, 2, 3])).toBe(4);
    expect(nextCopyNumber([1, 3])).toBe(4);
    // Deleting copy #2 and registering a new one must never reuse #2, so a
    // later restore cannot clash.
    expect(nextCopyNumber([1, 2, 3, 4])).toBe(5);
  });

  it('accepts only declared copy statuses', () => {
    expect(() => assertCopyStatus('SHELVED')).not.toThrow();
    expect(() => assertCopyStatus('ARCHIVED')).not.toThrow();
    expect(() => assertCopyStatus('LOST')).toThrow(AppError);
  });
});
