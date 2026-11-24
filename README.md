# MeetSphere

A full-stack video conferencing app: users register/log in with a JWT-authenticated account, create or join a meeting by code, and talk over a peer-to-peer WebRTC video call with live chat, screen sharing, and a synced participant list. Meeting history (host, duration, participant count) is tracked per user with pagination.

This README is meant to be self-sufficient — a reader (human or agent) should be able to understand the entire system, its contracts, and its known rough edges without opening the source first.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19, Vite, React Router 7, MUI 9, Axios, Socket.IO client |
| Backend | Node.js (ESM), Express 4, Socket.IO 4, Mongoose 8 (MongoDB) |
| Auth | JWT (7-day expiry) in an httpOnly cookie + bcrypt-hashed passwords |
| Validation | Zod (HTTP request bodies/params/query + Socket.IO payloads) |
| Video | WebRTC (`RTCPeerConnection`), STUN-only (Google's public STUN server), signaling relayed over Socket.IO |
| Testing | Jest + Supertest (backend), model layer mocked — no live DB needed to run tests |

No TypeScript, no frontend state management library beyond React Context.

## Repository layout

```
meetsphere/
├── package.json              # root: `npm run dev` runs both apps via concurrently
├── render.yaml               # Render blueprint for the API
├── LICENSE                   # MIT
├── backend/
│   ├── .env.example          # PORT, MONGO_URI, CLIENT_ORIGIN, JWT_SECRET
│   ├── jest.config.cjs
│   ├── package.json
│   ├── tests/
│   │   ├── setup.js                      # sets JWT_SECRET/CLIENT_ORIGIN for the test env
│   │   ├── auth.test.js                  # register/login/logout/me/socket-token, mocked User model
│   │   └── meeting.test.js               # create/join/end/history, mocked Meeting/Participant/Message
│   └── src/
│       ├── app.js                        # Express app (CORS, cookies, JSON-only body parsing, routes), exported for tests — no listen()
│       ├── server.js                     # entry point: connects Mongo, creates the HTTP server, attaches Socket.IO, listens
│       ├── config/db.js                  # mongoose.connect wrapper
│       ├── controllers/
│       │   ├── auth.controller.js        # register / login / logout / me / socket-token
│       │   ├── meeting.controller.js     # create / join / leave / end / history
│       │   └── socketManager.js          # all Socket.IO event handling (signaling, chat, presence)
│       ├── middleware/
│       │   ├── auth.middleware.js        # requireAuth — verifies the cookie's JWT on protected REST routes
│       │   ├── validate.middleware.js    # Zod-schema request validator
│       │   └── errorHandler.js           # centralized error handler + 404 handler
│       ├── models/
│       │   ├── user.model.js             # name, username, password hash
│       │   ├── meeting.model.js          # meetingCode, host, status, startedAt, endedAt
│       │   ├── participant.model.js      # one doc per join-session: meeting, user, micOn, cameraOn, joinedAt, leftAt
│       │   └── message.model.js          # persisted chat: meeting, sender, senderName, text
│       ├── routes/
│       │   ├── auth.routes.js            # /api/v1/auth/*
│       │   └── meeting.routes.js         # /api/v1/meetings/* (all behind requireAuth)
│       ├── utils/
│       │   ├── tokens.js                 # session JWT + cookie helpers, one-minute socket token
│       │   ├── ApiError.js               # thrown by controllers, caught by errorHandler
│       │   ├── asyncHandler.js           # wraps async route handlers so rejections reach errorHandler
│       │   └── generateMeetingCode.js    # "xyz-abcd-efg" style code generator
│       └── validators/
│           ├── auth.validator.js         # registerSchema, loginSchema
│           └── meeting.validator.js      # meetingCodeParamSchema, historyQuerySchema, chatMessageSchema, mediaStateSchema
└── frontend/
    ├── .env.example           # VITE_API_URL, VITE_SOCKET_URL
    ├── vercel.json            # SPA fallback + proxies /api to the Render backend
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx            # ReactDOM root
        ├── App.jsx             # React Router route table
        ├── App.css             # Landing + Home page styles (global, not module-scoped)
        ├── index.css           # App-wide resets/fonts
        ├── config/api.js       # REST base URL (same-origin in production) + Socket.IO URL
        ├── context/AuthContext.jsx  # Axios client (withCredentials) + auth/meeting API calls
        ├── utils/withAuth.jsx  # HOC: shows a loader until /auth/me answers, redirects to /auth if logged out
        ├── pages/
        │   ├── Landing.jsx       # "/" — marketing page, links to /auth
        │   ├── Authentication.jsx  # "/auth" — login + register form (MUI)
        │   ├── Home.jsx           # "/home" — create a meeting or join one by code (withAuth)
        │   ├── History.jsx        # "/history" — paginated past-meetings list (withAuth)
        │   └── MeetingRoom.jsx    # "/meeting/:code" — the actual video call room (withAuth)
        ├── styles/meetingRoom.module.css  # CSS module for MeetingRoom only
        └── assets/               # background.png, mobile.png, hero-illustration.png
```

## How it fits together (request/data flow)

1. **Register/Login** (`Authentication.jsx` → `AuthContext` → `POST /api/v1/auth/register` or `/login`) — on success, `login` signs a JWT (`{ id, username, name }` payload, 7-day expiry) and sets it as an **httpOnly cookie** named `token` (`Secure` in production, `SameSite=Lax`). The token is never in a response body, so page JavaScript (and any XSS bug) can't read it. The Axios client uses `withCredentials: true` so the browser sends the cookie on every API call. Because the page can't read the cookie, `AuthProvider` calls `GET /api/v1/auth/me` on load to learn who is logged in. A response interceptor watches for `401`s globally and clears the user, so an expired session falls back to a clean login screen. `POST /api/v1/auth/logout` clears the cookie.
2. **Route protection** — `Home.jsx`, `History.jsx`, and `MeetingRoom.jsx` are wrapped in `withAuth()`, a HOC that shows a loader until `/auth/me` answers and redirects to `/auth` if no one is logged in. This is a client-side UX guard only; the real enforcement is server-side (`requireAuth` middleware verifies the cookie's JWT on every `/api/v1/meetings/*` route, and the Socket.IO server verifies its own token at the handshake — see below).
3. **Creating a meeting** — `Home.jsx`'s "New Meeting" button calls `POST /api/v1/meetings`, which generates a unique `meetingCode` (`generateMeetingCode.js`, retried up to 5 times against the DB to avoid collisions) and creates a `Meeting` document with `host = <caller>`, `status: "active"`, `startedAt: now`. The frontend then navigates to `/meeting/:code`.
4. **Joining a meeting** — Whether you're the host or someone who typed in a code, entering `/meeting/:code` shows a lobby (camera/mic preview). Clicking "Join Meeting" calls `POST /api/v1/meetings/:code/join`, which:
   - 404s if the code doesn't exist, 410s if the meeting has already ended,
   - creates a **new** `Participant` document for this session (see [Design note: why a new record per join](#design-note-why-a-new-participant-record-per-join)),
   - returns the current active-participant roster and the last 50 persisted chat messages so a (re)joining client isn't starting from a blank slate.
   Only after this REST call succeeds does the client open a Socket.IO connection and emit `join-room` to enter the real-time mesh. The socket connects to the backend directly (the frontend host's `/api` proxy can't carry WebSockets), so the session cookie isn't sent with it. Instead, before every connection attempt the client fetches a one-minute socket token from `GET /api/v1/auth/socket-token` (which goes through the proxy, with the cookie) and passes it in `socket.handshake.auth.token`. An `io.use()` middleware verifies it before any event is processed.
5. **The call itself (`MeetingRoom.jsx`)** — a manual mesh-topology WebRTC implementation, keyed by `meetingCode` (not the raw URL, which was the old, more fragile behavior):
   - The server (`socketManager.js`) tracks room membership in memory (`connections[meetingCode]`, `roomParticipants[meetingCode]`) and broadcasts `user-joined`/`participant-joined` to the room.
   - Each client creates one `RTCPeerConnection` per other participant, exchanges SDP offers/answers and ICE candidates via the `signal` event (relayed peer-to-peer through the server, not stored), and attaches local media via the **deprecated** `addStream`/`onaddstream` APIs (see [Known gaps](#known-gaps--tradeoffs)).
   - Chat messages (`chat-message`) are validated (Zod), broadcast to the room, and persisted to MongoDB (`Message` collection) — replacing the old in-memory-only chat buffer that used to vanish on server restart.
   - Mic/camera toggles emit `media-state`, which is broadcast to the room (driving the participant panel's icons) and best-effort persisted onto the participant's `Participant` document.
6. **Leaving / ending** — "Leave" calls `POST /meetings/:code/leave` (marks that participant session's `leftAt`) and disconnects the socket. The host's "End for everyone" calls `POST /meetings/:code/end` (sets `Meeting.status = "ended"`, `endedAt`, and `leftAt` for every still-active participant) and then emits `end-meeting` over the socket so everyone still connected gets a `meeting-ended` broadcast and hangs up immediately, instead of continuing to talk in a room the database now considers over.
7. **Reconnection** — if the Socket.IO transport drops (network blip, laptop sleep, etc.), the client keeps its camera/mic running locally but shows a "reconnecting" banner. When Socket.IO's automatic reconnection succeeds (`socket.io.on("reconnect", ...)`), the client closes its old `RTCPeerConnection`s, clears its remote-video state, does a **fresh** `POST /meetings/:code/join` (new participant session, current roster + messages) and re-emits `join-room` — rebuilding the mesh from a known-good state rather than trying to patch a possibly-inconsistent one back together.
8. **History** (`History.jsx`) fetches `GET /meetings/history?page=&limit=`, listing every meeting the user hosted or participated in, newest first, with host name, status, duration, and participant count.

### Design note: why a new Participant record per join

Each call to `/meetings/:code/join` inserts a new `Participant` document rather than upserting one. A user who leaves and rejoins gets two session records instead of one being silently reused. This makes join/leave timestamps accurate per-session (useful if you ever wanted "was X present at Y timestamp" or per-session duration), at the cost of a slightly bigger table for users who reconnect a lot — a reasonable tradeoff for a project this size, and a natural discussion point on data modeling tradeoffs.

## XSS and CSRF

Keeping the session token in an httpOnly cookie instead of `localStorage` protects it from **XSS**: injected script can't read it. The trade-off is that browsers attach cookies to requests automatically, which opens the door to **CSRF**: a page on another site making the user's browser send a request to this API with their cookie. Four layers stop that:

1. **`SameSite=Lax` cookie (the main defence).** The browser only sends the cookie on cross-site requests that are top-level `GET` navigations, like clicking a link. A cross-site `POST`, whether from a form or `fetch`, arrives without it and gets `401`.
2. **No `GET` endpoint changes state.** Creating, joining, leaving and ending meetings, and logging out, are all `POST`s, so the one cross-site request that does carry the cookie can't do anything.
3. **JSON-only request bodies.** `app.js` registers `express.json()` and no form parser, so an HTML form on another site can't submit a usable body.
4. **Credentialed CORS locked to `CLIENT_ORIGIN`.** A cross-site `fetch` with a JSON body triggers a CORS preflight that only the configured origin passes, and other sites can't read any response.

The socket isn't exposed to cross-site WebSocket hijacking either: it doesn't authenticate with the cookie at all, but with a one-minute token that only this app's own page can fetch (other sites can't read the `/auth/socket-token` response because of CORS).

## Backend API contract

**`/api/v1/auth`**

| Method | Path | Body | Success | Failure |
| --- | --- | --- | --- | --- |
| POST | `/register` | `{ name, username, password }` (Zod-validated: username ≥3 chars, password ≥6 chars) | `201 { success, message }` | `400` validation, `409` username taken |
| POST | `/login` | `{ username, password }` | `200 { success, user: { id, username, name } }` + httpOnly `token` cookie | `400` validation, `401` wrong username or password |
| POST | `/logout` | — | `200 { success, message }`; clears the cookie | — |
| GET | `/me` | — (cookie) | `200 { success, user: { id, username, name } }` | `401` not logged in |
| GET | `/socket-token` | — (cookie) | `200 { success, token }`: a one-minute JWT for the Socket.IO handshake | `401` not logged in |

**`/api/v1/meetings`** (all routes require the `token` cookie)

| Method | Path | Body / Query | Success | Failure |
| --- | --- | --- | --- | --- |
| POST | `/` | — | `201 { success, meeting: { meetingCode, host, status, startedAt } }` | `401` |
| POST | `/:code/join` | — | `200 { success, meeting: { meetingCode, host, status, startedAt, isHost }, participants: [...], messages: [...] }` | `401`, `404` unknown code, `410` meeting already ended |
| POST | `/:code/leave` | — | `200 { success, message }` | `401`, `404` |
| POST | `/:code/end` | — | `200 { success, message, endedAt }` | `401`, `403` not the host, `404` |
| GET | `/history` | `?page=1&limit=10` (Zod-coerced, `limit` capped at 50) | `200 { success, data: [{ meetingCode, host, status, startedAt, endedAt, durationSeconds, participantCount }], page, limit, total, totalPages }` | `401` |

Every error response has the shape `{ success: false, message, errors? }` (`errors` present only for Zod validation failures — see `middleware/errorHandler.js`). Unhandled/unexpected errors are logged server-side and returned as a generic `500` so internals never leak to the client.

## Socket.IO protocol (`backend/src/controllers/socketManager.js`)

**Handshake auth:** the client connects with `io(url, { auth: callback })`, where the callback fetches a fresh one-minute token from `/auth/socket-token` for every (re)connection attempt. An `io.use()` middleware verifies the JWT (and that its `purpose` is `"socket"`) before any event handler runs, and rejects the connection outright if it's missing/invalid. `socket.data.user` (`{ id, username, name }`) is then trusted for the lifetime of that connection.

Live room membership state is entirely in-memory (`connections`, `roomParticipants`, `socketSessions`) — restarting the backend drops active *signaling* state, but `Participant`/`Message`/`Meeting` documents already written to MongoDB are unaffected.

| Event | Direction | Payload | Behavior |
| --- | --- | --- | --- |
| `join-room` | client → server | `{ meetingCode }` | Verifies the meeting is `active`, joins the Socket.IO room, adds the socket to the in-memory roster, replies to the joining socket with `participant-list` (full current roster) and to the rest of the room with `user-joined`/`participant-joined` |
| `signal` | client ↔ server | `(toSocketId, message)` | Pure relay: server re-emits `signal(fromSocketId, message)` to `toSocketId`. `message` is a JSON string of `{ sdp }` or `{ ice }` |
| `chat-message` | client → server | `{ text }` (Zod-validated, 1–2000 chars) | Broadcasts `chat-message({ text, senderName, senderSocketId, createdAt })` to the room and persists a `Message` document |
| `media-state` | client → server | `{ micOn, cameraOn }` (Zod-validated) | Broadcasts `participant-state({ socketId, micOn, cameraOn })` to the rest of the room and best-effort updates the sender's `Participant` document |
| `end-meeting` | client → server | — | Only acts if the caller is the meeting's host (re-checked server-side against the DB); broadcasts `meeting-ended` to the room and clears the room's in-memory state. The REST `/end` call is what actually persists "ended" — this is just the live notification |
| `leave-room` | client → server | — | Explicit-leave path; same cleanup as `disconnect` |
| `disconnect` | client → server (built-in) | — | Removes the socket from its room, broadcasts `user-left`/`participant-left`, and best-effort marks that `Participant` session's `leftAt` — so an abrupt tab close/network drop still gets recorded, not just an explicit "Leave" click |

There is no room capacity limit and no SFU — this is intentionally a minimal signaling layer for small calls (see [Known gaps](#known-gaps--tradeoffs)).

## Data models

**User** — `{ name, username (unique), password (bcrypt hash) }`

**Meeting** — `{ meetingCode (unique), host (ref User), status: "active"|"ended", startedAt, endedAt }`

**Participant** — one document per join-session — `{ meeting (ref Meeting), user (ref User), name, micOn, cameraOn, joinedAt, leftAt }`

**Message** — `{ meeting (ref Meeting), sender (ref User), senderName, text, createdAt }`

All four have Mongoose `timestamps: true`; `Meeting` and `Participant`/`Message` carry indexes on their most common query shapes (`{ host, createdAt }`, `{ meeting, user }`, `{ meeting, createdAt }`).

## Environment variables

**`backend/.env`** (copy from `backend/.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8000` | HTTP/Socket.IO listen port |
| `MONGO_URI` | *(required)* | MongoDB connection string |
| `CLIENT_ORIGIN` | request origin (API), `*` (Socket.IO) | Allowed CORS origin for the Express API and Socket.IO. The API's CORS is credentialed, so set this to the real frontend URL in production |
| `JWT_SECRET` | *(required)* | Signing secret for auth tokens — `server.js` refuses to start without it |
| `COOKIE_SAMESITE` | `lax` in dev, `none` in production | `SameSite` for the auth cookie; `render.yaml` sets `lax` because Vercel proxies `/api` on the same site |

**`frontend/.env`** (copy from `frontend/.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8000` in dev, `""` (same origin) in production builds | Base URL for REST calls; `/api/v1` is appended |
| `VITE_SOCKET_URL` | falls back to `VITE_API_URL`, then the page's origin | Backend URL for Socket.IO. Needed in production, where REST goes through the Vercel proxy but the socket must connect to Render directly |

## Running locally

```bash
cp backend/.env.example backend/.env    # fill in MONGO_URI and JWT_SECRET
cp frontend/.env.example frontend/.env  # defaults to localhost:8000, fine for local dev

npm install            # installs root devDependency (concurrently)
npm run install:all    # installs backend/ and frontend/ dependencies
npm run dev            # runs both apps together (backend :8000, frontend :5173)
```

Or run each independently: `cd backend && npm install && npm run dev` / `cd frontend && npm install && npm run dev`.

`npm run build` in `frontend/` produces a static `dist/` (deploy anywhere that serves static files + rewrites all paths to `index.html`, since routing is client-side). The backend has no build step — `npm start` runs `src/server.js` directly with Node.

## Deployment

- **API → Render.** `render.yaml` is a blueprint for the `backend/` service (`npm ci` / `npm start`, health check on `/health`, generated `JWT_SECRET`, `COOKIE_SAMESITE=lax`). Set `MONGO_URI` and `CLIENT_ORIGIN` (the Vercel URL) in the Render dashboard.
- **Frontend → Vercel.** `frontend/vercel.json` rewrites `/api/*` to the Render service, keeping the auth cookie first-party, and everything else to `index.html` for client-side routing. Set `VITE_SOCKET_URL` to the Render URL, since Vercel's proxy can't carry WebSockets.

## Testing

```bash
cd backend
npm test
```

`backend/tests/*.test.js` use Jest + Supertest against the exported Express `app` (from `src/app.js`, which never calls `.listen()`), with the Mongoose model layer replaced by `jest.unstable_mockModule` mocks. This keeps the suite fast and independent of a live database while still exercising the real HTTP layer: routing, validation middleware, auth middleware, controller logic, and error handling all run for real — only `User.findOne`, `Meeting.create`, etc. are stubbed. Covers: registration (success/duplicate/invalid input), login (success/wrong password/unknown user), the session cookie (httpOnly, never in the body, 7-day JWT, logout, `/me`, socket token), the auth middleware (missing/garbage cookie), meeting create/join/end (including the 404/410/403 edge cases), and paginated history.

This was also manually verified end-to-end against a real local MongoDB instance (register → login → create meeting → join → leave → rejoin → end → history, plus a two-client Socket.IO run through join-room/chat-message/media-state/disconnect/end-meeting, and a check that the 7-day session token is rejected at the socket handshake) while building it — worth knowing if you're deciding whether to trust the mocked suite alone or also want an integration pass. A natural next step for CI would be adding `mongodb-memory-server` for a true integration-test tier on top of these.

## Known gaps & tradeoffs

Pre-existing, deliberate tradeoffs — listed so a future contributor (or agent) doesn't need to rediscover them by reading every file:

- **JWTs aren't revocable.** They're stateless by design (no DB lookup on every request), which means there's no logout-everywhere/revoke-this-token capability — logout clears the cookie in that browser, but a copied token stays valid for the rest of its 7-day life. Short-lived access tokens with refresh tokens, or a server-side session store, would be the next step if this mattered in production.
- **Body-less POSTs rely on SameSite alone.** `POST /meetings`, `/meetings/:code/join`, `/leave`, `/end` and `/auth/logout` take no body, so the JSON-only rule doesn't apply to them; `SameSite=Lax` is what stops a forged one. If `COOKIE_SAMESITE` were ever set to `none`, an `Origin` header check on write requests would be needed to keep CSRF protection airtight.
- **Meeting codes are unauthenticated invite links, effectively.** Anyone who knows/guesses a meeting code and has *any* valid account can join — there's no host approval / waiting room / per-meeting allowlist.
- **WebRTC uses the deprecated `addStream`/`onaddstream` API pair** instead of `addTrack`/`ontrack`. Still functional in current Chrome/Firefox/Safari but removed from the spec; migrating needs live multi-browser testing since track-level renegotiation behaves differently.
- **STUN only, no TURN server** — calls between peers on restrictive/symmetric NATs may fail to establish a direct connection. Adding a TURN server (e.g. coturn, or a managed provider) would fix this.
- **In-memory *signaling* state** (`connections`/`roomParticipants`/`socketSessions` in `socketManager.js`) lives only in the Node process's memory — multiple backend instances behind a load balancer would each have a disjoint view of who's connected to which room. (Note this is narrower than it used to be: meeting/participant/chat *data* is now in MongoDB and survives a restart; only the live "who's currently connected" mesh state is in-memory.) Scaling horizontally would need Socket.IO's Redis adapter or similar — deliberately not added here since this project doesn't need that scale, and it'd be complexity without a corresponding interview story to back it up.
- **Mesh topology WebRTC** — every participant opens a direct `RTCPeerConnection` to every other participant, so bandwidth/CPU cost grows roughly O(n²) with room size. Fine for small calls (2–5 people); would need an SFU (e.g. mediasoup, LiveKit) for larger rooms.
- **Frontend bundle is unsplit** (~640 kB / ~205 kB gzipped). Vite warns about this on build. Route-based `React.lazy()` code-splitting (e.g. splitting `MeetingRoom` and the MUI-heavy `Authentication` page out of the initial bundle) would address it if load time became a concern.
- **Tests mock the database layer** rather than running against a real one (see [Testing](#testing)) — a deliberate speed/simplicity tradeoff for a project this size; `mongodb-memory-server` would be the natural addition for true integration coverage in CI.

## Notable implementation choices already made (so they aren't "rediscovered" as bugs)

- `bcryptjs` is used instead of native `bcrypt` deliberately — it avoids a native build step (no node-gyp/Python toolchain needed) and sidesteps a critical transitive vulnerability that was present in `bcrypt`'s `@mapbox/node-pre-gyp` → `tar` dependency chain at the time this project was set up. Functionally equivalent API.
- Socket.IO CORS config does **not** set `credentials: true` — the socket doesn't use the cookie (its short-lived JWT is sent via `socket.handshake.auth`), so enabling credentialed CORS would be unused surface area, and is invalid to combine with a wildcard origin per the CORS spec anyway.
- `app.js` and `server.js` are split specifically so the Express app is importable without side effects (binding a port, connecting to Mongo) — that's what lets `tests/*.test.js` use Supertest against it directly.
