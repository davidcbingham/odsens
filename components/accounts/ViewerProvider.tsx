'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

/**
 * ViewerProvider — the session seam for ISR pages (ADR-0002 C1; 01 INV-09/INV-39; 03 C-17a).
 * Mounted once in `app/(public)/layout.tsx`. After hydration it resolves the session through the
 * browser client (anon key + RLS) and exposes `useViewer()`. Context only — no markup, no fetch.
 * S0: `viewer` stays null; the own `profiles` row read (`id, handle, avatar_path, role, is_banned`
 * → camelCase, `avatarUrl` resolved from `avatar_path`) lands in S1.1 when the table exists.
 *
 * Session presence comes from `onAuthStateChange` alone: it fires `INITIAL_SESSION` on subscribe
 * with the session held in the auth cookies, then SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED. The
 * server-verified user lookup lives in `lib/auth.ts` + middleware only (01 INV-32); this flag
 * drives UI shape, never authorization (RLS does that).
 */
export type Viewer = {
  id: string;
  handle: string | null;
  avatarUrl: string | null;
  role: 'user' | 'moderator' | 'admin';
  isBanned: boolean;
};

export type ViewerState = {
  status: 'loading' | 'anon' | 'signed-in';
  viewer: Viewer | null;
};

const DEFAULT_STATE: ViewerState = { status: 'loading', viewer: null };

const ViewerContext = createContext<ViewerState>(DEFAULT_STATE);

export type ViewerProviderProps = { children: ReactNode };

export function ViewerProvider({ children }: ViewerProviderProps) {
  const [state, setState] = useState<ViewerState>(DEFAULT_STATE);

  useEffect(() => {
    const supabase = createBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ status: session?.user ? 'signed-in' : 'anon', viewer: null });
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return <ViewerContext.Provider value={state}>{children}</ViewerContext.Provider>;
}

export function useViewer(): ViewerState {
  return useContext(ViewerContext);
}
