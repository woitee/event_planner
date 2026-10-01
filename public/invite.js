import { api, h, $, fmtWhen, parseWhen, range, seats, joinNames, icon, poll, downloadIcs, toast } from '/static/common.js';

const app = $('#app');
let mode; // 'personal' | 'generic'
let key; // invite token or short code
let data;
let busy = false;

function route() {
  const personal = location.pathname.match(/^\/i\/([\w-]+)$/);
  if (personal) [mode, key] = ['personal', personal[1]];
  else [mode, key] = ['generic', location.pathname.slice(1)];
}

const meKey = (code) => `ep:me:${code}`;
function remember(code, token) {
  try {
    localStorage.setItem(meKey(code), token);
  } catch {}
}
function remembered(code) {
  try {
    return localStorage.getItem(meKey(code));
  } catch {
    return null;
  }
}

async function load() {
  return api('GET', mode === 'personal' ? `/api/i/${key}` : `/api/e/${key}`);
}

// ---------------------------------------------------------------- render

function header(d) {
  const when = fmtWhen(d.when, d.end);
  return [
    h('p', { class: 'eyebrow' }, d.me ? `Hi ${d.me.name}, you’re invited` : 'You’re invited'),
    h('h1', {}, d.title),
    h(
      'ul',
      { class: 'meta' },
      when && h('li', {}, icon('calendar'), h('span', {}, `${when.date} · ${when.time} `, when.relative && h('span', { class: 'rel' }, `· ${when.relative}`))),
      d.where && h('li', {}, icon('pin'), h('span', {}, d.where)),
    ),
    d.description && h('p', { class: 'description' }, d.description),
  ];
}

const isFull = (d) => d.max != null && d.going.length >= d.max;

function seatsBlock(d) {
  const n = d.going.length;
  const left = Math.max(0, d.min - n);
  const spots = d.max == null ? null : Math.max(0, d.max - n);
  const pct = Math.min(100, (n / (d.max ?? d.min)) * 100);
  let note;
  if (left) note = `${left} more needed`;
  else if (spots === 0) note = 'It’s on · full';
  else if (spots != null) note = `It’s on · ${spots} spot${spots === 1 ? '' : 's'} left`;
  else note = 'It’s on';
  return h(
    'div',
    { id: 'seats' },
    h(
      'div',
      { class: 'seats-head' },
      h('span', { class: 'seats-count' }, String(n), h('span', { class: 'of' }, ` of ${range(d.min, d.max)}`)),
      h('span', { class: `small ${left ? 'muted' : 'on'}` }, note),
    ),
    seats(d.going, d.min, d.max) || h('div', { class: 'bar' }, h('span', { style: `width:${pct}%` })),
    h('p', { class: 'names' }, n ? `${joinNames(d.going)} ${n === 1 ? 'is' : 'are'} in.` : 'Nobody yet. Be the first!'),
  );
}

function answerButtons(d) {
  const status = d.me?.status;
  const closed = status !== 'yes' && isFull(d);
  const btn = (s, label, cls, disabled) =>
    h('button', { class: `btn block ${cls} ${status === s ? 'chosen' : ''}`, 'data-status': s, type: 'button', disabled, onclick: () => respond(s) }, label);
  return h(
    'div',
    { class: `answers ${status && status !== 'pending' ? 'answered' : ''}` },
    btn('yes', status === 'yes' ? 'You’re in ✓' : closed ? 'It’s full' : 'I’m in', 'primary big', closed),
    h('div', { class: 'pair' }, btn('later', 'Remind me later', ''), btn('no', 'Can’t make it', '')),
  );
}

