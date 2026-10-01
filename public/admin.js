import { api, h, $, fmtWhen, range, avatar, icon, poll, copy, share, toast } from '/static/common.js';

const app = $('#app');
const token = location.pathname.split('/').pop();
const base = `/api/admin/${token}`;
let ev;

const isNew = new URLSearchParams(location.search).has('new');
if (isNew) history.replaceState(null, '', location.pathname);

const STATUS = {
  yes: { label: 'In', order: 0 },
  later: { label: 'Later', order: 1 },
  pending: { label: 'Invited', order: 2 },
  no: { label: 'Out', order: 3 },
};
const SOURCE = { invite: 'own link', link: 'shared link', manual: 'added by you' };

const genericUrl = () => `${location.origin}/${ev.code}`;
const personalUrl = (p) => `${location.origin}/i/${p.token}`;
const count = (s) => ev.people.filter((p) => p.status === s).length;

function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------------------------------------------------------------- sections

function newNotice() {
  const adminUrl = location.origin + location.pathname;
  return h(
    'div',
    { class: 'notice' },
    icon('key'),
    h(
      'div',
      {},
      h('strong', {}, 'This link manages this event without a password. '),
      'Hand it to a co-organizer if you like. You can always get back here from All events with the master password.',
      h('div', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => copy(adminUrl, 'Organizer link copied') }, icon('copy'), 'Copy organizer link')),
    ),
  );
}

function summary() {
  const when = fmtWhen(ev.when, ev.end);
  const yes = count('yes');
  const pct = Math.min(100, (yes / ev.min) * 100);
  const over = ev.max != null && yes > ev.max;
  return h(
    'section',
    { class: 'card', id: 'summary' },
    h('h1', {}, ev.title),
    h(
      'ul',
      { class: 'meta' },
      when && h('li', {}, icon('calendar'), h('span', {}, `${when.date} · ${when.time} `, when.relative && h('span', { class: 'rel' }, `· ${when.relative}`))),
      ev.where && h('li', {}, icon('pin'), h('span', {}, ev.where)),
      h('li', {}, icon('people'), h('span', {}, ev.max == null ? `At least ${ev.min} people` : `${range(ev.min, ev.max)} people`)),
    ),
    h(
      'div',
      { class: 'stats' },
      h('div', { class: 'stat yes' }, h('b', {}, `${yes}/${ev.min}`), h('span', {}, ev.max != null && yes >= ev.max ? 'In · full' : 'In')),
      h('div', { class: 'stat later' }, h('b', {}, String(count('later'))), h('span', {}, 'Later')),
      h('div', { class: 'stat pending' }, h('b', {}, String(count('pending'))), h('span', {}, 'No answer')),
      h('div', { class: 'stat no' }, h('b', {}, String(count('no'))), h('span', {}, 'Out')),
    ),
    h('div', { class: 'bar' }, h('span', { style: `width:${pct}%` })),
    over && h('p', { class: 'hint', style: 'color:var(--later)' }, `${yes - ev.max} over the maximum of ${ev.max}.`),
  );
}

function shareCard() {
  const url = genericUrl();
  const input = h('input', { value: url.replace(/^https?:\/\//, ''), readonly: true, onfocus: (e) => e.target.select(), 'aria-label': 'Shared link' });
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Shared link'),
    h('p', { class: 'hint' }, 'Post it in a group chat. People type their name and answer.'),
    h(
      'div',
      { class: 'linkbox' },
      input,
      h('button', { class: 'btn', type: 'button', onclick: () => share(url, `${ev.title}: are you in?`) }, icon('share'), 'Share'),
    ),
    h(
      'p',
      { class: 'hint' },
      'Or ',
      h('a', { href: url, target: '_blank', style: 'color:var(--accent)' }, 'open it'),
      ' to see what guests see.',
    ),
  );
}

function personRow(p) {
  const select = h(
    'select',
    {
      class: `s-${p.status}`,
      'aria-label': `Status for ${p.name}`,
      onchange: (e) => {
        if (e.target.value !== 'remove') return update(p, { status: e.target.value });
        e.target.value = p.status;
        remove(p);
      },
    },
    ...Object.entries(STATUS).map(([value, s]) => h('option', { value, selected: p.status === value }, s.label)),
    h('option', { disabled: true }, '────'),
    h('option', { value: 'remove' }, 'Remove…'),
  );
  const nudge = p.status === 'yes' ? `${ev.title}: here’s your link` : `Hey ${p.name}, are you in for ${ev.title}?`;
  return h(
    'li',
    { class: 'person', id: `p-${p.id}` },
    avatar(p.name),
    h('div', { class: 'who' }, h('div', { class: 'name' }, p.name), h('div', { class: 'sub' }, `${SOURCE[p.source] || ''} · ${ago(p.respondedAt)}`)),
    h(
      'div',
      { class: 'actions' },
      select,
      h('button', { class: 'btn ghost icon', type: 'button', title: 'Share personal link', 'aria-label': `Share link for ${p.name}`, onclick: () => share(personalUrl(p), nudge) }, icon('share')),
    ),
  );
}

function peopleList() {
  const people = [...ev.people].sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || a.respondedAt.localeCompare(b.respondedAt));
  return people.length
    ? h('ul', { class: 'people', id: 'people' }, people.map(personRow))
    : h('p', { class: 'empty-state', id: 'people' }, 'No one yet. Share the link, or add people above.');
}

function peopleCard() {
  const name = h('input', { placeholder: 'Name', maxlength: 60, 'aria-label': 'Name', autocomplete: 'off', enterkeyhint: 'go' });
  const add = async (status) => {
    const value = name.value.trim();
    if (!value) return name.focus();
    try {
      ev = await api('POST', `${base}/people`, { name: value, status });
      name.value = '';
      refresh();
      const p = ev.people[ev.people.length - 1];
      if (status === 'pending') copy(personalUrl(p), `Invite link for ${p.name} copied`);
      else toast(`${p.name} added as in`);
    } catch (e) {
      toast(e.message);
    }
  };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && add('pending'));
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'People'),
    h('p', { class: 'hint' }, 'Create a personal link (their name is pre-filled, one tap to answer), or mark someone as in if they told you directly.'),
    h(
      'div',
      { class: 'add-row' },
      name,
      h('button', { class: 'btn primary', type: 'button', onclick: () => add('pending') }, 'Create invite link'),
      h('button', { class: 'btn', type: 'button', onclick: () => add('yes') }, 'Add as in'),
    ),
    peopleList(),
  );
}

