'use client';

import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { publicEnv } from '@/lib/env/public';

/**
 * ViewerProvider — the session seam for ISR pages (ADR-0002 C1; 01 INV-09/INV-39; 03 C-17a).
 * Mounted once in `app/(public)/layout.tsx`. After hydration it resolves the session through the
 * browser client (anon key + RLS) and exposes `useViewer()`. Context only — no markup.
 *
 * S1.1: after a session is seen it reads the viewer's own `profiles` row (`id, handle, avatar_path,
 * role, is_banned` — the one allowed client read, 03 C-17 exception 5) and maps it to
 * `{ id, handle, avatarUrl, role, isBanned }`; `avatarUrl` is the public `avatars` object URL
 * (`lib/files.ts` template, built inline here with `publicEnv`). The row is re-read on SIGNED_IN /
 * TOKEN_REFRESHED / USER_UPDATED and on the window event `odsens:viewer-refresh`, which `/profile`
 * dispatches after a successful save so `ProfileMenu` updates immediately (00 S1.1.AC6).
 *
 * The Supabase browser client is imported lazily after hydration (03 C-18; ADR-0008): the ISR
 * shell's first-load JS does not carry the Supabase chunk, and the leaves render the signed-out
 * shape while `status === 'loading'`. Session presence comes from `onAuthStateChange` alone; the
 * server-verified user lookup lives in `lib/auth.ts` + proxy only (01 INV-32) — this flag drives UI
 * shape, never authorization (RLS does that). The row read is scheduled off the auth callback
 * (supabase-js asks for no awaited client calls inside it).
 *
 * Every state update here happens inside `startTransition`. The provider sits above the route
 * segments, and a segment with `loading.tsx` (02 §6) is a Suspense boundary that React hydrates
 * lazily, after the root. A non-transition context update that reaches a boundary which is still
 * dehydrated makes React throw the server HTML away and client-render that boundary (React
 * error #421) — on `/profile` that re-mounted `ProfilePanel` ~0.5 s after load and dropped the
 * keystrokes typed until then. A transition waits for the boundary to hydrate and lands after it.
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

/** Dispatched on `window` by `/profile` after a successful `updateProfile` (internal detail). */
export const VIEWER_REFRESH_EVENT = 'odsens:viewer-refresh';

const DEFAULT_STATE: ViewerState = { status: 'loading', viewer: null };

const ViewerContext = createContext<ViewerState>(DEFAULT_STATE);

export type ViewerProviderProps = { children: ReactNode };

type Row = {
  id: string;
  handle: string | null;
  avatar_path: string | null;
  role: 'user' | 'moderator' | 'admin';
  is_banned: boolean;
};

function avatarUrl(path: string | null): string | null {
  if (!path) return null;
  return `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
}

function toViewer(row: Row): Viewer {
  return {
    id: row.id,
    handle: row.handle,
    avatarUrl: avatarUrl(row.avatar_path),
    role: row.role,
    isBanned: row.is_banned,
  };
}

export function ViewerProvider({ children }: ViewerProviderProps) {
  const [state, setState] = useState<ViewerState>(DEFAULT_STATE);

  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;
    let currentUserId: string | null = null;
    let readSequence = 0;
    let onRefresh: (() => void) | null = null;

    void import('@/lib/supabase/client')
      .then(({ createBrowserClient }) => {
        if (cancelled) return;
        const supabase = createBrowserClient();

        const readOwnRow = (userId: string) => {
          readSequence += 1;
          const mine = readSequence;
          void supabase
            .from('profiles')
            .select('id, handle, avatar_path, role, is_banned')
            .eq('id', userId)
            .maybeSingle()
            .then(({ data }) => {
              if (cancelled || mine !== readSequence || currentUserId !== userId) return;
              startTransition(() => {
                setState({ status: 'signed-in', viewer: data ? toViewer(data as Row) : null });
              });
            });
        };

        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          const userId = session?.user?.id ?? null;
          currentUserId = userId;
          if (!userId) {
            startTransition(() => {
              setState({ status: 'anon', viewer: null });
            });
            return;
          }
          startTransition(() => {
            setState((previous) => {
              // Keep the same object when nothing changed (TOKEN_REFRESHED) so consumers don't re-render.
              const viewer = previous.viewer?.id === userId ? previous.viewer : null;
              return previous.status === 'signed-in' && previous.viewer === viewer
                ? previous
                : { status: 'signed-in', viewer };
            });
          });
          if (
            event === 'INITIAL_SESSION' ||
            event === 'SIGNED_IN' ||
            event === 'TOKEN_REFRESHED' ||
            event === 'USER_UPDATED'
          ) {
            // Off the auth callback (no awaited supabase calls inside it).
            setTimeout(() => {
              if (!cancelled) readOwnRow(userId);
            }, 0);
          }
        });
        subscription = data.subscription;

        onRefresh = () => {
          if (currentUserId) readOwnRow(currentUserId);
        };
        window.addEventListener(VIEWER_REFRESH_EVENT, onRefresh);
      })
      .catch(() => {
        // The client chunk failed to load (offline, blocked): stay usable as a signed-out visitor.
        if (cancelled) return;
        startTransition(() => {
          setState({ status: 'anon', viewer: null });
        });
      });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
      if (onRefresh) window.removeEventListener(VIEWER_REFRESH_EVENT, onRefresh);
    };
  }, []);

  return <ViewerContext.Provider value={state}>{children}</ViewerContext.Provider>;
}

export function useViewer(): ViewerState {
  return useContext(ViewerContext);
}
