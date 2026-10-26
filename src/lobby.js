import { html, useState, useEffect, useRef, useMemo } from './h.js';
import { backend, startGame, toast, go, CLIENT_ID } from './core.js';
import { normalizeSettings, teamInfo, parseChallenges, describeWin, randomTeams, MAX_TEAMS } from './logic.js';
import { store } from './util.js';
import { PACKS } from './packs.js';
import { Icon } from './icons.js';
import { Seg, Stepper, Sheet, TeamDot } from './ui.js';
import { RULES } from './home.js';

export function shareInvite(game) {
  const url = `${location.origin}${location.pathname}#/g/${game.code}`;
  const text = `Join my Lockout game — code ${game.code}`;
  if (navigator.share) navigator.share({ title: 'Lockout', text, url }).catch(() => {});
  else {
    navigator.clipboard?.writeText(`${text}: ${url}`).then(
      () => toast('Invite link copied'),
      () => toast(url)
    );
  }
}

export function Lobby({ data, me, refresh }) {
  const { game, players } = data;
  const isHost = game.host_id === CLIENT_ID;
  const host = players.find((p) => p.client_id === game.host_id);
  const [rules, setRules] = useState(false);
  const [, bump] = useState(0);

  // Optimistic settings so quick taps don't overwrite each other while a save is in flight.
  const sref = useRef(normalizeSettings(game.settings));
  const lastWrite = useRef(0);
  if (Date.now() - lastWrite.current > 2500) sref.current = normalizeSettings(game.settings);
  const settings = sref.current;

  async function saveSettings(patch) {
    const cur = sref.current;
    const next = normalizeSettings({ ...cur, ...patch, win: { ...cur.win, ...(patch.win || {}) } });
    sref.current = next;
    lastWrite.current = Date.now();
    bump((n) => n + 1);
    try {
      await backend.update('games', { settings: next }, { id: game.id });
    } catch (e) {
      toast('Couldn’t save that setting', { kind: 'bad' });
    }
    lastWrite.current = Date.now();
    refresh();
  }

  async function setTeam(team) {
    await backend.update('players', { team }, { id: me.id });
    refresh();
  }

  async function shuffleTeams() {
    const changes = randomTeams(players, settings.teamCount);
    await Promise.all(changes.map((c) => backend.update('players', { team: c.team }, { id: c.id })));
    refresh();
    toast('Teams shuffled 🎲');
  }

  async function renameTeam(i) {
    const cur = teamInfo(game, i).name;
    const n = prompt('Team name', cur);
    if (n == null) return;
    const names = [...(game.team_names || [])];
    while (names.length <= i) names.push('');
    names[i] = n.trim().slice(0, 18);
    await backend.update('games', { team_names: names }, { id: game.id });
    refresh();
  }

  async function takeHost() {
    if (!confirm('Become the host of this game?')) return;
    await backend.update('games', { host_id: CLIENT_ID }, { id: game.id });
    refresh();
  }

  async function leave() {
    if (!confirm('Leave this game?')) return;
    await backend.remove('players', { id: me.id });
    go(null);
  }

  const teams = [...Array(settings.teamCount)].map((_, i) => ({
    ...teamInfo(game, i),
    members: players.filter((p) => p.team === i),
  }));
  const unassigned = players.filter((p) => p.team == null || p.team >= settings.teamCount);

  return html`<main class="page lobby">
    <header class="lobby-head">
      <div>
        <p class="eyebrow">Game code</p>
        <div class="code-big">${game.code}</div>
      </div>
      <button class="btn" onClick=${() => shareInvite(game)}><${Icon.share} size=${18} /> Invite</button>
    </header>

    <section class="card">
      <div class="card-head">
        <h2 class="h2">Teams <span class="muted">· ${players.length} player${players.length === 1 ? '' : 's'}</span></h2>
        ${isHost &&
        html`<div class="row tight">
          <${Stepper} value=${settings.teamCount} min=${2} max=${MAX_TEAMS} onChange=${(v) => saveSettings({ teamCount: v })} />
        </div>`}
      </div>
      <div class="teams">
        ${teams.map(
          (t) => html`<div class=${`team-card ${me.team === t.index ? 'mine' : ''}`} style=${`--tc:${t.color};--ti:${t.ink}`}>
            <div class="team-card-head">
              <span class="team-name">${t.name}</span>
              ${(isHost || me.team === t.index) &&
              html`<button class="icon-btn small" onClick=${() => renameTeam(t.index)} aria-label="Rename team"><${Icon.pencil} size=${14} /></button>`}
            </div>
            <ul class="members">
              ${t.members.map((p) => html`<li class=${p.id === me.id ? 'me' : ''}>${p.name}${p.client_id === game.host_id ? ' ★' : ''}</li>`)}
              ${t.members.length === 0 && html`<li class="muted">Nobody yet</li>`}
            </ul>
            ${me.team !== t.index
              ? html`<button class="btn small team-join" onClick=${() => setTeam(t.index)}>Join ${t.name}</button>`
              : html`<span class="you-here">You’re here</span>`}
          </div>`
        )}
      </div>
      ${unassigned.length > 0 &&
      html`<p class="muted small unassigned">No team yet: ${unassigned.map((p) => p.name).join(', ')}${isHost ? ' — they’ll be placed automatically at start.' : ''}</p>`}
      ${isHost &&
      html`<button class="btn ghost" onClick=${shuffleTeams} disabled=${players.length < 2}><${Icon.dice} size=${18} /> Randomize teams</button>`}
    </section>

    <${SettingsCard} settings=${settings} isHost=${isHost} save=${saveSettings} />
    <${ChallengesCard} game=${game} settings=${settings} isHost=${isHost} refresh=${refresh} data=${data} />

    <div class="lobby-foot">
      <button class="link-btn" onClick=${() => setRules(true)}>How to play</button>
      ${!isHost && html`<button class="link-btn" onClick=${takeHost}>Host gone? Take over</button>`}
      <button class="link-btn danger" onClick=${leave}>Leave game</button>
    </div>
    ${!isHost &&
    html`<div class="dock">
      <div class="waiting"><span class="pulse"></span> Waiting for ${host?.name || 'the host'} to start…</div>
    </div>`}
    <${Sheet} open=${rules} onClose=${() => setRules(false)} title="How to play">${RULES}</${Sheet}>
  </main>`;
}

