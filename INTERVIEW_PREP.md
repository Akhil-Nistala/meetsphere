# MeetSphere — Interview Prep Guide

Everything here comes from the actual code in this repo. File references are clickable.

---

## 0. The pitch (memorize these)

**30 seconds:**
> MeetSphere is a full-stack video conferencing app, like a small Google Meet. I built it on the MERN stack. Video and audio go **peer-to-peer over WebRTC**, and a **Socket.IO server handles signaling**, chat, and live participant state. The backend uses **JWT auth**, **Zod validation**, **centralized error handling**, and tracks the full **meeting lifecycle** (create, join, leave, end) in MongoDB, so users get a meeting history with duration and participant counts. It has a Jest + Supertest test suite.

**2 minutes (add these):**
- A user registers or logs in and gets a JWT. They create a meeting, which gives them a `abc-defg-hij` code generated with `crypto.randomInt`, or they join with someone else's code.
- Joining has **two layers**. First a REST call (`POST /meetings/:code/join`) checks the meeting is active, records a Participant session, and returns the roster plus the chat history. Then the client opens an **authenticated socket**, joins the room, and the peers do the **WebRTC offer/answer/ICE handshake** through the server.
- After that, media never touches my server. It flows browser to browser in a **mesh**.
- Chat is broadcast over the socket and saved to MongoDB. Mic and camera toggles are synced live to everyone's participant panel.
- Only the host can end a meeting. That closes every open participant session and kicks all clients out over the socket.
- Disconnects such as a closed tab or a network drop are handled on the server. On reconnect, the client does a clean re-join.

---

## 1. Tech stack, and why each piece

| Layer | Tech | Why (what to say) |
|---|---|---|
| Frontend | React 19 + Vite, MUI, React Router 7 | Component model fits a stateful call UI. Vite gives fast dev builds. MUI provides icons and buttons. |
| HTTP client | Axios with interceptors | One place to attach the `Bearer` token and to handle 401s globally (auto-logout). |
| Realtime | Socket.IO (server + client) | Rooms, auto-reconnect, a handshake `auth` payload, and fallback transports, all of which raw WebSockets lack. |
| Media | **WebRTC** (`RTCPeerConnection`), Google STUN | Peer-to-peer, low latency, encrypted (DTLS-SRTP). The server never pays bandwidth for video. |
| Backend | Node + Express 4 (ES modules) | Same language on both ends. Socket.IO attaches to the same HTTP server. |
| DB | MongoDB + Mongoose | Flexible documents. Refs plus `populate` and aggregations cover the history page. |
| Auth | `jsonwebtoken` + `bcryptjs` | Stateless auth that works for REST **and** sockets. Passwords are hashed with salt rounds = 10. |
| Validation | **Zod** | One schema both validates and coerces (e.g. `page` string to number). Also reused for socket payloads. |
| Tests | Jest + Supertest, mocked Mongoose models | Exercise the real Express app (routing, middleware, errors) without a database. |
| Tooling | `concurrently` root `npm run dev`, nodemon, oxlint | One command runs both apps. |

---

## 2. Architecture

```
 ┌──────────── Browser A ────────────┐                ┌──────────── Browser B ────────────┐
 │ React UI                          │                │ React UI                          │
 │  AuthContext (axios + JWT)        │                │                                   │
 │  MeetingRoom (RTCPeerConnection)  │◄══ WebRTC media (P2P, SRTP) ══►│ MeetingRoom       │
 └───────┬───────────────┬───────────┘                └──────┬───────────────┬────────────┘
         │ REST (HTTPS)  │ Socket.IO (WS)                    │               │
         ▼               ▼                                   ▼               ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────┐
 │ Node server  (server.js → one http.Server shared by Express + Socket.IO)              │
 │  Express: /api/v1/auth/*  /api/v1/meetings/*   → validate → requireAuth → controller   │
 │                                                  → errorHandler                        │
 │  Socket.IO: io.use(JWT auth) → join-room / signal / chat-message / media-state /      │
 │             leave-room / end-meeting / disconnect                                      │
 │  In-memory maps: connections, roomParticipants, socketSessions                         │
 └───────────────────────────────────────┬───────────────────────────────────────────────┘
                                         ▼
                         MongoDB: users, meetings, participants, messages
          STUN (stun.l.google.com:19302) → each browser discovers its public IP:port
```

