// src/hooks/useRealtimeRefresh.js
import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';

/**
 * Subscribe to Postgres changes on one or more tables and refresh when they
 * happen, so two managers working at once see each other's changes instead
 * of each editing their own stale copy of the page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PREREQUISITE — the table must be in the `supabase_realtime` publication.
 *
 * This is the failure mode to know about: subscribing to an unpublished
 * table SUCCEEDS (status: SUBSCRIBED) and then silently delivers nothing,
 * forever. There is no error to notice. It was already the case here —
 * Bookings.jsx, ShortOrders.jsx and the ManagerLayout payment badge all
 * subscribed to `booking`/`payment`, which were never published, so none of
 * them had ever actually refreshed. Only `manager` was published (added for
 * the session lock), which is why that one feature worked.
 *
 * To check what is published:
 *   select tablename from pg_publication_tables
 *   where pubname = 'supabase_realtime' order by tablename;
 *
 * Row filters (`{ table, filter }`) additionally need REPLICA IDENTITY FULL
 * on that table to work for DELETEs — the filter is matched against the OLD
 * row, and by default only the primary key is present in it, so a filter on
 * any other column (booking_id, say) silently misses deletes.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Wraps the pattern Bookings.jsx/ShortOrders.jsx already used by hand, with
 * three things those inline versions didn't do:
 *
 *  - DEBOUNCE. One user action often writes several rows (assigning four
 *    items = four INSERTs). Raw subscriptions refetch once per row; this
 *    coalesces a burst into a single refresh.
 *  - STABLE CALLBACK. The handler is kept in a ref, so passing an inline
 *    arrow function doesn't tear down and rebuild the subscription on every
 *    render — which would drop events during the gap.
 *  - UNIQUE CHANNEL NAMES. Supabase keys channels by name; two components
 *    subscribing under the same name interfere. Each caller passes its own.
 *
 * Scope note: this keeps views FRESH. It does not make concurrent writes
 * safe on its own — a check performed against freshly-arrived state and the
 * write that follows it are still two separate steps. Write paths that need
 * it re-validate against the database immediately before writing (see
 * revalidateAssignmentCapacity in utils/equipment.jsx).
 *
 * @param {string}   channelName  unique per mounted component
 * @param {Array}    tables       table names, or { table, filter } objects
 * @param {Function} onChange     called after a debounced change
 * @param {object}   options      { enabled = true, debounceMs = 400 }
 */
export function useRealtimeRefresh(channelName, tables, onChange, options = {}) {
  const { enabled = true, debounceMs = 400 } = options;

  const savedCallback = useRef(onChange);
  useEffect(() => {
    savedCallback.current = onChange;
  }, [onChange]);

  // Serialized so an inline array literal doesn't resubscribe every render.
  const tablesKey = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled) return undefined;

    const subscriptions = JSON.parse(tablesKey);
    if (!subscriptions?.length) return undefined;

    let debounceTimer = null;
    const handleChange = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => savedCallback.current?.(), debounceMs);
    };

    let channel = supabase.channel(channelName);
    subscriptions.forEach(entry => {
      const config = typeof entry === 'string' ? { table: entry } : entry;
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', ...config },
        handleChange
      );
    });
    channel.subscribe();

    return () => {
      clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [channelName, tablesKey, enabled, debounceMs]);
}