function SettingsCard({ settings, isHost, save }) {
  const total = settings.size * settings.size;
  if (!isHost) {
    return html`<section class="card">
      <h2 class="h2">Rules</h2>
      <dl class="facts">
        <div><dt>Board</dt><dd>${settings.size}×${settings.size}</dd></div>
        <div><dt>To win</dt><dd>${describeWin(settings)}</dd></div>
        <div><dt>Time limit</dt><dd>${settings.timeLimitMin ? `${settings.timeLimitMin} min (most squares wins)` : 'None'}</dd></div>
        <div><dt>Review window</dt><dd>${settings.reviewSecs}s</dd></div>
      </dl>
    </section>`;
  }
  const w = settings.win;
  return html`<section class="card">
    <h2 class="h2">Rules</h2>
    <div class="field">
      <span class="label">Board size</span>
      <${Seg} value=${settings.size} onChange=${(v) => save({ size: v })}
        options=${[3, 4, 5, 6, 7].map((n) => ({ value: n, label: `${n}×${n}` }))} />
    </div>
    <div class="field">
      <span class="label">To win</span>
      <${Seg} value=${w.type} onChange=${(v) => save({ win: { type: v, n: v === 'squares' ? Math.min(10, total) : 1 } })}
        options=${[{ value: 'lines', label: 'Bingo' }, { value: 'squares', label: 'Squares' }, { value: 'majority', label: 'Majority' }]} />
      ${w.type === 'lines' &&
      html`<div class="row between sub-field"><span>Bingos needed</span>
        <${Stepper} value=${w.n} min=${1} max=${2 * settings.size + 2} onChange=${(v) => save({ win: { n: v } })} /></div>`}
      ${w.type === 'squares' &&
      html`<div class="row between sub-field"><span>Squares needed</span>
        <${Stepper} value=${w.n} min=${1} max=${total} onChange=${(v) => save({ win: { n: v } })} /></div>`}
      <p class="hint">${describeWin(settings)}${w.type === 'majority' ? ' — once a team has more than half, nobody can catch them.' : ''}</p>
    </div>
    <div class="field">
      <span class="label">Time limit</span>
      <${Seg} value=${settings.timeLimitMin} onChange=${(v) => save({ timeLimitMin: v })}
        options=${[{ value: 0, label: 'None' }, { value: 30, label: '30m' }, { value: 60, label: '1h' }, { value: 90, label: '1.5h' }, { value: 120, label: '2h' }]} />
      ${settings.timeLimitMin > 0 && html`<p class="hint">If nobody wins in time, most squares wins.</p>`}
    </div>
    <div class="field">
      <span class="label">Review window before a win counts</span>
      <${Seg} value=${settings.reviewSecs} onChange=${(v) => save({ reviewSecs: v })}
        options=${[{ value: 15, label: '15s' }, { value: 30, label: '30s' }, { value: 60, label: '60s' }, { value: 120, label: '2m' }]} />
    </div>
  </section>`;
}