function editCard() {
  const field = (label, input) => {
    input.id = `edit-${input.name}`;
    return h('div', { class: 'field' }, h('label', { for: input.id }, label), input);
  };
  const f = {
    title: h('input', { name: 'title', value: ev.title, maxlength: 120, required: true }),
    when: h('input', { name: 'when', type: 'datetime-local', value: ev.when || '' }),
    end: h('input', { name: 'end', type: 'datetime-local', value: ev.end || '' }),
    min: h('input', { name: 'min', type: 'number', inputmode: 'numeric', min: 1, max: 200, value: ev.min, required: true }),
    max: h('input', { name: 'max', type: 'number', inputmode: 'numeric', min: 1, max: 200, value: ev.max ?? '', placeholder: 'Any' }),
    where: h('input', { name: 'where', value: ev.where || '', maxlength: 200 }),
    description: h('textarea', { name: 'description', maxlength: 2000 }),
  };
  f.description.value = ev.description || '';

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          ev = await api('PATCH', base, Object.fromEntries(new FormData(e.target)));
          refresh();
          toast('Saved');
        } catch (err) {
          toast(err.message);
        }
      },
    },
    field('Name', f.title),
    h('div', { class: 'row stack-sm' }, field('Starts', f.when), field('Ends', f.end)),
    h('div', { class: 'row' }, field('At least', f.min), field('At most', f.max)),
    field('Where', f.where),
    field('Note', f.description),
    h('button', { class: 'btn primary block', type: 'submit', style: 'margin-top:18px' }, 'Save changes'),
  );
  return h('details', { class: 'card' }, h('summary', {}, 'Edit details'), form);
}

function dangerZone() {
  return h(
    'div',
    { class: 'center', style: 'margin-top:24px' },
    h(
      'button',
      {
        class: 'btn ghost danger sm',
        type: 'button',
        onclick: async () => {
          if (!confirm(`Delete “${ev.title}” for everyone? This can’t be undone.`)) return;
          await api('DELETE', base);
          location.href = '/';
        },
      },
      icon('trash'),
      'Delete event',
    ),
  );
}

// ---------------------------------------------------------------- actions

async function update(p, patch) {
  try {
    ev = await api('PATCH', `${base}/people/${p.id}`, patch);
    refresh();
  } catch (e) {
    toast(e.message);
  }
}

async function remove(p) {
  if (!confirm(`Remove ${p.name}? Their personal link will stop working.`)) return;
  try {
    ev = await api('DELETE', `${base}/people/${p.id}`);
    refresh();
  } catch (e) {
    toast(e.message);
  }
}

/** Update the live parts without touching forms the organizer may be typing in. */
function refresh() {
  document.title = `${ev.title} · Organizer`;
  $('#summary').replaceWith(summary());
  $('#people').replaceWith(peopleList());
}

// ---------------------------------------------------------------- boot

try {
  ev = await api('GET', base);
  document.title = `${ev.title} · Organizer`;
  app.replaceChildren(app.firstElementChild, isNew ? newNotice() : '', summary(), shareCard(), peopleCard(), editCard(), dangerZone());
  poll(async () => {
    try {
      ev = await api('GET', base);
      refresh();
    } catch {}
  });
} catch {
  app.replaceChildren(app.firstElementChild, h('div', { class: 'card center' }, h('h1', {}, 'Event not found'), h('p', { class: 'muted' }, 'This organizer link doesn’t match any event.')));
}
