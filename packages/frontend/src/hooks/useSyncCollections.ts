import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AddressBook, Calendar, Contact } from '@dave/shared';
import { syncCollections } from '../api/sync';

const POLL_INTERVAL_MS = 30_000;

export function useSyncCollections() {
  const queryClient = useQueryClient();

  const runSync = useCallback(async () => {
    const addressbooks = queryClient.getQueryData<AddressBook[]>(['addressbooks']);
    const calendars = queryClient.getQueryData<Calendar[]>(['calendars']);

    if (!addressbooks?.length && !calendars?.length) return;

    try {
      const result = await syncCollections({
        addressbooks: (addressbooks ?? []).map((ab) => ({ id: ab.id, syncToken: ab.syncToken })),
        calendars: (calendars ?? []).map((cal) => ({ id: cal.id, syncToken: cal.syncToken })),
      });

      // Apply address book deltas surgically.
      for (const abSync of result.addressbooks) {
        if (abSync.changed.length > 0 || abSync.deleted.length > 0) {
          queryClient.setQueryData<Contact[]>(['contacts', abSync.id], (old) => {
            let updated = old ?? [];
            // Remove deleted contacts.
            if (abSync.deleted.length > 0) {
              const deletedSet = new Set(abSync.deleted);
              updated = updated.filter((c) => !deletedSet.has(c.id));
            }
            // Upsert changed contacts (update existing, append new).
            for (const c of abSync.changed) {
              const idx = updated.findIndex((e) => e.id === c.id);
              if (idx >= 0) {
                updated = [...updated.slice(0, idx), c, ...updated.slice(idx + 1)];
              } else {
                updated = [...updated, c];
              }
            }
            return updated;
          });
        }
        // Update the stored syncToken so the next poll sends the new token.
        queryClient.setQueryData<AddressBook[]>(['addressbooks'], (old) =>
          (old ?? []).map((ab) =>
            ab.id === abSync.id ? { ...ab, syncToken: abSync.syncToken } : ab,
          ),
        );
      }

      // For calendars, invalidate event queries when the collection is dirty.
      for (const calSync of result.calendars) {
        if (calSync.dirty) {
          void queryClient.invalidateQueries({ queryKey: ['events', calSync.id] });
        }
        // Update the stored syncToken.
        queryClient.setQueryData<Calendar[]>(['calendars'], (old) =>
          (old ?? []).map((cal) =>
            cal.id === calSync.id ? { ...cal, syncToken: calSync.syncToken } : cal,
          ),
        );
      }
    } catch {
      // Sync errors are silent — the next poll will retry.
    }
  }, [queryClient]);

  useEffect(() => {
    // First poll fires after one interval so the initial page-load data is fresh.
    const intervalId = setInterval(runSync, POLL_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (!document.hidden) {
        // Tab came back into view — poll immediately then resume the interval.
        void runSync();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [runSync]);
}