**Key idea to say out loud:** *"The server is a **signaling server**, not a media server. It only passes small JSON messages (SDP and ICE) so the browsers can find each other. Once connected, the video goes directly peer to peer."*

---

## 3. Concepts from scratch

### 3.1 WebRTC in plain English
WebRTC lets two browsers send audio and video **directly to each other**. Two problems need solving first:
1. **"What can we both speak?"** Codecs, resolutions, encryption keys. This is described in an **SDP** (Session Description Protocol) blob. One side makes an **offer**, and the other replies with an **answer**.
2. **"How do I reach you?"** Most devices sit behind a router doing **NAT**, so they don't know their own public address. **ICE** (Interactive Connectivity Establishment) gathers **candidates**: local IP, public IP from **STUN**, and relay address from **TURN**. Each side tries pairs of candidates until one works.

WebRTC **does not define how offers, answers and candidates get delivered**. You bring your own channel. That's **signaling**, and here it's Socket.IO.

- **STUN**: a cheap server that answers "here's the public IP:port you came from". It's used here (`stun:stun.l.google.com:19302`).
- **TURN**: a relay server for when direct connection fails (symmetric NAT, strict corporate firewalls). It costs bandwidth. **Not configured in this project**, and that's a known limitation.
- Media is always encrypted (DTLS-SRTP). That's mandatory in WebRTC.

### 3.2 The handshake, exactly as this code does it
Code: [MeetingRoom.jsx](frontend/src/pages/MeetingRoom.jsx) and [socketManager.js](backend/src/controllers/socketManager.js)

1. New user **N** emits `join-room`. The server adds N's socket id to `connections[code]` and emits `user-joined(N, [all ids])` to **everyone** in the room.
2. Every client creates an `RTCPeerConnection` per id. It sets `onicecandidate`, which sends the candidate via `signal`, and `onaddstream`, which adds a `<video>` tile. It also attaches its local stream.
3. The client where `id === myId` (the newcomer) calls `createOffer()` → `setLocalDescription` → `emit("signal", peerId, {sdp})` for each existing peer.
4. The server's `signal` handler is a **relay**: `io.to(toId).emit("signal", socket.id, message)`. It first checks that the target socket is in the **same meeting** as the sender, and drops the message otherwise.
5. An existing peer receives the offer → `setRemoteDescription` → `createAnswer` → `setLocalDescription` → sends the answer back.
6. ICE candidates flow both ways through `signal` and are applied with `addIceCandidate`.
7. Connection is up → `onaddstream` fires → the remote video renders.

**Why does the newcomer make the offer?** It avoids **glare**, where both sides offer at once. There's one clear initiator per pair.

### 3.3 Mesh topology
Every participant connects to every other one: **n(n-1)/2 connections**, and each client uploads its stream **n-1 times**. Fine for 2–5 people, bad beyond that.
The alternatives you should be able to name:
- **SFU** (Selective Forwarding Unit, e.g. mediasoup, LiveKit, Janus). Each client uploads once and the server forwards streams. This is what Meet and Zoom-style apps use.
- **MCU** mixes everything into one stream server-side. It's CPU-heavy and rare now.

### 3.4 Socket.IO vs raw WebSocket
Socket.IO is a protocol **on top of** WebSocket (with HTTP long-polling fallback). It adds **rooms**, **named events**, **acknowledgements**, **auto-reconnect**, and **middleware** (`io.use`). This project uses rooms (`socket.join(meetingCode)`, `io.to(code).emit`), middleware (JWT auth), and reconnect events.

### 3.5 JWT auth
- On login the server signs `{id, username, name}` with `JWT_SECRET`, expiring in 7 days ([auth.controller.js](backend/src/controllers/auth.controller.js)).
- The client stores the token in `localStorage`. An Axios **request interceptor** adds `Authorization: Bearer <token>` ([AuthContext.jsx](frontend/src/context/AuthContext.jsx)).
- REST: `requireAuth` verifies the token and sets `req.user` ([auth.middleware.js](backend/src/middleware/auth.middleware.js)).
- Socket: the token is sent in `io(url, { auth: { token } })` and verified in `io.use(authenticateSocket)` **before** the connection is accepted.
- A JWT is **stateless**: the server stores no session, and the signature proves the payload wasn't tampered with. The trade-off: you **can't revoke** a token before it expires without extra machinery (a denylist or short-lived access tokens plus refresh tokens).
- A JWT is **signed, not encrypted**, so never put secrets in the payload.

