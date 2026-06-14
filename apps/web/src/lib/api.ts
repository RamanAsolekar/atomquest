'use client';

import { env } from './config';

/**
 * API client with in-memory access token + automatic refresh on 401.
 * The refresh token lives in an httpOnly cookie (set by the backend), so the
 * SPA never touches it directly — XSS can't exfiltrate it.
 */
let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${env.apiUrl}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface RequestOpts extends Omit<RequestInit, 'body'> {
  body?: unknown;
  auth?: boolean;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { body, auth = true, raw, headers, ...rest } = opts;
  const doFetch = async (): Promise<Response> => {
    const h: Record<string, string> = { ...(headers as Record<string, string>) };
    if (!(body instanceof FormData)) h['Content-Type'] = 'application/json';
    if (auth && accessToken) h['Authorization'] = `Bearer ${accessToken}`;
    return fetch(`${env.apiUrl}${path}`, {
      ...rest,
      headers: h,
      credentials: 'include',
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch();
  if (res.status === 401 && auth) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await doFetch();
  }

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = Array.isArray(data.message) ? data.message.join(', ') : data.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Typed endpoint helpers ----------------------------------------------------
export const Api = {
  // auth
  login: (email: string, password: string) =>
    api<{ user: any; accessToken: string; expiresIn: number }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),
  logout: () => api('/api/auth/logout', { method: 'POST' }),
  me: () => api<any>('/api/auth/me'),

  // sessions
  createSession: (body: any) => api('/api/sessions', { method: 'POST', body }),
  listSessions: (q = '') => api<any>(`/api/sessions${q}`),
  getSession: (id: string) => api<any>(`/api/sessions/${id}`),
  sessionEvents: (id: string) => api<any[]>(`/api/sessions/${id}/events`),
  sessionMessages: (id: string) => api<any[]>(`/api/sessions/${id}/messages`),
  endSession: (id: string) => api(`/api/sessions/${id}/end`, { method: 'POST' }),
  createInvite: (id: string, body: any = {}) =>
    api<any>(`/api/sessions/${id}/invites`, { method: 'POST', body }),
  validateInvite: (token: string) =>
    api<any>(`/api/sessions/invite/${token}/validate`, { auth: false }),
  // Joining WITH an invite token = guest join → don't send the agent's auth
  // token (the user may be signed in as the agent in the same browser, which
  // would otherwise make the backend treat them as the agent, not the guest).
  join: (id: string, body: any) =>
    api<any>(`/api/sessions/${id}/join`, { method: 'POST', body, auth: !body?.inviteToken && !!accessToken }),

  // recordings
  startRecording: (id: string) => api(`/api/sessions/${id}/recording/start`, { method: 'POST' }),
  stopRecording: (id: string) => api(`/api/sessions/${id}/recording/stop`, { method: 'POST' }),
  recordings: (id: string) => api<any[]>(`/api/sessions/${id}/recordings`),

  // files
  sessionFiles: (id: string) => api<any[]>(`/api/files/session/${id}`),

  // ai + transcript
  aiSummary: (id: string) => api<any>(`/api/sessions/${id}/ai/summary`),
  generateAiSummary: (id: string) => api<any>(`/api/sessions/${id}/ai/summary`, { method: 'POST' }),
  transcript: (id: string) => api<any[]>(`/api/sessions/${id}/transcript`),

  // admin
  liveSessions: () => api<any[]>('/api/admin/sessions/live'),
  forceEnd: (id: string) => api(`/api/admin/sessions/${id}/force-end`, { method: 'POST' }),
  adminEvents: () => api<any[]>('/api/admin/events'),
  auditLogs: () => api<any>('/api/audit/logs'),

  // analytics
  analytics: () => api<any>('/api/analytics/overview'),

  // runtime config + knowledge base (dynamic, admin-editable)
  getConfig: () => api<Record<string, any>>('/api/config'),
  setConfig: (key: string, value: any) => api(`/api/config/${key}`, { method: 'PUT', body: { value } }),
  listKb: () => api<any[]>('/api/kb'),
  createKb: (body: any) => api<any>('/api/kb', { method: 'POST', body }),
  updateKb: (id: string, body: any) => api<any>(`/api/kb/${id}`, { method: 'PUT', body }),
  deleteKb: (id: string) => api(`/api/kb/${id}`, { method: 'DELETE' }),
};

/** Build an SSE URL with the access token (EventSource can't set headers). */
export function streamUrl(topic: string): string {
  return `${env.apiUrl}/api/stream/${topic}?token=${encodeURIComponent(accessToken ?? '')}`;
}
