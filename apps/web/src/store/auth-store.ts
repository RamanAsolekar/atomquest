'use client';

import { create } from 'zustand';
import { Api, setAccessToken } from '@/lib/api';
import type { AuthUser } from '@atom/shared';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  async login(email, password) {
    const res = await Api.login(email, password);
    setAccessToken(res.accessToken);
    set({ user: res.user });
    return res.user;
  },
  async logout() {
    try {
      await Api.logout();
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    set({ user: null });
  },
  async bootstrap() {
    // try refresh → me; silent failure means "not logged in"
    try {
      // Use a relative URL in the browser (same-origin → nginx proxies to backend).
      const refreshBase = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');
      const refreshed = await fetch(`${refreshBase}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (refreshed.ok) {
        const data = await refreshed.json();
        setAccessToken(data.accessToken);
        const user = await Api.me();
        set({ user, loading: false });
        return;
      }
    } catch {
      /* not logged in */
    }
    set({ user: null, loading: false });
  },
}));