function ChallengesCard({ game, settings, isHost, refresh, data }) {
  const need = settings.size * settings.size;
  const [draft, setDraft] = useState(() => (game.challenges || []).join('\n'));
  const [packsOpen, setPacksOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const saveTimer = useRef();
  const parsed = useMemo(() => parseChallenges(draft), [draft]);
  const saved = store.get('packs', []);

  function update(text) {
    setDraft(text);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await backend.update('games', { challenges: parseChallenges(text) }, { id: game.id });
      refresh();
    }, 600);
  }
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function addPack(items, replace) {
    const base = replace ? [] : parseChallenges(draft);
    update(parseChallenges([...base, ...items].join('\n')).join('\n'));
    setPacksOpen(false);
  }

  function savePack() {
    if (!parsed.length) return toast('Nothing to save yet');
    const name = prompt('Name this challenge pack', 'My pack');
    if (!name) return;
    const packs = store.get('packs', []).filter((p) => p.name !== name);
    packs.unshift({ name: name.slice(0, 30), items: parsed });
    store.set('packs', packs.slice(0, 12));
    toast(`Saved “${name}”`);
  }

  async function start() {
    clearTimeout(saveTimer.current);
    setStarting(true);
    try {
      const ok = await startGame(data, parsed, settings);
      if (!ok) toast('Game already started');
      refresh();
    } catch (e) {
      toast(e.message || 'Could not start', { kind: 'bad' });
    } finally {
      setStarting(false);
    }
  }

  if (!isHost) {
    const list = game.challenges || [];
    return html`<section class="card">
      <h2 class="h2">Challenges <span class="muted">· ${list.length}</span></h2>
      ${list.length
        ? html`<details class="details">
            <summary>Peek at the pool (${need} will be picked at random)</summary>
            <ul class="pool">${list.map((c) => html`<li>${c}</li>`)}</ul>
          </details>`
        : html`<p class="muted small">The host is still adding challenges.</p>`}
    </section>`;
  }

  const short = Math.max(0, need - parsed.length);
  const emptyTeams = [...Array(settings.teamCount)].filter((_, i) => !data.players.some((p) => p.team === i)).length;
  const unassigned = data.players.filter((p) => p.team == null || p.team >= settings.teamCount).length;
  return html`<section class="card">
    <div class="card-head">
      <h2 class="h2">Challenges</h2>
      <span class=${`count ${short ? 'warn' : 'ok'}`}>${parsed.length} / ${need}</span>
    </div>
    <p class="hint">One per line. Paste as many as you want — ${need} get picked at random each game.</p>
    <textarea class="textarea" rows="9" placeholder=${'Find a bald person\nWin a race\nLift 10,000 lbs\nSerenade a stranger\n…'}
      value=${draft} onInput=${(e) => update(e.currentTarget.value)}></textarea>
    <div class="row wrap">
      <button class="btn ghost small" onClick=${() => setPacksOpen(true)}>+ Add a pack</button>
      <button class="btn ghost small" onClick=${savePack} disabled=${!parsed.length}>Save as pack</button>
      ${draft && html`<button class="btn ghost small" onClick=${() => confirm('Clear all challenges?') && update('')}>Clear</button>`}
    </div>
    <div class="dock">
      ${short > 0
        ? html`<p class="dock-note">Add ${short} more challenge${short === 1 ? '' : 's'} to start</p>`
        : emptyTeams - Math.min(emptyTeams, unassigned) > 0
        ? html`<p class="dock-note">Heads up: ${emptyTeams} team${emptyTeams === 1 ? ' has' : 's have'} nobody on it</p>`
        : null}
      <button class="btn big go" onClick=${start} disabled=${short > 0 || starting}>${starting ? 'Starting…' : 'Start game'}</button>
    </div>

    <${Sheet} open=${packsOpen} onClose=${() => setPacksOpen(false)} title="Challenge packs">
      <div class="list">
        ${PACKS.map(
          (p) => html`<div class="pack">
            <div class="grow"><b>${p.name}</b><p class="muted small">${p.items.length} challenges · ${p.items.slice(0, 3).join(' · ')}…</p></div>
            <button class="btn small" onClick=${() => addPack(p.items)}>Add</button>
          </div>`
        )}
        ${saved.length > 0 && html`<h4 class="eyebrow">Your saved packs</h4>`}
        ${saved.map(
          (p) => html`<div class="pack">
            <div class="grow"><b>${p.name}</b><p class="muted small">${p.items.length} challenges</p></div>
            <button class="btn small" onClick=${() => addPack(p.items, true)}>Use</button>
          </div>`
        )}
      </div>
    </${Sheet}>
  </section>`;
}
