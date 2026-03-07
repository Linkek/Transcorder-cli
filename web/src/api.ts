const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export interface AuthStatus {
  authenticated: boolean;
  username: string | null;
  localAllow: boolean;
}

export const getAuthStatus = () => request<AuthStatus>('/auth/status');
export const login = (username: string, password: string) =>
  request<{ ok: boolean; username: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
export const logout = () =>
  request<{ ok: boolean }>('/auth/logout', { method: 'POST' });

// ─── Stats ──────────────────────────────────────────────────────────────────

export interface Stats {
  total: number;
  pending: number;
  completed: number;
  failed: number;
  skipped: number;
  savedBytes: number;
  active: number;
  paused: boolean;
}

export const getStats = () => request<Stats>('/stats');

// ─── Jobs ───────────────────────────────────────────────────────────────────

export interface Job {
  id: number;
  sourcePath: string;
  outputPath: string | null;
  status: string;
  profileName: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  width?: number;
  height?: number;
  isHDR?: number;
  codec?: string;
  duration?: number;
  fileSize?: number;
}

export const getJobs = (limit = 200) => request<Job[]>(`/jobs?limit=${limit}`);
export const deleteJob = (id: number) =>
  request<{ ok: boolean }>(`/jobs/${id}`, { method: 'DELETE' });
export const retryJob = (id: number) =>
  request<{ ok: boolean }>(`/jobs/${id}/retry`, { method: 'POST' });
export const clearJobs = (status?: string) =>
  request<{ ok: boolean }>('/jobs/clear', {
    method: 'POST',
    body: JSON.stringify({ status }),
  });

// ─── Queue ──────────────────────────────────────────────────────────────────

export interface QueueStatus {
  active: number;
  pending: number;
  paused: boolean;
}

export const getQueueStatus = () => request<QueueStatus>('/queue/status');
export const pauseQueue = () =>
  request<{ ok: boolean; paused: boolean }>('/queue/pause', { method: 'POST' });
export const resumeQueue = () =>
  request<{ ok: boolean; paused: boolean }>('/queue/resume', { method: 'POST' });

// ─── Profiles ───────────────────────────────────────────────────────────────

export interface Profile {
  name: string;
  sourceFolders: string[];
  recursive: boolean;
  replaceFile: boolean;
  outputFolder?: string;
  outputFormat: string;
  cacheFolder: string;
  maxWidth: number;
  maxHeight: number;
  downscaleToMax: boolean;
  renameFiles: boolean;
  removeHDR: boolean;
  nvencPreset: string;
  cqValue: number;
  log: boolean;
  priority: number;
  minSizeReduction: number;
}

export const getProfiles = () => request<Profile[]>('/profiles');
