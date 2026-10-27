// Same-origin API served by server.mjs. Data and clips stay on that machine.
const API = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error || ''; } catch {}
    const error = new Error(detail || `Local server error (${response.status})`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

const query = (match = {}, options = {}) => `?match=${encodeURIComponent(JSON.stringify(match))}&options=${encodeURIComponent(JSON.stringify(options))}`;

export function localBackend() {
  return {
    kind: 'local',
    async enablePush(gameId, playerId) {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push notifications are not supported by this browser.');
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable push alerts.');
      const registration = await navigator.serviceWorker.ready;
      const keyResponse = await fetch(`${API}/push/key`, { cache: 'no-store' });
      if (!keyResponse.ok) throw new Error('Could not connect to the local push service.');
      const { publicKey } = await keyResponse.json();
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(publicKey) });
      await request('/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game_id: gameId, player_id: playerId, subscription: subscription.toJSON() }) });
      return true;
    },
    select: (table, match, options) => request(`/${table}${query(match, options)}`),
    insert: async (table, row) => {
      try { return { data: await request(`/${table}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row) }) }; }
      catch (error) { if (error.status === 409) return { conflict: true, error }; throw error; }
    },
    update: (table, patch, match) => request(`/${table}${query(match)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }),
    upsert: (table, row) => request(`/${table}/upsert`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row) }),
    remove: (table, match) => request(`/${table}${query(match)}`, { method: 'DELETE' }),
    subscribe(gameId, onEvent, onStatus) {
      const events = new EventSource(`${API}/events?game_id=${encodeURIComponent(gameId)}`);
      events.onopen = () => onStatus?.('SUBSCRIBED');
      events.onerror = () => onStatus?.('CHANNEL_ERROR');
      events.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data);
          if (update.type === 'change' && (!update.game_id || update.game_id === gameId)) onEvent(update.table);
        } catch {}
      };
      return () => events.close();
    },
    async upload(path, blob, contentType, onProgress) {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API}/storage?path=${encodeURIComponent(path)}`);
        xhr.setRequestHeader('content-type', contentType || 'application/octet-stream');
        xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Object.assign(new Error(`Upload failed (${xhr.status})`), { status: xhr.status }));
        xhr.onerror = () => reject(Object.assign(new Error('Network error during upload'), { status: 0 }));
        xhr.send(blob);
      });
      onProgress?.(1);
    },
    mediaUrl: (path) => path ? `${API}/storage?path=${encodeURIComponent(path)}` : null,
    downloadUrl: (path, filename) => path ? `${API}/storage?path=${encodeURIComponent(path)}${filename ? `&download=${encodeURIComponent(filename)}` : ''}` : null,
  };
}

function decodeKey(value) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`;
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
