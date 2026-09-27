import type { ActivityAction, ActivityEntityType, BookStatus, CopyStatus, MoodTag, TraceType } from '@paper-book-traces/shared';

export type { ActivityAction, ActivityEntityType, BookStatus, CopyStatus, MoodTag, TraceType };

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface TraceSummary {
  dogEars: number;
  annotations: number;
  rereadMarks: number;
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  publicationYear: number | null;
  isbn: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  status: BookStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  traceSummary: TraceSummary;
  copyCount?: number;
  hasCompletionReflection?: boolean;
  lastTraceAt?: string | null;
  reflections?: Reflection[];
}

export interface ShelfLocation {
  id: string;
  name: string;
  note: string | null;
  sortOrder: number;
  version: number;
  copyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookCopy {
  id: string;
  bookId: string;
  copyNo: number;
  label: string | null;
  note: string | null;
  status: CopyStatus;
  locationId: string | null;
  locationName: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShelfCopy {
  id: string;
  bookId: string;
  bookTitle: string;
  copyNo: number;
  label: string | null;
  status: CopyStatus;
}

export interface CopyMovement {
  id: string;
  copyId: string;
  fromLocationId: string | null;
  fromLocationName: string | null;
  toLocationId: string | null;
  toLocationName: string | null;
  reason: string | null;
  movedAt: string;
}

export interface DogEar {
  id: string;
  bookId: string;
  type: 'DOG_EAR';
  pageNumber: number;
  reason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Annotation {
  id: string;
  bookId: string;
  type: 'ANNOTATION';
  startPage: number;
  endPage: number;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RereadMark {
  id: string;
  bookId: string;
  type: 'REREAD_MARK';
  pageNumber: number;
  reason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type Trace = DogEar | Annotation | RereadMark;

export interface Reflection {
  id: string;
  bookId: string;
  completionRound: number;
  moodTags: MoodTag[];
  text: string;
  completedAt: string;
  editableUntil: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  bookId: string | null;
  bookTitle: string | null;
  entityType: ActivityEntityType;
  entityId: string | null;
  action: ActivityAction;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export const MOOD_LABELS: Record<MoodTag, string> = {
  MOVED: '被触动',
  CALM: '平静',
  JOYFUL: '喜悦',
  SAD: '难过',
  ANGRY: '愤怒',
  CONFUSED: '困惑',
  RELIEVED: '释然',
  EMPTY: '空落',
  CHANGED: '被改变'
};

export const STATUS_LABELS: Record<BookStatus, string> = {
  TO_READ: '想读',
  READING: '阅读中',
  READ: '已读完',
  PAUSED: '暂时搁置',
  ABANDONED: '停止阅读'
};

export const TRACE_LABELS: Record<TraceType, string> = {
  DOG_EAR: '折角',
  ANNOTATION: '批注',
  REREAD_MARK: '重读页'
};

export const COPY_STATUS_LABELS: Record<CopyStatus, string> = {
  ON_SHELF: '在架',
  ARCHIVED: '已归档'
};

export const ACTION_LABELS: Record<ActivityAction, string> = {
  CREATED: '创建',
  UPDATED: '修改',
  DELETED: '删除',
  RESTORED: '恢复',
  STATUS_CHANGED: '状态变化',
  COMPLETED: '读完',
  MOVED: '移动',
  ARCHIVED: '归档',
  UNARCHIVED: '取消归档'
};

export const ENTITY_LABELS: Record<ActivityEntityType, string> = {
  BOOK: '书目',
  DOG_EAR: '折角',
  ANNOTATION: '批注',
  REREAD_MARK: '重读页',
  COMPLETION_REFLECTION: '完成感受',
  SHELF_LOCATION: '书架位置',
  BOOK_COPY: '实体副本'
};
