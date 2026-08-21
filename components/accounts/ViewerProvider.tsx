'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { publicEnv } from '@/lib/env/public';

/**
 * ViewerProvider — the session seam for ISR pages (ADR-0002 C1; 01 INV-09/INV-39; 03 C-17a).
 * Mounted once in `app/(public)/layout.tsx`. After hydration it resolves the session through the
 * browser client (anon key + RLS) and exposes `useViewer()`. No markup — it renders `children` as is.
 *
 * S1.1: after a session is seen it reads the viewer's own `profiles` row (`id, handle, avatar_path,
 * role, is_banned` — the one allowed client read, 03 C-17 exception 5) and maps it to
 * `{ id, handle, avatarUrl, role, isBanned }`; `avatarUrl` is the public `avatars` object URL
 * (`lib/files.ts` template, built inline here with `publicEnv`). The row is re-read on SIGNED_IN /
 * TOKEN_REFRESHED / USER_UPDATED and on the window event `odsens:viewer-refresh`, which `/profile`
 * dispatches after a successful save so `ProfileMenu` updates immediately (00 S1.1.AC6). On the
 * window event `odsens:viewer-signed-out`, which `ProfilePanel` dispatches after a successful
 * `deleteAccount`, it publishes `anon` at once and signs the browser client out locally
 * (`signOut({ scope: 'local' })` → SIGNED_OUT): the server action already cleared the cookies, but
 * the browser client's stored session would otherwise keep the deleted account's handle and picture
 * in the nav until a reload.
 *
 * The Supabase browser client is imported lazily after hydration (03 C-18; ADR-0008): the ISR
 * shell's first-load JS does not carry the Supabase chunk, and the leaves render the signed-out
 * shape while `status === 'loading'`. Session presence comes from `onAuthStateChange` alone; the
 * server-verified user lookup lives in `lib/auth.ts` + proxy only (01 INV-32) — this flag drives UI
 * shape, never authorization (RLS does that). The row read is scheduled off the auth callback
 * (supabase-js asks for no awaited client calls inside it).
 *
 * Publishing (ADR-0014 addendum): the state lives in a module-level external store and `useViewer()`
 * reads it with `useSyncExternalStore`, so only the leaves that call `useViewer()` re-render. A React
 * context would not do: the provider sits above the route segments, and a segment with `loading.tsx`
 * (02 §6) is a Suspense boundary that React hydrates lazily, after the root. A context update that
 * reaches a still-dehydrated boundary marks it changed — React then throws the server HTML away and
 * client-renders it (error #421 for a sync update; a silent re-render for a transition), which on
 * `/profile` replaced the server `HandleField` ~0.1 s after load and lost the keystrokes typed until
 * then. A store update touches only its subscribers; nothing propagates into the boundary.
 * `getServerSnapshot` is the `loading` state, so server HTML and hydration agree (C-17a: leaves
 * render the signed-out shape while loading). The auth subscription is reference-counted: the first
 * mounted provider starts it, the last one stops it (StrictMode remounts and the `/dev/components`
 * specimen share one subscription); the last published state survives a remount, so a client-side
 * trip through `/admin` and back does not flash "Sign in".
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

/**
 * Dispatched on `window` by `ProfilePanel` after a successful `deleteAccount` (internal detail): the
 * provider publishes `anon` and drops the browser client's stored session, so the nav signs out
 * without a reload.
 */
export const VIEWER_SIGNED_OUT_EVENT = 'odsens:viewer-signed-out';

const LOADING_STATE: ViewerState = { status: 'loading', viewer: null };
const ANON_STATE: ViewerState = { status: 'anon', viewer: null };

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

// ---------------------------------------------------------------------------------------------
// The store — one per page; `useViewer()` subscribes, the session subscription below publishes.
// ---------------------------------------------------------------------------------------------

let snapshot: ViewerState = LOADING_STATE;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ViewerState {
  return snapshot;
}

/** What the server rendered (and what hydration must agree with): the signed-out shape. */
function getServerSnapshot(): ViewerState {
  return LOADING_STATE;
}

function publish(next: ViewerState): void {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Keeps the same object when nothing changed (TOKEN_REFRESHED) so subscribers don't re-render. */
function signedIn(userId: string): ViewerState {
  const previous = snapshot;
  const viewer = previous.viewer?.id === userId ? previous.viewer : null;
  return previous.status === 'signed-in' && previous.viewer === viewer
    ? previous
    : { status: 'signed-in', viewer };
}

// ---------------------------------------------------------------------------------------------
// The session subscription — started by the first mounted provider, stopped by the last.
// ---------------------------------------------------------------------------------------------

function startSession(): () => void {
  let cancelled = false;
  let subscription: { unsubscribe: () => void } | null = null;
  let currentUserId: string | null = null;
  let readSequence = 0;
  let onRefresh: (() => void) | null = null;
  let signOutLocally: (() => void) | null = null;

  // `odsens:viewer-signed-out` (ProfilePanel after deleteAccount): the server action cleared the
  // cookies; drop the browser client's stored session too, which fires SIGNED_OUT → `anon`. The store
  // flips to `anon` right away as well — belt and braces, and it holds while the lazy client import
  // is still in flight. `currentUserId = null` makes an in-flight own-row read discard its result.
  const onSignedOut = () => {
    currentUserId = null;
    publish(ANON_STATE);
    signOutLocally?.();
  };
  window.addEventListener(VIEWER_SIGNED_OUT_EVENT, onSignedOut);

  void import('@/lib/supabase/client')
    .then(({ createBrowserClient }) => {
      if (cancelled) return;
      const supabase = createBrowserClient();
      signOutLocally = () => {
        void supabase.auth.signOut({ scope: 'local' });
      };

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
            publish({ status: 'signed-in', viewer: data ? toViewer(data as Row) : null });
          });
      };

      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        const userId = session?.user?.id ?? null;
        currentUserId = userId;
        if (!userId) {
          publish(ANON_STATE);
          return;
        }
        publish(signedIn(userId));
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
      publish(ANON_STATE);
    });

  return () => {
    cancelled = true;
    subscription?.unsubscribe();
    window.removeEventListener(VIEWER_SIGNED_OUT_EVENT, onSignedOut);
    if (onRefresh) window.removeEventListener(VIEWER_REFRESH_EVENT, onRefresh);
  };
}

let mounted = 0;
let stopSession: (() => void) | null = null;

export function ViewerProvider({ children }: ViewerProviderProps) {
  useEffect(() => {
    mounted += 1;
    if (mounted === 1) stopSession = startSession();
    return () => {
      mounted -= 1;
      if (mounted === 0) {
        stopSession?.();
        stopSession = null;
      }
    };
  }, []);

  return children;
}

export function useViewer(): ViewerState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
