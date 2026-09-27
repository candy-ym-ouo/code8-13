import { api } from './client';
import type {
  Annotation,
  Book,
  BookCopy,
  BookStatus,
  CopyLocationEvent,
  DogEar,
  MoodTag,
  Pagination,
  Reflection,
  RereadMark,
  ShelfLocation,
  TimelineEvent,
  Trace,
  User
} from '../types/domain';

export interface BookPayload {
  title: string;
  author: string | null;
  publisher: string | null;
  publicationYear: number | null;
  isbn: string | null;
  pageCount: number | null;
  coverUrl: string | null;
  status?: BookStatus;
}

export const authApi = {
  register: (email: string, password: string) => api.post<{ user: User }>('/auth/register', { email, password }),
  login: (email: string, password: string) => api.post<{ user: User }>('/auth/login', { email, password }),
  logout: () => api.post<void>('/auth/logout'),
  me: () => api.get<{ user: User }>('/auth/me'),
  password: (currentPassword: string, newPassword: string) =>
    api.patch<{ ok: true }>('/auth/password', { currentPassword, newPassword }),
  deleteAccount: (password: string) => api.delete<void>('/auth/account', { password })
};

export const booksApi = {
  list: (params: URLSearchParams) => api.get<{ items: Book[]; pagination: Pagination }>(`/books?${params}`),
  get: (id: string) => api.get<{ book: Book }>(`/books/${id}`),
  create: (body: BookPayload) => api.post<{ book: Book }>('/books', body),
  update: (id: string, body: Partial<BookPayload> & { version: number }) =>
    api.patch<{ book: Book }>(`/books/${id}`, body),
  updateStatus: (
    id: string,
    body: { status: BookStatus; version: number; reflection?: { moodTags: MoodTag[]; text: string } }
  ) => api.patch<{ book: Book; reflection?: Reflection }>(`/books/${id}/status`, body),
  delete: (id: string, version: number) => api.delete<void>(`/books/${id}`, { version }),
  traces: (id: string, params: URLSearchParams) =>
    api.get<{ items: Trace[]; pagination: Pagination }>(`/books/${id}/traces?${params}`),
  reflections: (id: string) => api.get<{ items: Reflection[] }>(`/books/${id}/reflections`)
};

export const traceApi = {
  createDogEar: (bookId: string, body: { pageNumber: number; reason: string | null }) =>
    api.post<{ dogEar: DogEar; idempotent?: boolean }>(`/books/${bookId}/dog-ears`, body),
  updateDogEar: (id: string, body: { pageNumber?: number; reason?: string | null; version: number }) =>
    api.patch<{ dogEar: DogEar }>(`/dog-ears/${id}`, body),
  deleteDogEar: (id: string, version: number) => api.delete<void>(`/dog-ears/${id}`, { version }),
  restoreDogEar: (id: string) => api.post<{ dogEar: DogEar }>(`/dog-ears/${id}/restore`),
  createAnnotation: (bookId: string, body: { startPage: number; endPage: number; content: string }) =>
    api.post<{ annotation: Annotation }>(`/books/${bookId}/annotations`, body),
  updateAnnotation: (
    id: string,
    body: { startPage?: number; endPage?: number; content?: string; version: number }
  ) => api.patch<{ annotation: Annotation }>(`/annotations/${id}`, body),
  deleteAnnotation: (id: string, version: number) => api.delete<void>(`/annotations/${id}`, { version }),
  restoreAnnotation: (id: string) => api.post<{ annotation: Annotation }>(`/annotations/${id}/restore`),
  createReread: (bookId: string, body: { pageNumber: number; reason: string | null }) =>
    api.post<{ rereadMark: RereadMark }>(`/books/${bookId}/reread-marks`, body),
  updateReread: (id: string, body: { pageNumber?: number; reason?: string | null; version: number }) =>
    api.patch<{ rereadMark: RereadMark }>(`/reread-marks/${id}`, body),
  deleteReread: (id: string, version: number) => api.delete<void>(`/reread-marks/${id}`, { version }),
  restoreReread: (id: string) => api.post<{ rereadMark: RereadMark }>(`/reread-marks/${id}/restore`)
};

export const reflectionApi = {
  update: (id: string, body: { moodTags: MoodTag[]; text: string; version: number }) =>
    api.patch<{ reflection: Reflection }>(`/reflections/${id}`, body),
  delete: (id: string, version: number) => api.delete<void>(`/reflections/${id}`, { version }),
  restore: (id: string) => api.post<{ reflection: Reflection }>(`/reflections/${id}/restore`)
};

export const timelineApi = {
  list: (params: URLSearchParams) =>
    api.get<{ items: TimelineEvent[]; pagination: Pagination }>(`/timeline?${params}`)
};

export const exportApi = {
  download: (includeDeleted: boolean) =>
    api.download(`/exports/me?includeDeleted=${includeDeleted ? 'true' : 'false'}`)
};

export const locationApi = {
  list: (params: URLSearchParams) =>
    api.get<{ items: ShelfLocation[]; pagination: Pagination }>(`/locations?${params}`),
  create: (body: { name: string; description: string | null }) =>
    api.post<{ location: ShelfLocation }>('/locations', body),
  update: (id: string, body: { name?: string; description?: string | null }) =>
    api.patch<{ location: ShelfLocation }>(`/locations/${id}`, body),
  archive: (id: string) => api.post<{ location: ShelfLocation }>(`/locations/${id}/archive`),
  unarchive: (id: string) => api.post<{ location: ShelfLocation }>(`/locations/${id}/unarchive`),
  delete: (id: string) => api.delete<void>(`/locations/${id}`)
};

export interface CopyPayload {
  label?: string | null;
  condition?: string | null;
  acquiredAt?: string | null;
  notes?: string | null;
  locationId?: string | null;
  note?: string | null;
}

export const copyApi = {
  listForBook: (bookId: string) =>
    api.get<{ items: BookCopy[]; pagination: Pagination }>(
      `/books/${bookId}/copies?page=1&pageSize=100`
    ),
  create: (bookId: string, body: CopyPayload) =>
    api.post<{ copy: BookCopy }>(`/books/${bookId}/copies`, body),
  get: (id: string) => api.get<{ copy: BookCopy }>(`/copies/${id}`),
  history: (id: string) => api.get<{ items: CopyLocationEvent[] }>(`/copies/${id}/history`),
  update: (id: string, body: CopyPayload & { version: number }) =>
    api.patch<{ copy: BookCopy }>(`/copies/${id}`, body),
  move: (id: string, body: { locationId: string | null; note?: string | null; version?: number }) =>
    api.post<{ copy: BookCopy; unchanged?: boolean }>(`/copies/${id}/move`, body),
  archive: (id: string, body: { note?: string | null; version?: number }) =>
    api.post<{ copy: BookCopy }>(`/copies/${id}/archive`, body),
  unarchive: (
    id: string,
    body: { locationId?: string | null; note?: string | null; version?: number }
  ) => api.post<{ copy: BookCopy }>(`/copies/${id}/unarchive`, body),
  delete: (id: string, version: number) => api.delete<void>(`/copies/${id}`, { version }),
  restore: (id: string) => api.post<{ copy: BookCopy }>(`/copies/${id}/restore`)
};
