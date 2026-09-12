'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/layout/Toast';
import { SAVED_MESSAGES, type SavedMessageKey } from '@/components/admin/savedMessages';

/**
 * SavedToast — the "Saved." signal after an admin PRG round-trip (ADR-0038 D1; DESIGN.md §11.1
 * Toast; 03 C-30 keeps ERRORS inline — this is the success side, the `ProfilePanel` "Saved."
 * precedent, ADR-0014). The admin pages redirect back to themselves with `?saved=<message key>`
 * after a successful action; this island fires the toast once on mount and strips the query so a
 * reload or back-navigation does not repeat it. Renders nothing.
 */
export type SavedToastProps = { messageKey: SavedMessageKey };

export function SavedToast({ messageKey }: SavedToastProps) {
  const { toast } = useToast();
  useEffect(() => {
    toast(SAVED_MESSAGES[messageKey]);
    const url = new URL(window.location.href);
    if (url.searchParams.has('saved')) {
      url.searchParams.delete('saved');
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }, [messageKey, toast]);
  return null;
}
