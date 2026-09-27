export type BookStatus = 'TO_READ' | 'READING' | 'READ' | 'PAUSED' | 'ABANDONED';
export type MoodTag = 'MOVED' | 'CALM' | 'JOYFUL' | 'SAD' | 'ANGRY' | 'CONFUSED' | 'RELIEVED' | 'EMPTY' | 'CHANGED';
export type TraceType = 'DOG_EAR' | 'ANNOTATION' | 'REREAD_MARK';
export type CopyStatus = 'ON_SHELF' | 'ARCHIVED';
export type ActivityAction =
  | 'CREATED'
  | 'UPDATED'
  | 'DELETED'
  | 'RESTORED'
  | 'STATUS_CHANGED'
  | 'COMPLETED'
  | 'MOVED'
  | 'ARCHIVED'
  | 'UNARCHIVED';
export type ActivityEntityType =
  | 'BOOK'
  | 'DOG_EAR'
  | 'ANNOTATION'
  | 'REREAD_MARK'
  | 'COMPLETION_REFLECTION'
  | 'SHELF_LOCATION'
  | 'BOOK_COPY';
export declare const BOOK_STATUSES: BookStatus[];
export declare const MOOD_TAGS: MoodTag[];
export declare const TRACE_TYPES: TraceType[];
export declare const COPY_STATUSES: CopyStatus[];
export declare const ACTIVITY_ACTIONS: ActivityAction[];
export declare const ACTIVITY_ENTITY_TYPES: ActivityEntityType[];