### 3.6 bcrypt
A slow, salted hash. `bcrypt.hash(pw, 10)`: the cost of 10 means 2^10 rounds. The salt is stored inside the hash string, so identical passwords get different hashes. That defeats rainbow tables, and the slowness defeats brute force. `bcrypt.compare` re-hashes using the embedded salt.

### 3.7 Zod validation middleware
[validate.middleware.js](backend/src/middleware/validate.middleware.js): `validate(schema, "body" | "query" | "params")` runs `safeParse`. On failure it returns a 400 with per-field errors. On success it **replaces** `req[source]` with the parsed data, so controllers get trimmed strings and coerced numbers. The same Zod schemas validate **socket** payloads (`chatMessageSchema`, `mediaStateSchema`), because socket events skip Express middleware.

### 3.8 Centralized errors
- `ApiError(statusCode, message, details)` is a custom error class.
- `asyncHandler(fn)` wraps async controllers so a rejected promise goes to `next(err)`. Express 4 doesn't catch async errors by itself.
- `errorHandler` turns known `ApiError`s into `{success:false, message, errors}`. Unknown errors are logged and returned as a generic 500, so **no stack traces leak** to clients.
- `notFoundHandler` gives a JSON 404 for unknown routes.

---

## 4. Data model ([models/](backend/src/models))

```
User        { name, username (unique), password (bcrypt hash), timestamps }
Meeting     { meetingCode (unique), host → User, status: active|ended, startedAt, endedAt }
              index { host: 1, createdAt: -1 }   // "my meetings, newest first"
Participant { meeting → Meeting, user → User, name, micOn, cameraOn, joinedAt, leftAt }
              index { meeting: 1, user: 1 }
Message     { meeting → Meeting, sender → User, senderName, text, timestamps }
              index { meeting: 1, createdAt: 1 }  // "chat for this meeting in order"
```

**Design choices to defend:**
- **Participant = one *session*, not one user per meeting.** Each join creates a new row, so leaving and rejoining keeps accurate per-session times. "Currently in the meeting" means `leftAt: null`.
- **Denormalized `name` / `senderName`.** Chat and roster render without a `populate` join. The trade-off: a renamed user keeps the old name in old messages, which is acceptable for a chat log.
- **References instead of embedding.** Messages and participants grow without bound, and MongoDB has a 16 MB document limit, so they live in separate collections, not arrays inside Meeting.

---

## 5. Every flow, end to end

