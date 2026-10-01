import { api, h, $, fmtWhen, loadRecent, saveRecent } from '/static/common.js';

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
    saveRecent([{ adminToken, title: data.title, when: data.when }, ...loadRecent()]);
    location.href = `/a/${adminToken}?new=1`;
  } catch (err) {
    $('#error').textContent = err.message;
    btn.disabled = false;
  }
});

const recent = loadRecent();
if (recent.length) {
  $('#recent-card').classList.remove('hidden');
  $('#recent').append(
    ...recent.map((r) =>
      h('li', {}, h('a', { href: `/a/${r.adminToken}` }, h('span', {}, r.title), h('span', {}, fmtWhen(r.when)?.short || ''))),
    ),
  );
}
