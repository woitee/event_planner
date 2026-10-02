export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
  return data;
}

/** Tiny DOM builder: h('div', { class: 'x', onclick }, 'text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only for trusted static markup (icons)
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// ---------------------------------------------------------------- dates

export const parseWhen = (when) => (when ? new Date(when) : null);

const hhmm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Formats start (and optional end) for display; `time` is e.g. "19:00–23:00" or "19:00 – Sat 01:00". */
export function fmtWhen(when, end) {
  const d = parseWhen(when);
  if (!d || Number.isNaN(+d)) return null;
  const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  let time = hhmm(d);
  const e = parseWhen(end);
  if (e && e > d) {
    const sameDay = e.toDateString() === d.toDateString();
    const nextDay = !sameDay && e - d < 86400000;
    if (sameDay) time += `–${hhmm(e)}`;
    else if (nextDay) time += ` – ${e.toLocaleDateString('en-GB', { weekday: 'short' })} ${hhmm(e)}`;
    else time += ` – ${e.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${hhmm(e)}`;
  }
  return { date, time, relative: relative(d), short: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) };
}

/** "4", "4–6", "4+" */
export const range = (min, max) => (max == null ? `${min}+` : max === min ? `${min}` : `${min}–${max}`);

function relative(d) {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((day(d) - day(new Date())) / 86400000);
  if (days === 0) return d < new Date() ? 'earlier today' : 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1 && days < 7) return `in ${days} days`;
  if (days >= 7 && days < 60) return `in ${Math.round(days / 7)} week${days >= 11 ? 's' : ''}`;
  if (days < 0) return 'past';
  return '';
}

// ---------------------------------------------------------------- people

export function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

export function hue(name) {
  let x = 0;
  for (const ch of name.toLowerCase()) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return x % 360;
}

export const avatar = (name, extraClass = '') =>
  h('span', { class: `seat ${extraClass}`, style: `background: hsl(${hue(name)} 42% 48%)`, title: name }, initials(name));

/** Row of seats: initials for those going, dashed for spots still needed, faint for optional spots up to max. */
export function seats(going, min, max) {
  const total = Math.max(min, max ?? 0, going.length);
  if (total > 24) return null; // the bar is enough for big groups
  const list = h('ul', { class: 'seats', 'aria-hidden': 'true' });
  going.forEach((name) => list.append(h('li', {}, avatar(name))));
  for (let i = going.length; i < total; i++) {
    list.append(h('li', {}, h('span', { class: `seat empty ${i >= min ? 'optional' : ''}` }, i < min ? String(i + 1) : '')));
  }
  return list;
}

export function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------- ui

let toastTimer;
export function toast(msg) {
  let el = $('.toast');
  if (!el) document.body.append((el = h('div', { class: 'toast', role: 'status' })));
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

export async function copy(text, msg = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs https; fall back for plain-http LAN use.
    const ta = h('textarea', { style: 'position:fixed;opacity:0', readonly: true });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

/** Native share sheet on phones, clipboard elsewhere. */
export async function share(url, text) {
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.share) {
    try {
      await navigator.share({ text: `${text}\n${url}` });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  copy(url, 'Link copied');
}

/** Re-run fn periodically while the tab is visible. */
export function poll(fn, ms = 15000) {
  setInterval(() => document.visibilityState === 'visible' && fn(), ms);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && fn());
}

// ---------------------------------------------------------------- calendar

const icsDate = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T` +
  `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
const icsText = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');

export function downloadIcs({ title, start, end, hours = 3, location, description, filename }) {
  end ||= new Date(+start + hours * 3600000);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//event-planner//EN', 'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@event-planner`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(title)}`,
    location ? `LOCATION:${icsText(location)}` : null,
    description ? `DESCRIPTION:${icsText(description)}` : null,
    'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })), download: filename || 'event.ics' });
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------- icons

export const icons = {
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 9-9M17 6l3 3M14.5 8.5l2 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>',
};
export const icon = (name) => h('span', { html: icons[name], style: 'display:contents' });