### Register / Login
`POST /api/v1/auth/register` → Zod `registerSchema` (name required, username ≥3, password ≥6) → reject duplicate username with **409** → bcrypt hash → create → 201.
`POST /api/v1/auth/login` → find user → `bcrypt.compare` (against a dummy hash if the user doesn't exist) → **401 "Invalid username or password" for both** unknown user and wrong password (prevents username enumeration, including via timing) → sign JWT → return `{token, user}`. The frontend saves both to localStorage and navigates to `/home`.

### Route protection (frontend)
`withAuth` HOC ([withAuth.jsx](frontend/src/utils/withAuth.jsx)) redirects to `/auth` if there's no token. This is **UX only**. The real security is server-side. The Axios **response interceptor** catches any 401 → clears storage → redirects. That handles expired tokens globally.

### Create meeting — `POST /meetings`
`createUniqueMeetingCode()` generates `xxx-xxxx-xxx` with `crypto.randomInt` (a CSPRNG, not `Math.random`). That gives 26^10 ≈ 1.4×10^14 codes. It checks `Meeting.exists` and retries up to 5 times. The **unique index is the real guarantee** against a race. The new meeting is `active` with `host = req.user.id`.

### Join — REST, then socket
1. Lobby: `getUserMedia` previews the camera.
2. `POST /meetings/:code/join` → 404 if no meeting, **410 Gone** if ended → create Participant → return meeting info + `isHost` + active participants + the **latest** 50 messages (sorted newest-first, limited, then reversed to chronological order; fetched **in parallel** with `Promise.all`).
3. Open the socket with the JWT → on first `connect` → `join-room`. The server re-checks that the meeting is active (`room-error` if not), records maps, sends the full `participant-list` to the joiner, broadcasts `participant-joined` to others, and fires `user-joined` to start WebRTC.

**Why do both REST and socket?** REST does the durable, validated, DB-backed part, with proper HTTP status codes and an easy-to-test request/response shape. The socket does the realtime part. Splitting them keeps the socket layer thin.

### Chat
Client emits `chat-message {text}` → server looks up the sender **from its own `socketSessions` map**, not from the payload, so clients can't spoof names → Zod validate (1–2000 chars) → broadcast to room → **then** persist to `Message`. Broadcasting first keeps chat snappy. Persistence is best-effort and logged on failure. Unread badge: a counter increments for messages from other sockets.

### Mic / camera state
Toggling sets React state. A `useEffect` re-acquires media and emits `media-state {micOn, cameraOn}` → server updates the in-memory roster, broadcasts `participant-state` to the others, and persists to the Participant doc without awaiting it (fire-and-forget with `.catch`).

### Screen share
`getDisplayMedia` → replace the local stream → add it to every peer connection and **re-offer** (renegotiation). When the user stops sharing (`track.onended`) it falls back to the camera.

**Black/silence fallback:** if there's no camera or mic, the code builds a fake stream from a black canvas (`canvas.captureStream()`) and a muted oscillator (`AudioContext`). That way a peer connection always has tracks to negotiate.

### Leave vs disconnect
- **Explicit leave:** `POST /:code/leave` sets `leftAt` on the latest open session. Then the client stops tracks, closes peer connections, and disconnects the socket.
- **Tab closed or network lost:** the server's `disconnect` handler → `removeFromRoom` cleans up the maps, emits `user-left` and `participant-left`, and **also sets `leftAt`**. So history stays correct even if the user never clicks Leave.
- `socketSessions[socket.id]` is a **reverse index**: socket → room. Disconnect cleanup is O(1) instead of scanning every room.

### Reconnect
Socket.IO auto-reconnects, but the new connection gets a **new socket id** and the server has already dropped the old room membership. So the client does a **clean re-join**: close all peer connections, clear videos, call REST join again, and emit `join-room` again. It doesn't try to patch stale state. A "Reconnecting…" banner shows meanwhile.

### End meeting (host only)
`POST /:code/end` → **403** if not host → in parallel: set Meeting `status: ended, endedAt`, and close every open Participant session (`updateMany leftAt: null → endedAt`). Then the host emits `end-meeting` over the socket. The server **re-verifies host** from the DB, broadcasts `meeting-ended`, and removes everyone from the room. Clients alert and hang up. The REST call is the **source of truth**. The socket event is just notification.

### History — `GET /meetings/history?page&limit`
1. Find meeting ids the user participated in (`distinct("meeting")`).
2. Filter: `$or: [{host: me}, {_id: {$in: those}}]`.
3. In parallel: paginated `find` (skip/limit, `populate("host","name username")`) and `countDocuments`.
4. **Aggregation** for participant counts: `$match` on these meetings → `$group` by meeting with `$addToSet: "$user"` → **distinct users**, so rejoins aren't double-counted.
5. Compute `durationSeconds` (uses "now" if the meeting is still active) and `totalPages`.

---

## 6. Server in-memory state ([socketManager.js](backend/src/controllers/socketManager.js))

```js
connections[meetingCode]      = [socketId, ...]                       // WebRTC mesh membership
roomParticipants[meetingCode] = Map<socketId, {userId,name,micOn,cameraOn}>  // live roster
socketSessions[socketId]      = {meetingCode, meetingId, userId, name} // reverse lookup
```
**Interview point:** this state lives in one Node process's memory. That's why the server **can't be horizontally scaled as-is** (see §8).

---

## 7. Testing ([backend/tests](backend/tests))

- **Supertest** sends real HTTP requests to the Express `app`. That's why `app.js` is separate from `server.js`: tests import the app without connecting to MongoDB or opening a port.
- **Mongoose models are mocked** with `jest.unstable_mockModule`, which is required for ES modules. A `chainableQuery()` helper fakes Mongoose's chainable, awaitable query (`find().sort().limit()` with a `then`).
- Covered: register (success, 409 duplicate, 400 validation), login (success returns a JWT, 401 wrong password, same 401 for an unknown user), auth middleware (missing or garbage token), create meeting, join (404 / 410 / success / latest messages in chronological order), end (host succeeds, non-host gets 403), paginated history.
- Run with `npm test` in `backend/`. It uses `--experimental-vm-modules` for ESM Jest and `--runInBand`.
- **Not covered (say it before they ask):** socket handlers, frontend, real-DB integration. Next steps: `mongodb-memory-server` for integration tests, `socket.io-client` tests against a live server, Playwright for a 2-browser call.

---

## 8. Limitations and how you'd fix them — *be ready, interviewers love this*

Raising these yourself shows maturity. Pick 3–4 to bring up.

**Already fixed by you (rows marked ✅):** #4, #8 and #10. Tell these as stories: *"I noticed X, it caused Y, I fixed it with Z and added a test."*

| # | Issue | Why it matters | Fix |
|---|---|---|---|
| 1 | **Mesh topology** | Upload bandwidth and CPU grow with n. Breaks around 5+ people. | **SFU** (mediasoup / LiveKit). Simulcast for quality layers. |
| 2 | **STUN only, no TURN** | Users behind symmetric NAT or corporate firewalls can't connect (often ~10–20%). | Run **coturn** with short-lived credentials issued by the backend. |
| 3 | **In-memory socket state** | Two server instances don't share rooms. A restart wipes the state. | **Redis**: `@socket.io/redis-adapter` for cross-node broadcast, room state in Redis, sticky sessions at the load balancer. |
| 4 ✅ | **Chat history returned the *oldest* 50, not the latest** | `sort({createdAt: 1}).limit(50)` in `joinMeeting`. Long meetings showed stale chat. | **Fixed:** sort `-1`, limit, reverse in memory. Test asserts order. Next step: cursor pagination for older messages. |
| 5 | **`user-joined` makes every existing client rebuild a peer connection for *every* peer** | Old connections aren't closed (leak), and later renegotiations hit unnegotiated objects. | Existing clients create a PC only for the **new** id. Close and replace properly. |
| 6 | **Deprecated WebRTC APIs** (`addStream`, `onaddstream`) | Removed from the spec and may disappear. | `addTrack` / `ontrack`. For screen share use `RTCRtpSender.replaceTrack()`, which needs **no renegotiation**. |
| 7 | **No "perfect negotiation"** | Toggling media makes everyone re-offer, so glare is possible. | The MDN *perfect negotiation* pattern (polite/impolite peer, `onnegotiationneeded`). |
| 8 ✅ | **`signal` relayed to any socket id** | A user could send signaling to sockets in other rooms. | **Fixed:** relay only if `connections[session.meetingCode].includes(toId)`. Never to self or from a socket not in a room. |
| 9 | **JWT in localStorage, 7-day, no revocation** | XSS could steal it, and logout doesn't invalidate it. | Short access token + refresh token in an **httpOnly, Secure, SameSite** cookie. Rotation plus denylist. |
| 10 ✅ | **Login gave 404 for unknown user vs 401 for bad password** | **Username enumeration.** | **Fixed:** always 401 with the same message, and bcrypt-compare against a dummy hash for unknown users so response *timing* matches too. Note: `/register` returning 409 still reveals taken usernames, which is inherent to sign-up. Rate limiting is the mitigation. |
| 11 | **No rate limiting / helmet** | Brute-force on login, socket spam. | `express-rate-limit`, `helmet`, per-socket event throttling. |
| 12 | **`endMeeting` does two writes without a transaction** | A partial failure leaves inconsistent state. | Mongo **transaction** (needs a replica set), or idempotent retry. |
| 13 | **`MeetingRoom.jsx` is ~700 lines** with module-level `connections` and `window.localStream` | Hard to test. Globals survive across mounts. | Extract a `useWebRTC` hook / `PeerManager` class. Use refs instead of globals. |
| 14 | **No meeting access control** | Anyone with the code and an account can join. | Waiting room / host admit, meeting passwords. |
| 15 | `getPermissions` calls `getUserMedia` three times and reads state from a stale closure | Extra permission prompts, and the "available" flags can be wrong. | One `getUserMedia` call; read results from local variables. |

**Honesty tip:** if asked "did you write all of it?", answer truthfully. The WebRTC mesh pattern here is a common one, and many tutorials use the same shape. Say what *you* added: the lifecycle model, JWT on sockets, participant sync, validation, the error layer, tests, and reconnect handling. Then show you understand the weak spots (the table above). That lands far better than claiming everything.

---

## 9. Likely interview questions, with answers

**Q1. Walk me through what happens when I click "Join".**
→ §5 Join: REST join (validates, records the session, returns roster and chat) → authenticated socket → `join-room` → `user-joined` → newcomer offers → answers and ICE relayed → P2P media.

**Q2. Why WebRTC instead of streaming video through your server?**
Latency (no extra hop), cost (the server carries no media bandwidth), and built-in encryption. The trade-off is that mesh doesn't scale, which is where an SFU comes in.

**Q3. What is signaling? Why do you need a server at all if it's P2P?**
Peers must exchange SDP and ICE candidates before they can connect, and they can't reach each other yet. The socket server is that rendezvous point. It also handles chat, roster and auth.

**Q4. What's STUN vs TURN? What happens if STUN fails?**
STUN tells you your public address so a direct path can be tried. TURN relays the media when no direct path works. I only have STUN, so some NATs fail. Adding coturn is the fix.

**Q5. How would you scale this to 100 people in a room? To 10,000 concurrent meetings?**
100 per room: an SFU, simulcast, and only forwarding active speakers or visible tiles. Many meetings: stateless API nodes behind a load balancer, Socket.IO Redis adapter plus sticky sessions, room state in Redis, SFU nodes assigned per room, TURN clusters, MongoDB replica set and indexes (already in place), and possibly sharding by meeting id.

**Q6. How do you authenticate a WebSocket connection?**
The JWT is passed in the Socket.IO handshake (`auth.token`). `io.use()` middleware verifies it before the connection is accepted and stores the user on `socket.data.user`. Every later event trusts `socket.data` and the server's own session map, never the payload.

**Q7. Why JWT over sessions?**
Stateless, so there's no session store, and the same token works for REST and sockets. Downsides: no instant revocation, and a larger payload. For production I'd use short access tokens plus httpOnly refresh cookies.

**Q8. Where do you store the token, and is that safe?**
localStorage, which is vulnerable to XSS. React escapes output by default, which helps, but httpOnly cookies are safer. With cookies you then need CSRF protection (SameSite).

**Q9. How do you handle a user closing the tab mid-call?**
The Socket.IO `disconnect` fires on the server (via heartbeat or ping timeout) → `removeFromRoom` cleans the maps, notifies peers (`user-left`, `participant-left`), and sets `leftAt` in the DB.

**Q10. How does reconnect work?**
Socket.IO retries automatically. On `reconnect`, the client resets all peer connections and does a full re-join (REST + `join-room`), because the socket id changed and the server already dropped the old membership. Clean rebuild beats patching state.

**Q11. How do you prevent someone from spoofing a chat sender name?**
The server ignores client-supplied identity. `senderName` comes from `socketSessions`, which came from the verified JWT.

**Q12. Why separate `app.js` and `server.js`?**
Testability. Supertest imports `app` without opening a port, connecting MongoDB, or starting Socket.IO.

**Q13. How do you handle errors in async Express handlers?**
The `asyncHandler` wrapper forwards rejections to `next`. `ApiError` carries status and details, and one `errorHandler` formats responses and hides internals for unknown errors. (Express 5 forwards async errors natively.)

**Q14. Why Zod?**
Declarative schemas, coercion (query strings to numbers), readable field errors, and reuse for socket payloads. Validation happens before the DB is touched, which the tests check explicitly.

**Q15. How are meeting codes generated? Collisions?**
`crypto.randomInt` over a 26-letter alphabet, in a 3-4-3 format: about 1.4×10^14 possibilities. Check-then-insert retries up to 5 times, and the **unique index** prevents duplicates even under a race.

**Q16. Why 410 for an ended meeting?**
410 Gone means the resource existed but is permanently unavailable. That's more precise than 404, so the UI can say "meeting has ended".

**Q17. Explain the history aggregation.**
`$match` meetings on the page → `$group` by meeting with `$addToSet` of user ids → count the set. Distinct users means rejoins aren't double-counted. Pagination uses skip/limit plus `countDocuments` in parallel.

**Q18. What indexes do you have and why?**
`meetingCode` unique (lookup and dedupe), `{host, createdAt:-1}` (my meetings, newest first), `{meeting, user}` (participant lookups), `{meeting, createdAt}` (chat in order), `username` unique (login).

**Q19. Skip/limit pagination problems?**
Large skips are slow (Mongo still walks skipped docs), and inserts shift pages. Cursor-based pagination (`createdAt < lastSeen`) fixes both.

**Q20. Why does each rejoin create a new Participant document?**
Per-session accuracy of join and leave times. Distinct-user counting happens at read time.

**Q21. How does screen sharing work?**
`getDisplayMedia` → replace the local stream on every peer and renegotiate. Better: `sender.replaceTrack(screenTrack)`, which needs no renegotiation. `track.onended` (the browser's "Stop sharing" button) switches back to the camera.

**Q22. What's glare and how do you avoid it?**
Both peers send offers at once. Mitigated here because only the newcomer offers on join. Media toggles can still collide, and the full fix is the perfect-negotiation pattern.

**Q23. Why both REST and Socket.IO for "end meeting"?**
REST persists the authoritative state (DB, proper status codes, auth). The socket event notifies connected clients in real time. The server re-checks host status on the socket side too.

**Q24. CORS?**
Restricted to `CLIENT_ORIGIN` for both Express and Socket.IO (least privilege). It falls back to `*` only if unset.

**Q25. What would you add next?**
TURN, SFU, Redis adapter, refresh tokens, rate limiting, waiting room, recording (via the SFU), active-speaker detection, `useWebRTC` refactor, E2E tests, Docker + CI.

**Q26. Biggest bug or challenge you hit?**
Pick one you can tell well: the reconnect problem (new socket id, so rebuild cleanly), or the tab-close problem (sessions never got `leftAt` until the disconnect handler wrote it), or async errors crashing Express (fixed with asyncHandler). Use STAR: Situation, Task, Action, Result.

**Q27. How is React state managed?**
Context (`AuthContext`) holds the user and API methods. Local `useState` handles UI. **Refs and module-level maps hold `RTCPeerConnection` objects**, because they're mutable, non-renderable objects. Putting them in state would cause re-renders and stale closures. `useCallback` on `getHistory` keeps the effect dependency stable. The History page uses a `cancelled` flag to avoid setting state after unmount or a page change (a race).

**Q28. How do you test something that needs a DB without one?**
Mock the model modules and fake the chainable query. Trade-off: you don't test real queries or indexes, so I'd add `mongodb-memory-server` integration tests.

---

## 10. Rapid-fire facts sheet

- Ports: backend **8000**, frontend **5173** (Vite). `npm run dev` at the root runs both.
- Env vars: `PORT`, `MONGO_URI`, `CLIENT_ORIGIN`, `JWT_SECRET` (the server refuses to start without it). Frontend uses `VITE_API_URL`.
- API base: `/api/v1`. Health check: `GET /health`.
- Endpoints: `POST /auth/register`, `POST /auth/login`, `POST /meetings`, `GET /meetings/history`, `POST /meetings/:code/join|leave|end`.
- Socket events, client → server: `join-room`, `signal`, `chat-message`, `media-state`, `leave-room`, `end-meeting`.
- Socket events, server → client: `participant-list`, `user-joined`, `participant-joined`, `signal`, `chat-message`, `participant-state`, `user-left`, `participant-left`, `meeting-ended`, `room-error`.
- Status codes used: 201, 200, 400 (validation), 401, 403 (non-host end), 404, 409 (duplicate username), 410 (ended meeting), 500.
- Body size limit: 40 kb. Chat max: 2000 chars. History `limit` max: 50. JWT expiry: 7d. bcrypt cost: 10.
- Frontend routes: `/`, `/auth`, `/home`, `/history`, `/meeting/:code`.

---

## 11. How to practice (do this before the interview)

1. Run it: `npm run install:all`, copy both `.env.example` files to `.env`, start MongoDB, then `npm run dev`. Open two browsers (or one normal and one incognito), log in as two users, and join the same code.
2. Open DevTools → `chrome://webrtc-internals` during a call and look at ICE candidates and the selected candidate pair. Being able to say you did this impresses people.
3. Say the 2-minute pitch out loud 3 times.
4. Draw the architecture diagram (§2) and the handshake (§3.2) on paper from memory.
5. Answer Q1, Q5, Q6, Q9 and Q26 out loud without looking.
6. Re-read the diffs for fixes #4, #8 and #10 (in `meeting.controller.js`, `socketManager.js` and `auth.controller.js`) so you can explain each line.
