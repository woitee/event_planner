# Event planner

Tiny, zero-dependency event planner for things that need a certain number of people to happen (board game night, five-a-side, escape room).

Each event has a **minimum** (it's on once that many say yes) and an optional **maximum** (sign-ups close when it's reached; the organizer can still add people manually), plus a start and an optional end time.

## Run

```bash
cp .env.example .env   # then set ADMIN_PASSWORD
npm start              # http://localhost:3000
```

Needs Node 22+. No `npm install`; there are no dependencies. Data lives in `data/db.json`.

## How it works

| URL | Who | Auth |
|---|---|---|
| `/` | organizers: all events + create new | master password (`ADMIN_PASSWORD`) |
| `/a/<token>` | organizer view | the link itself (keep it private) |
| `/<code>` (e.g. `/k7m2qx9fbt`) | generic invite, guest types their name | the link itself |
| `/i/<token>` | personal invite, name pre-filled, one tap | the link itself |

- **Organizer:** share the generic link, create personal invite links, add people who said yes elsewhere, change anyone's status, and edit or delete the event.
- **Guests:** see what, when and where, who's in, and how many more are needed. They answer **I'm in**, **Remind me later**, or **Can't make it**. *Later* offers a calendar reminder (.ics). *I'm in* offers an "add to calendar" link.
- After answering via the generic link, the guest's browser switches to their own personal link, so they can change their answer later.
- Pages refresh every 15s while open.

## Deploying

Run it behind any HTTPS reverse proxy (Caddy, nginx) or on a small VM/Fly.io/Railway with a persistent volume mounted at `DATA_DIR`. HTTPS matters: it enables the clipboard API, and the auth cookie travels in clear text otherwise.
