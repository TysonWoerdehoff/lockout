import { createClient } from '@supabase/supabase-js';

const TABLES = ['players', 'submissions', 'contests', 'votes'];
const BUCKET = 'clips';

function applyMatch(q, match = {}) {
  for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
  return q;
}

const alreadyExists = (msg = '') => /duplicate|already exists/i.test(msg);

export function supabaseBackend({ supabaseUrl, supabaseKey }) {
  const url = supabaseUrl.replace(/\/+$/, '');
  const sb = createClient(url, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  function xhrUpload(path, blob, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${url}/storage/v1/object/${BUCKET}/${path}`);
      xhr.setRequestHeader('apikey', supabaseKey);
      if (supabaseKey.startsWith('eyJ')) xhr.setRequestHeader('Authorization', `Bearer ${supabaseKey}`);
      xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
      xhr.setRequestHeader('cache-control', 'max-age=31536000');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        if ((xhr.status >= 200 && xhr.status < 300) || alreadyExists(xhr.responseText)) return resolve();
        const err = new Error(`Upload failed (${xhr.status})`);
        err.status = xhr.status;
        err.body = xhr.responseText;
        reject(err);
      };
      xhr.onerror = () => reject(Object.assign(new Error('Network error during upload'), { status: 0 }));
      xhr.ontimeout = xhr.onerror;
      xhr.send(blob);
    });
  }

  return {
    kind: 'supabase',

    async select(table, match) {
      const { data, error } = await applyMatch(sb.from(table).select('*'), match);
      if (error) throw error;
      return data || [];
    },

    async insert(table, row) {
      const { data, error } = await sb.from(table).insert(row).select().single();
      if (error) {
        if (error.code === '23505') return { conflict: true, error };
        throw error;
      }
      return { data };
    },

    async update(table, patch, match) {
      const { data, error } = await applyMatch(sb.from(table).update(patch), match).select();
      if (error) throw error;
      return data || [];
    },

    async upsert(table, row, onConflict) {
      const { error } = await sb.from(table).upsert(row, { onConflict });
      if (error) throw error;
    },

    async remove(table, match) {
      const { error } = await applyMatch(sb.from(table).delete(), match);
      if (error) throw error;
    },

    subscribe(gameId, onEvent, onStatus) {
      const ch = sb.channel(`game-${gameId}-${Math.random().toString(36).slice(2, 8)}`);
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => onEvent('games'));
      for (const t of TABLES) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `game_id=eq.${gameId}` }, () => onEvent(t));
      }
      // Deletes can't be filtered server-side; a player leaving anywhere just triggers a refresh.
      ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'players' }, () => onEvent('players'));
      ch.subscribe((status) => onStatus?.(status));
      return () => sb.removeChannel(ch);
    },

    async upload(path, blob, contentType, onProgress) {
      try {
        await xhrUpload(path, blob, contentType, onProgress);
      } catch (e) {
        if (!e.status) throw e; // offline: let the queue retry
        // Header/auth quirk? Fall back to the official client (no progress bar).
        const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType, cacheControl: '31536000', upsert: false });
        if (error && !alreadyExists(error.message)) throw error;
        onProgress?.(1);
      }
    },

    mediaUrl(path) {
      return path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
    },

    downloadUrl(path, filename) {
      return path ? sb.storage.from(BUCKET).getPublicUrl(path, { download: filename || true }).data.publicUrl : null;
    },
  };
}
