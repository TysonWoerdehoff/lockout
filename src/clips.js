import { html, useEffect } from './h.js';
import { teamInfo } from './logic.js';
import { Icon } from './icons.js';
import { Video, DownloadLink } from './ui.js';
import { uploader } from './core.js';
import { ago, stamp } from './util.js';

/** Full-screen clip player with prev/next. `list` is an array of submissions. */
export function ClipViewer({ data, list, index, onIndex, onClose, footer }) {
  const sub = list[index];
  useEffect(() => {
    if (!sub) return;
    const k = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < list.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    addEventListener('keydown', k);
    document.body.classList.add('noscroll');
    return () => {
      removeEventListener('keydown', k);
      document.body.classList.remove('noscroll');
    };
  }, [index, list.length, !!sub]);
  if (!sub) return null;
  const { game, players, contests } = data;
  const team = teamInfo(game, sub.team);
  const player = players.find((p) => p.id === sub.player_id);
  const contest = contests.find((c) => c.submission_id === sub.id);
  const challenge = game.board?.[sub.square] ?? '';
  const ext = (sub.video_path || '').split('.').pop() || 'mp4';
  return html`<div class="viewer" style=${`--tc:${team.color};--ti:${team.ink}`}>
    <div class="viewer-top">
      <button class="rec-round" onClick=${onClose} aria-label="Close"><${Icon.x} /></button>
      <span class="viewer-count">${index + 1} / ${list.length}</span>
      <span style="width:44px"></span>
    </div>
    <div class="viewer-stage" key=${sub.id}>
      <${Video} path=${sub.video_path} poster=${sub.thumb_path} autoPlay localBlob=${uploader?.localBlob(sub.id)} />
    </div>
    <div class="viewer-info">
      <div class="viewer-chip"><span class="tdot" style=${`--tc:${team.color}`}></span>${team.name}${player ? ` · ${player.name}` : ''}</div>
      <h3 class="viewer-title">${challenge}</h3>
      <p class="muted small">
        ${game.started_at ? stamp(sub.created_at, game.started_at) : ago(sub.created_at)}
        ${sub.status === 'rejected' ? html` · <span class="bad-text">ruled not legit</span>` : ''}
        ${contest?.status === 'upheld' ? html` · <span class="ok-text">survived a contest</span>` : ''}
        ${contest?.status === 'open' ? html` · <span class="warn-text">being contested</span>` : ''}
      </p>
      <div class="row between">
        <button class="btn ghost light" disabled=${index === 0} onClick=${() => onIndex(index - 1)} aria-label="Previous clip"><${Icon.chevL} /></button>
        ${sub.video_path ? html`<${DownloadLink} light path=${sub.video_path} name=${`lockout-${game.code}-${sub.square + 1}.${ext}`} />` : html`<span></span>`}
        <button class="btn ghost light" disabled=${index >= list.length - 1} onClick=${() => onIndex(index + 1)} aria-label="Next clip"><${Icon.chevR} /></button>
      </div>
      ${footer}
    </div>
  </div>`;
}
