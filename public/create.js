import { api, h, $, fmtWhen, range } from '/static/common.js';

const form = $('#create');
const min = $('#min');
const max = $('#max');

// Steppers: "At most" may be empty (no limit) and never drops below "At least".
for (const btn of form.querySelectorAll('[data-step]')) {
  btn.addEventListener('click', () => {
    const input = btn.parentElement.querySelector('input');
    const step = Number(btn.dataset.step);
    if (input === max) {
      const floor = Number(min.value) || 1;
      if (!max.value) return step > 0 && (max.value = floor);
      const next = Number(max.value) + step;
      max.value = next < floor ? '' : Math.min(200, next);
    } else {
      min.value = Math.min(200, Math.max(1, (Number(min.value) || 0) + step));
      if (max.value && Number(max.value) < Number(min.value)) max.value = min.value;
    }
  });
}

// Suggest an end three hours after the start, unless one was picked already.
const when = $('#when');
const end = $('#end');
when.addEventListener('change', () => {
  if (!when.value || (end.value && end.value > when.value)) return;
  const d = new Date(when.value);
  d.setHours(d.getHours() + 3);
  const pad = (n) => String(n).padStart(2, '0');
  end.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    const { adminToken } = await api('POST', '/api/events', data);
    location.href = `/a/${adminToken}?new=1`;
  } catch (err) {
    $('#error').textContent = err.message;
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- all events

function eventRow(ev) {
  const when = fmtWhen(ev.when);
  const on = ev.going >= ev.min;
  return h(
    'li',
    {},
    h(
      'a',
      { href: `/a/${ev.adminToken}` },
      h('span', { class: 'ev-title' }, ev.title, h('small', {}, when ? `${when.short} · ${when.relative || when.time}` : 'No date')),
      h('span', { class: on ? 'on' : '' }, `${ev.going}/${range(ev.min, ev.max)}`),
    ),
  );
}

$('#logout').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('POST', '/api/logout');
  location.reload();
});

try {
  const list = await api('GET', '/api/events');
  if (list.length) {
    const now = new Date();
    const isPast = (ev) => ev.when && new Date(ev.end || ev.when) < now;
    const byWhen = (a, b) => (a.when || '9999').localeCompare(b.when || '9999');
    const upcoming = list.filter((ev) => !isPast(ev)).sort(byWhen);
    const past = list.filter(isPast).sort((a, b) => byWhen(b, a));
    $('#upcoming').append(...upcoming.map(eventRow));
    if (!upcoming.length) $('#upcoming').append(h('li', { class: 'muted small' }, 'Nothing coming up.'));
    if (past.length) {
      $('#past').append(...past.map(eventRow));
      $('#past-wrap').classList.remove('hidden');
    }
    $('#events-card').classList.remove('hidden');
    form.classList.add('hidden');
    $('#new-event').addEventListener('click', () => {
      form.classList.toggle('hidden');
      if (!form.classList.contains('hidden')) {
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('#title').focus({ preventScroll: true });
      }
    });
  }
} catch (e) {
  if (e.status === 401) location.reload();
}
