# Lumen

A full-stack video conferencing app: users register/log in, get a shareable meeting code, and join a peer-to-peer WebRTC video call with live chat and screen sharing. Meeting history is tracked per user.

This README is meant to be self-sufficient — a reader (human or agent) should be able to understand the entire system, its contracts, and its known rough edges without opening the source first.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19, Vite, React Router 7, MUI 9, Axios, Socket.IO client |
| Backend | Node.js (ESM), Express 4, Socket.IO 4, Mongoose 8 (MongoDB) |
| Auth | Custom — bcrypt-hashed passwords, opaque random session tokens stored in `localStorage` |
| Video | WebRTC (`RTCPeerConnection`), STUN-only (Google's public STUN server), signaling relayed over Socket.IO |

No TypeScript, no state management library (React Context only), no test suite currently exists.

## Repository layout

```
lumen-meet/
├── package.json              # root: `npm run dev` runs both apps via concurrently
├── LICENSE                   # MIT
├── backend/
│   ├── .env.example          # PORT, MONGO_URI, CLIENT_ORIGIN
│   ├── package.json
│   └── src/
│       ├── app.js                        # Express app entry, boots HTTP + Socket.IO server
│       ├── controllers/
│       │   ├── user.controller.js        # login / register / history handlers
│       │   └── socketManager.js          # all Socket.IO event handling (signaling, chat, presence)
│       ├── models/
│       │   ├── user.model.js             # User schema (name, username, password hash, token)
│       │   └── meeting.model.js          # Meeting schema (user_id, meetingCode, date)
│       └── routes/
│           └── users.routes.js           # /api/v1/users/* route wiring
└── frontend/
    ├── .env.example           # VITE_API_URL
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx            # ReactDOM root
        ├── App.jsx             # React Router route table
        ├── App.css             # Landing + Home page styles (global, not module-scoped)
        ├── index.css           # App-wide resets/fonts
        ├── config/api.js       # Reads VITE_API_URL, exported as the backend base URL
        ├── context/AuthContext.jsx  # Axios client + auth/history API calls, exposed via React Context
        ├── utils/withAuth.jsx  # HOC: redirects to /auth if no token in localStorage
        ├── pages/
        │   ├── Landing.jsx      # "/" — marketing page, links to /auth
        │   ├── Authentication.jsx  # "/auth" — login + register form (MUI)
        │   ├── Home.jsx          # "/home" — enter/create a meeting code (wrapped in withAuth)
        │   ├── History.jsx       # "/history" — past meetings list (wrapped in withAuth)
        │   └── MeetingRoom.jsx   # "/:url" — the actual video call room (catch-all route)
        ├── styles/meetingRoom.module.css  # CSS module for MeetingRoom only
        └── assets/               # background.png, mobile.png, hero-illustration.png
```

## How it fits together (request/data flow)

1. **Register/Login** (`Authentication.jsx` → `AuthContext` → `POST /api/v1/users/register` or `/login`) — on success, `login` returns an opaque token that the frontend stores in `localStorage["token"]`. There is no refresh flow and no expiry; the token is valid until a user logs in again (each login overwrites `user.token` in Mongo, invalidating the previous token).
2. **Route protection** — `Home.jsx` and `History.jsx` are wrapped in `withAuth()`, a HOC that checks `localStorage["token"]` on mount and redirects to `/auth` if it's missing. This is client-side-only gating; the backend does **not** verify the token on `/get_all_activity` or `/add_to_activity` beyond looking up a matching user (see [Known gaps](#known-gaps-security--correctness)).
3. **Starting/joining a call** — on `Home.jsx`, the user types a meeting code (any arbitrary string) and clicks Join. This calls `addToUserHistory(code)` (`POST /add_to_activity`) then navigates to `/${code}`, which matches the catch-all `<Route path="/:url">` and renders `MeetingRoom.jsx`. There's no concept of "creating" vs "joining" a meeting server-side — the room is just whatever string is in the URL; anyone who knows/guesses the code can join.
4. **The call itself (`MeetingRoom.jsx`)** — a manual mesh-topology WebRTC implementation:
   - Connects to the backend's Socket.IO server (`VITE_API_URL`) and emits `join-call` with `window.location.href` as the room identifier (i.e. the room key includes the full URL, not just the code).
   - The server (`socketManager.js`) tracks `connections[roomKey] = [socketId, ...]` in memory and broadcasts `user-joined` to everyone in the room, including the list of existing socket IDs.
   - Each client creates one `RTCPeerConnection` per other participant, exchanges SDP offers/answers and ICE candidates via the `signal` event (relayed peer-to-peer through the server, not stored), and attaches local media via the **deprecated** `addStream`/`onaddstream` APIs (see [Known gaps](#known-gaps-security--correctness)).
   - Chat messages (`chat-message` event) are broadcast to everyone currently in the sender's room and also buffered in an in-memory `messages[roomKey]` array so a client who joins later receives the room's chat history — but this is lost on server restart (nothing is persisted to Mongo).
5. **History** (`History.jsx`) fetches `GET /get_all_activity?token=...` and lists `{ meetingCode, date }` for the logged-in user.

## Backend API contract

Base path: `/api/v1/users` (mounted in `backend/src/app.js`).

| Method | Path | Body / Query | Success | Failure |
| --- | --- | --- | --- | --- |
| POST | `/register` | body: `{ name, username, password }` | `201 { message }` | `400` missing fields, `409` username taken |
| POST | `/login` | body: `{ username, password }` | `200 { token }` — also persists `token` on the user document | `400` missing fields, `404` no such user, `401` wrong password |
| POST | `/add_to_activity` | body: `{ token, meeting_code }` | `201 { message }` | `401` token doesn't match any user |
| GET | `/get_all_activity` | query: `?token=...` | `200 [{ user_id, meetingCode, date, _id }, ...]` | `401` token doesn't match any user |

All handlers return `500 { message }` on unexpected errors (`user.controller.js`). Passwords are hashed with `bcryptjs` (10 salt rounds); tokens are `crypto.randomBytes(20).toString("hex")` — random, but **never expire and aren't re-checked against any expiry**, so treat them as long-lived bearer tokens, not session tokens.

## Socket.IO protocol (`backend/src/controllers/socketManager.js`)

State is entirely in-memory (`connections`, `messages`, `timeOnline` objects) — restarting the backend drops all active rooms and chat history.

| Event | Direction | Payload | Behavior |
| --- | --- | --- | --- |
| `join-call` | client → server | `path` (room key, currently `window.location.href`) | Adds the socket to `connections[path]`, broadcasts `user-joined(socketId, allSocketIdsInRoom)` to everyone in the room, replays any buffered chat history to the joining socket only |
| `signal` | client ↔ server | `(toSocketId, message)` | Pure relay: server re-emits `signal(fromSocketId, message)` to `toSocketId`. `message` is a JSON string of `{ sdp }` or `{ ice }` |
| `chat-message` | client → server | `(data, sender)` | Server looks up which room the sender's socket belongs to, appends to that room's message buffer, and broadcasts `chat-message(data, sender, senderSocketId)` to the whole room |
| `user-left` | server → client | `socketId` | Emitted to all remaining room members when someone disconnects |
| `disconnect` | client → server (built-in) | — | Server removes the socket from whichever room it was in and emits `user-left` to the rest of that room; deletes the room entry if it's now empty |

There is no room capacity limit, no rate limiting, and no persistence — this is intentionally a minimal signaling layer, not a full SFU/MCU (which would be needed to scale past a handful of participants per room, since every peer connects directly to every other peer).

## Data models

**User** (`backend/src/models/user.model.js`)
```js
{ name: String (required), username: String (required, unique), password: String (required, bcrypt hash), token: String }
```

**Meeting** (`backend/src/models/meeting.model.js`)
```js
{ user_id: String (the owning user's username, not a Mongo ref), meetingCode: String (required), date: Date (default: now) }
```

Note `user_id` stores the *username string*, not an `ObjectId` reference to the `User` collection — there's no `populate`-able relationship.

## Environment variables

**`backend/.env`** (copy from `backend/.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8000` | HTTP/Socket.IO listen port |
| `MONGO_URI` | *(required, no default — server throws and exits if unset)* | MongoDB connection string |
| `CLIENT_ORIGIN` | `*` | Allowed CORS origin for both the Express API and Socket.IO |

**`frontend/.env`** (copy from `frontend/.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8000` | Base URL the frontend uses for both REST calls (`/api/v1/users/*`) and the Socket.IO connection |

## Running locally

```bash
cp backend/.env.example backend/.env    # fill in MONGO_URI
cp frontend/.env.example frontend/.env  # defaults to localhost:8000, fine for local dev

npm install            # installs root devDependency (concurrently)
npm run install:all    # installs backend/ and frontend/ dependencies
npm run dev            # runs both apps together (backend :8000, frontend :5173)
```

Or run each independently: `cd backend && npm install && npm run dev` / `cd frontend && npm install && npm run dev`.

`npm run build` in `frontend/` produces a static `dist/` (deploy anywhere that serves static files + rewrites all paths to `index.html`, since routing is client-side). The backend has no build step — `npm start` runs it directly with Node.

## Known gaps (security / correctness)

These are pre-existing tradeoffs in the current implementation, not accidental bugs — listed so a future contributor (or agent) doesn't need to rediscover them by reading every file:

- **Bearer tokens never expire** and there's no logout-everywhere/revoke endpoint (logging in again overwrites the old token, which is the only implicit invalidation).
- **No server-side authorization beyond "does this token match a user"** — `/get_all_activity` and `/add_to_activity` don't distinguish between session validity and identity in any stronger way (no JWT, no expiry claim, no refresh).
- **Meeting rooms have no access control** — any client that knows/guesses a meeting code URL can join; there's no host/participant distinction, no waiting room, no kick capability.
- **WebRTC uses the deprecated `addStream`/`onaddstream` API pair** instead of `addTrack`/`ontrack`. It still works in current Chrome/Firefox/Safari but is removed from the spec; migrating requires care and live multi-browser testing since track-level renegotiation behaves differently.
- **STUN only, no TURN server configured** — calls between peers on restrictive/symmetric NATs (common on corporate networks or some mobile carriers) may fail to establish a direct connection. Adding a TURN server (e.g. coturn, or a managed provider) would fix this.
- **In-memory signaling state** — `connections`/`messages`/`timeOnline` in `socketManager.js` live only in the Node process's memory. Multiple backend instances (e.g. behind a load balancer) would each have their own disjoint view of who's in which room — Socket.IO's Redis adapter (or similar) would be needed to scale horizontally.
- **Mesh topology WebRTC** — every participant opens a direct `RTCPeerConnection` to every other participant, so bandwidth/CPU cost grows roughly O(n²) with room size. Fine for small calls (2–5 people); would need an SFU (e.g. mediasoup, LiveKit) for larger rooms.
- **No input validation/sanitization library** — request bodies are trusted beyond basic presence checks (`user.controller.js`); Mongoose schema types provide some implicit coercion/rejection but there's no explicit schema validation (e.g. Zod/Joi) layer.
- **Frontend bundle is unsplit** (`frontend/dist/assets/index-*.js` ~619 kB / ~198 kB gzipped) — Vite warns about this on build. Route-based `React.lazy()` code-splitting (e.g. splitting `MeetingRoom` and MUI-heavy `Authentication` out of the initial bundle) would address it if load time becomes a concern.

## Notable implementation choices already made (so they aren't "rediscovered" as bugs)

- `bcryptjs` is used instead of native `bcrypt` deliberately — it avoids a native build step (no node-gyp/Python toolchain needed) and sidesteps a critical transitive vulnerability that was present in `bcrypt`'s `@mapbox/node-pre-gyp` → `tar` dependency chain at the time this project was set up. Functionally equivalent API.
- Socket.IO CORS config does **not** set `credentials: true` — the app doesn't use cookies (token is passed as a query param / request body), so enabling credentialed CORS would be unused surface area, and is invalid to combine with a wildcard origin per the CORS spec anyway.