function resultBlock(d) {
  const s = d.me?.status;
  if (!s || s === 'pending') return null;
  const start = parseWhen(d.when);
  const link = location.origin + (d.me.token ? `/i/${d.me.token}` : location.pathname);

  if (s === 'yes') {
    return h(
      'div',
      { class: 'result' },
      h('strong', {}, 'See you there!'),
      start
        ? h('a', { href: '#', onclick: (e) => (e.preventDefault(), downloadIcs({ title: d.title, start, end: parseWhen(d.end), location: d.where, description: `${d.description || ''}\n\n${link}`.trim(), filename: 'event.ics' })) }, 'Add to calendar')
        : h('span', { class: 'muted' }, 'Plans changed? Tap another answer anytime.'),
    );
  }
  if (s === 'later') {
    return h(
      'div',
      { class: 'result' },
      h('strong', {}, 'No rush.'),
      h('span', { class: 'muted' }, 'Come back to this link when you know. '),
      h('a', { href: '#', onclick: (e) => (e.preventDefault(), setReminder(d, link)) }, 'Set a calendar reminder'),
    );
  }
  return h('div', { class: 'result' }, h('strong', {}, 'Maybe next time.'), h('span', { class: 'muted' }, 'Changed your mind? Just tap above.'));
}

function setReminder(d, link) {
  // Tomorrow 10:00, or in two hours if the event is sooner than that.
  const at = new Date();
  at.setDate(at.getDate() + 1);
  at.setHours(10, 0, 0, 0);
  const start = parseWhen(d.when);
  if (start && start - at < 6 * 3600000) at.setTime(Date.now() + 2 * 3600000);
  downloadIcs({ title: `Reply: ${d.title}`, start: at, hours: 0.25, description: `Are you in? ${link}`, filename: 'reminder.ics' });
}

let nameInput;
function render() {
  const d = data;
  const generic = mode === 'generic';
  nameInput ||= h('input', { id: 'name', placeholder: 'Your name', autocomplete: 'given-name', maxlength: 60, enterkeyhint: 'done' });
  app.replaceChildren(
    h(
      'div',
      { class: 'card' },
      ...header(d),
      h('hr', { class: 'divider' }),
      seatsBlock(d),
      generic && h('div', { class: 'field', style: 'margin-top:22px' }, h('label', { for: 'name' }, 'Your name'), nameInput),
      answerButtons(d),
      h('p', { class: 'error', id: 'error' }),
      resultBlock(d),
    ),
  );
}

async function respond(status) {
  if (busy) return;
  const err = $('#error');
  let body = { status };
  if (mode === 'generic') {
    const name = nameInput.value.trim();
    if (!name) {
      err.textContent = 'Add your name first.';
      nameInput.focus();
      return;
    }
    body.name = name;
  }
  busy = true;
  try {
    data = await api('POST', mode === 'personal' ? `/api/i/${key}/respond` : `/api/e/${key}/respond`, body);
    if (mode === 'generic' && data.me?.token) {
      // From now on this browser uses the personal link, so the answer can be changed.
      remember(data.code, data.me.token);
      history.replaceState(null, '', `/i/${data.me.token}`);
      route();
    }
    render();
    if (status === 'yes' && data.going.length === data.min) toast('That makes it happen. It’s on!');
  } catch (e) {
    err.textContent = e.message;
    if (e.status === 409) load().then((d) => ((data = d), render())).catch(() => {});
  } finally {
    busy = false;
  }
}

// ---------------------------------------------------------------- boot

route();
if (mode === 'generic') {
  const token = remembered(key);
  if (token) {
    location.replace(`/i/${token}`);
    throw new Error('redirecting');
  }
}

try {
  data = await load();
  document.title = data.title;
  render();
  poll(async () => {
    try {
      const fresh = await load();
      const fullChanged = isFull(fresh) !== isFull(data);
      data = fresh;
      if (fullChanged) render(); // the I'm-in button needs to (un)lock
      else $('#seats')?.replaceWith(seatsBlock(data));
    } catch {}
  });
} catch (e) {
  if (e.status === 401) location.reload();
  // A remembered personal link that no longer exists → forget it, fall back to the generic link.
  if (mode === 'personal') {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('ep:me:') && localStorage.getItem(k) === key) {
          localStorage.removeItem(k);
          location.replace(`/${k.slice(6)}`);
        }
      }
    } catch {}
  }
  app.replaceChildren(h('div', { class: 'card center' }, h('h1', {}, 'Invite not found'), h('p', { class: 'muted' }, 'This link may be mistyped, or the event was removed.')));
}
