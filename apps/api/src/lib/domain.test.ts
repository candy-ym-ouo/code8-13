import { describe, expect, it } from 'vitest';
import {
  isRestoreWindowOpen,
  isStrictlyEditable,
  normalizeMoodTags,
  validateCopyStatusTransition,
  validatePageRange,
  validateStatusTransition
} from './domain.js';
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

  it('allows archiving and unarchiving copies', () => {
    expect(() => validateCopyStatusTransition('ON_SHELF', 'ARCHIVED')).not.toThrow();
    expect(() => validateCopyStatusTransition('ARCHIVED', 'ON_SHELF')).not.toThrow();
  });

  it('rejects repeated or unknown copy status changes', () => {
    expect(() => validateCopyStatusTransition('ON_SHELF', 'ON_SHELF')).toThrow(AppError);
    expect(() => validateCopyStatusTransition('ARCHIVED', 'ARCHIVED')).toThrow(AppError);
    expect(() =>
      validateCopyStatusTransition('ON_SHELF', 'LOST' as never)
    ).toThrow(AppError);
  });
});
