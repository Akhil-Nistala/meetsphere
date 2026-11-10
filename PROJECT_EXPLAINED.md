# MeetSphere, Explained From Scratch

This guide assumes you know basic JavaScript and nothing else. It builds up every idea the project uses, then walks through **every file**, then traces one full call between two people, event by event.

For interview Q&A and the pitch, see [INTERVIEW_PREP.md](INTERVIEW_PREP.md). This file is the "understand everything" companion to it.

**Contents**
1. The story: what the app does
2. Foundations: every concept you need
3. The folder map
4. Backend, file by file (in the order the server boots)
5. Frontend, file by file (in the order the browser loads)
6. The tests
7. Full trace: Alice and Bob, from sign-up to "meeting ended"
8. Glossary

---

## 1. The story

1. Alice opens the site and sees the **landing page**. She clicks "Get Started" and lands on the **auth page**.
2. She **registers** (name, username, password), then **logs in**. The server gives her a **token**, a signed digital pass that proves who she is.
3. On the **home page** she clicks **New Meeting**. The server creates a meeting with a code like `kqz-mwpa-trx`, and she's taken to `/meeting/kqz-mwpa-trx`.
4. In the **lobby** she sees her own camera preview. She clicks **Join Meeting**.
5. She sends the code to Bob. Bob logs in, types the code on his home page, and joins.
6. Now they see and hear each other. **The video goes directly from Alice's browser to Bob's**, not through the server.
7. They chat (messages are saved), toggle mic and camera (each sees the other's icons change), and maybe share a screen.
8. Alice is the **host**, so she sees **End for everyone**. Clicking it ends the meeting, and Bob is kicked out with an alert.
9. Both can open **History** and see the meeting with its date, duration, and participant count.

Three "channels" make this work:

| Channel | Used for | Analogy |
|---|---|---|
| **HTTP / REST** (Axios → Express) | Accounts, creating/joining/ending meetings, history | Filling in a form at a counter: one request, one reply |
| **WebSocket** (Socket.IO) | Live stuff: who's here, chat, mic/cam state, connection setup | An open phone line: either side can talk any time |
| **WebRTC** | The actual audio/video | A private cable laid directly between two browsers |

---

## 2. Foundations

Read this section once. Everything later refers back to it.

### 2.1 Client and server
- The **client** is the browser running the React app (the `frontend/` folder).
- The **server** is a Node.js program running on a computer (the `backend/` folder). It listens on **port 8000**.
- In development, the frontend is served by Vite on **port 5173**. Two different ports count as two different **origins**, which matters for CORS (§2.13).

### 2.2 HTTP, REST, JSON, status codes
- **HTTP** is the request/response protocol of the web. A request has a **method** (GET = read, POST = create or do an action), a **URL**, **headers** (metadata such as `Authorization`), and an optional **body**.
- **JSON** is the text format for data: `{"username": "alice", "password": "..."}`.
- **REST** is a convention: URLs name *things* (`/meetings`, `/meetings/:code`), and methods say what to do with them. This project's API lives under `/api/v1/...`. The `v1` lets you release a `v2` later without breaking old clients.
- **Status codes** say how it went:

| Code | Meaning | Where MeetSphere uses it |
|---|---|---|
| 200 | OK | Login, join, leave, end, history |
| 201 | Created | Register, create meeting |
| 400 | Bad request | Zod validation failed |
| 401 | Not authenticated | Missing/bad token, wrong login |
| 403 | Authenticated but not allowed | Non-host tries to end a meeting |
| 404 | Not found | Unknown meeting or route |
| 409 | Conflict | Username already taken |
| 410 | Gone | Meeting existed but has ended |
| 500 | Server bug | Anything unexpected |

### 2.3 Node.js, npm, `package.json`
- **Node.js** runs JavaScript outside the browser, which is how the server is written in JS.
- **npm** installs libraries (**packages**) into `node_modules/`.
- **`package.json`** lists a project's dependencies and **scripts**. `npm run dev` runs whatever the `"dev"` script says.
- `dependencies` are needed at runtime. `devDependencies` are only needed while developing or testing (Jest, nodemon).
- `"type": "module"` means the files use **ES modules** (`import x from "y"`) instead of the older CommonJS (`require`).
- The `^` in `"express": "^4.19.2"` means "any 4.x version at or above 4.19.2".

### 2.4 Asynchronous JavaScript: promises and `async/await`
Database calls and network requests take time. JS doesn't stop and wait for them. It gets a **Promise**, an object that will later hold the result or an error.
```js
const user = await User.findOne({ username });  // pause THIS function until the DB answers
```
`await` only works inside an `async` function. Errors from an awaited promise are thrown, so you catch them with `try/catch`.
`Promise.all([a, b])` runs `a` and `b` **at the same time** and waits for both. The project uses this for speed in several places.

### 2.5 Environment variables
Secrets and settings that differ per machine (database URL, JWT secret) are kept out of the code, in a `.env` file that is **git-ignored**. `.env.example` is the committed template that shows which variables exist. The `dotenv` package reads `.env` into `process.env` at startup. Frontend variables must start with `VITE_` and are read via `import.meta.env`, because Vite only exposes those to the browser.

### 2.6 MongoDB and Mongoose
- **MongoDB** is a **document database**. Instead of tables and rows, it stores JSON-like **documents** in **collections**. Every document gets a unique `_id` (an **ObjectId**).
- **Mongoose** is a library that adds structure to it:
  - A **Schema** describes the fields: type, required, unique, default.
  - A **Model** (`mongoose.model("Meeting", schema)`) is the object you query with: `Meeting.find`, `Meeting.create`, and so on. Mongoose names the collection `meetings` (lowercase, plural).
  - `{ timestamps: true }` adds `createdAt` and `updatedAt` automatically.
  - `ref: "User"` says "this field holds a User's `_id`". `.populate("host")` swaps that id for the actual user document, similar to a SQL join.
  - An **index** (`schema.index({ host: 1, createdAt: -1 })`) is a sorted lookup structure that makes queries on those fields fast. Without one, MongoDB scans every document. `1` means ascending, `-1` descending. `unique: true` also creates an index, and rejects duplicates.
- Mongoose queries are **chainable** and lazy: `Message.find(...).sort(...).limit(...)` only runs when you `await` it.

### 2.7 Express and middleware (the most important backend idea)
**Express** is a small web framework. You register **handlers** for URL + method combinations.

**Middleware** is a function `(req, res, next)` that sits in a pipeline. Each request flows through the middleware in order, and each one can:
- **Modify** the request (for example, attach `req.user`), then call `next()` to pass it on.
- **Reply** early (`res.status(401).json(...)`), which ends the pipeline.
- **Report an error** with `next(err)`, which jumps straight to the error handler.

For `POST /api/v1/meetings/abc-defg-hij/join`, the pipeline is:
```
cors → express.json → router match → requireAuth → validate(params) → joinMeeting controller
                                         │ error anywhere ↓
                                      errorHandler → JSON error response
```
An **error-handling middleware** has **four** parameters: `(err, req, res, next)`. That's how Express recognizes it.

A **Router** groups related routes under a prefix (`/api/v1/auth`, `/api/v1/meetings`).

A **controller** is the final handler with the business logic ("create a meeting", "log in").

### 2.8 Validation with Zod
Never trust input from a client. **Zod** lets you describe the expected shape:
```js
z.object({ username: z.string().trim().min(3), password: z.string().min(6) })
```
`schema.safeParse(data)` returns `{ success: true, data }` (cleaned data) or `{ success: false, error }`. `z.coerce.number()` turns the string `"2"` from a URL query into the number `2`.

### 2.9 Passwords: hashing with bcrypt
You never store passwords. You store a **hash**, a one-way scramble.
- `bcrypt.hash("pw", 10)` produces something like `$2a$10$N9qo8uLOickgx2ZMRZoMye...`. That string contains the algorithm, the **cost** (10 means 2^10 rounds, deliberately slow), the **salt** (random data, so identical passwords get different hashes), and the hash itself.
- `bcrypt.compare("pw", storedHash)` re-hashes using the salt inside the stored string and checks for a match.
- If the database leaks, attackers get hashes that are slow and expensive to crack.

### 2.10 Authentication with JWT
A **JWT** (JSON Web Token) looks like `xxxxx.yyyyy.zzzzz`:
- **Header**: the algorithm.
- **Payload**: data, here `{ id, username, name, iat, exp }`. This is only base64-encoded, **not encrypted**, so anyone can read it.
- **Signature**: an HMAC computed from the header, payload, and the server's **secret**. If anyone changes the payload, the signature no longer matches.

Flow: log in → the server **signs** a token → the client stores it → the client sends `Authorization: Bearer <token>` on every request → the server **verifies** the signature and expiry. No session table is needed (**stateless**). The downside: a token stays valid until it expires (7 days here), even after logout.

### 2.11 React basics (everything the frontend uses)
- A **component** is a function that returns **JSX**, HTML-like syntax inside JS: `<Button onClick={go}>Join</Button>`.
- **Props** are inputs passed to a component, like function arguments.
- **`useState`**: `const [x, setX] = useState(0)`. Calling `setX` stores the new value and **re-renders** the component. `setX(prev => prev + 1)` is the "functional update" form, which is safe when the new value depends on the old one.
- **`useEffect(fn, [deps])`**: run side effects (fetching, subscriptions) **after** render. They re-run when a dependency changes. `[]` means once on mount. The function `fn` may return a **cleanup** function.
- **`useRef`**: a box (`ref.current`) that **survives re-renders without causing them**. It's used for DOM elements (`<video ref={...}>`) and for mutable values like the socket.
- **`useContext`**: read shared data without passing props down through every level. A **Context Provider** wraps the app and supplies a value.
- **`useCallback(fn, deps)`**: returns the same function object across renders, so effects that depend on it don't re-run needlessly.
- **Higher-Order Component (HOC)**: a function that takes a component and returns a wrapped one. `withAuth(Home)` is an example.
- **StrictMode** (development only) runs effects twice to expose bugs. That's why in dev you may see the camera permission logic run twice.

### 2.12 React Router, Vite, MUI, CSS Modules
- **React Router** maps URLs to components without full page reloads. `useNavigate()` changes the URL from code. `useParams()` reads `:code` from `/meeting/:code`.
- **Vite** is the dev server and bundler. `npm run dev` serves the app with instant hot reload. `npm run build` produces optimized static files.
- **MUI** (Material UI) is a library of ready-made components (`Button`, `TextField`, `Badge`, icons). The `sx` prop is MUI's inline styling.
- **CSS Modules** (`meetingRoom.module.css`): class names are made unique per file, so `.chatRoom` here can't clash with a `.chatRoom` elsewhere. You use them as `className={styles.chatRoom}`.

### 2.13 CORS
Browsers block a page on origin A (`localhost:5173`) from reading responses from origin B (`localhost:8000`) unless B says it's allowed. The server replies with `Access-Control-Allow-Origin: http://localhost:5173`. That's what `cors({ origin: CLIENT_ORIGIN })` does. Allowing only your own frontend is **least privilege**.

### 2.14 WebSockets and Socket.IO
HTTP is "ask, get one answer". For live updates the server needs to **push** to clients. A **WebSocket** is a persistent two-way connection. **Socket.IO** builds on it and adds:
- **Named events**: `socket.emit("chat-message", data)` on one side, `socket.on("chat-message", handler)` on the other.
- **Rooms**: `socket.join("kqz-mwpa-trx")`, then `io.to("kqz-mwpa-trx").emit(...)` reaches everyone in that room.
- **Middleware** (`io.use`) for authentication before connecting.
- **Auto-reconnect** after network drops, plus a fallback to HTTP long-polling.
- Every connection gets a random **socket id**. A **new one is assigned on every reconnect.**

Emit cheat sheet (server side):
| Code | Who receives |
|---|---|
| `socket.emit(e)` | Only this client |
| `socket.to(room).emit(e)` | Everyone in the room **except** this client |
| `io.to(room).emit(e)` | Everyone in the room, including this client |
| `io.to(socketId).emit(e)` | One specific client (every socket is auto-joined to a room named after its id) |

### 2.15 WebRTC (the video part)
Goal: send camera and mic directly between browsers.

**Step 0: get media.** `navigator.mediaDevices.getUserMedia({ video: true, audio: true })` asks permission and returns a **MediaStream** containing **tracks** (one video, one audio). `getDisplayMedia()` captures the screen instead. Setting `videoElement.srcObject = stream` shows it.

**Step 1: create a connection object.** `new RTCPeerConnection({ iceServers: [STUN] })`, one per remote person.

**Step 2: agree on the media format (SDP offer/answer).**
- The caller runs `createOffer()`, producing an **SDP**: a text description of codecs, tracks, and encryption fingerprints. It calls `setLocalDescription(offer)` and sends the offer to the other side.
- The receiver runs `setRemoteDescription(offer)` → `createAnswer()` → `setLocalDescription(answer)` and sends the answer back.
- The caller runs `setRemoteDescription(answer)`. Now both agree.

**Step 3: find a network path (ICE).** Most computers sit behind a home router (**NAT**) and only know their private IP, like `192.168.1.5`. The browser gathers **ICE candidates**, possible addresses:
- **host**: the local IP.
- **srflx** (server-reflexive): the public IP:port, discovered by asking a **STUN** server "what address do you see me coming from?".
- **relay**: an address on a **TURN** server that forwards media when nothing else works. *MeetSphere has no TURN server.*

Each candidate fires `onicecandidate` and must be sent to the other peer, which calls `addIceCandidate`. The browsers test candidate pairs and pick one that works.

**Step 4: media flows**, encrypted (DTLS-SRTP), directly peer to peer. The remote side gets an event with the remote stream (`onaddstream` in this code) and shows it in a `<video>`.

**Who carries the offers, answers, and candidates?** WebRTC doesn't say. You need a **signaling** channel. In MeetSphere that's Socket.IO's `signal` event. **That is the main reason the socket server exists.**

**Mesh:** with N people, each browser holds N−1 peer connections and uploads its video N−1 times. That's fine for small calls and heavy beyond about 5 people.

---

## 3. The folder map

```
MeetSphere/
├── package.json              root: "npm run dev" starts backend + frontend together (concurrently)
├── README.md, LICENSE (MIT)
├── backend/
│   ├── package.json          server deps + scripts (dev = nodemon, test = jest)
│   ├── .env.example          PORT, MONGO_URI, CLIENT_ORIGIN, JWT_SECRET
│   ├── jest.config.cjs       test config (.cjs because Jest's config loader wants CommonJS here)
│   ├── src/
│   │   ├── server.js         ENTRY POINT: checks env, connects DB, starts HTTP + Socket.IO
│   │   ├── app.js            builds the Express app (middleware + routes + error handler)
│   │   ├── config/db.js      connects to MongoDB
│   │   ├── routes/           URL → middleware → controller wiring
│   │   ├── middleware/       requireAuth, validate, errorHandler
│   │   ├── validators/       Zod schemas
│   │   ├── controllers/      business logic (auth, meetings) + socketManager (realtime)
│   │   ├── models/           Mongoose schemas: User, Meeting, Participant, Message
│   │   └── utils/            ApiError, asyncHandler, generateMeetingCode
│   └── tests/                Jest + Supertest
└── frontend/
    ├── index.html            the single HTML page; React mounts into <div id="root">
    ├── vite.config.js
    ├── .env.example          VITE_API_URL
    └── src/
        ├── main.jsx          ENTRY POINT: renders <App/>
        ├── App.jsx           routes
        ├── config/api.js     backend URL
        ├── context/AuthContext.jsx   user state + every API call
        ├── utils/withAuth.jsx        "must be logged in" wrapper
        ├── pages/            Landing, Authentication, Home, History, MeetingRoom
        ├── styles/meetingRoom.module.css
        └── App.css, index.css, assets/ (images)
```

The pattern **routes → middleware → controllers → models** is a layered architecture (**separation of concerns**). Each layer has one job, so you can change or test one without touching the others.

---

## 4. Backend, file by file

### 4.1 [`backend/package.json`](backend/package.json)
- `dev`: `nodemon src/server.js`. nodemon restarts the server whenever a file changes.
- `start`: plain `node` for production.
- `test`: `cross-env NODE_OPTIONS=--experimental-vm-modules jest --runInBand`.
  - `cross-env` sets an environment variable in a way that works on both Windows and Mac/Linux.
  - `--experimental-vm-modules` lets Jest run ES-module code.
  - `--runInBand` runs test files one after another instead of in parallel workers, which is simpler and more predictable.

### 4.2 [`src/server.js`](backend/src/server.js): the entry point
In order:
1. `import "dotenv/config"` loads `.env` into `process.env`.
2. If `JWT_SECRET` is missing, it **throws**. **Fail fast**: better to refuse to start than to run with broken auth.
3. `await connectDB(MONGO_URI)`. The server doesn't accept traffic until the database is ready.
4. `createServer(app)` builds a plain Node HTTP server, using the Express app as its request handler. An Express app *is* a function `(req, res)`.
5. `connectToSocket(server)` attaches Socket.IO to the **same** server. One port serves both REST and WebSockets. A WebSocket starts life as an HTTP request that gets "upgraded".
6. `server.listen(PORT)`.
7. `start().catch(...)` logs the error and `process.exit(1)` if anything above fails.

### 4.3 [`src/config/db.js`](backend/src/config/db.js)
Throws a helpful message if `MONGO_URI` isn't set, otherwise `mongoose.connect(uri)` and returns the host name for the log line.

### 4.4 [`src/app.js`](backend/src/app.js): the Express app
```js
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "*" }));   // §2.13
app.use(express.json({ limit: "40kb" }));                       // parse JSON bodies into req.body
app.use(express.urlencoded({ limit: "40kb", extended: true })); // parse form-encoded bodies
app.get("/health", ...)                                         // "am I alive?" for monitoring
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/meetings", meetingRoutes);
app.use(notFoundHandler);   // nothing matched → 404
app.use(errorHandler);      // must be LAST
```
- The **40 kb limit** stops someone sending a 1 GB body to exhaust memory.
- **Order matters**: middleware runs top to bottom, so the 404 and error handlers go at the end.
- `app.js` is **separate from** `server.js` so tests can import the app without a database or an open port.

### 4.5 Routes
[`routes/auth.routes.js`](backend/src/routes/auth.routes.js):
```js
router.post("/register", validate(registerSchema), register);
router.post("/login",    validate(loginSchema),    login);
```
Validation runs first, so the controller only ever sees clean data.

[`routes/meeting.routes.js`](backend/src/routes/meeting.routes.js):
```js
router.use(requireAuth);                       // EVERY meeting route needs a valid token
router.post("/", createMeeting);
router.get("/history", validate(historyQuerySchema, "query"), getHistory);
router.post("/:code/join",  validate(meetingCodeParamSchema, "params"), joinMeeting);
router.post("/:code/leave", ...leaveMeeting);
router.post("/:code/end",   ...endMeeting);
```
- `:code` is a **route parameter**. For `/abc-defg-hij/join`, `req.params.code === "abc-defg-hij"`.
- `/history` is declared before `/:code/...`. It wouldn't clash anyway (different methods and shapes), but putting specific routes before parameterized ones is a good habit.

### 4.6 Middleware
**[`auth.middleware.js`](backend/src/middleware/auth.middleware.js) — `requireAuth`**
1. Read the `Authorization` header and take what follows `"Bearer "` (that's what `slice(7)` does: `"Bearer "` is 7 characters).
2. No token → `next(new ApiError(401, "Missing authentication token"))`.
3. `jwt.verify(token, secret)` checks the signature **and** expiry, and returns the payload.
4. Store it as `req.user` (`{ id, username, name }`) so controllers know who's calling.
5. Verification fails → 401 "Invalid or expired token".

**[`validate.middleware.js`](backend/src/middleware/validate.middleware.js) — `validate(schema, source)`**
A **middleware factory**: a function that *returns* a middleware, so one piece of code works for any schema and for `body`, `query`, or `params`. On failure: `ApiError(400, "Validation failed", fieldErrors)`, where `fieldErrors` looks like `{ password: ["Password must be at least 6 characters"] }`. On success, it **replaces** `req[source]` with the parsed data (trimmed, coerced, defaults applied).

**[`errorHandler.js`](backend/src/middleware/errorHandler.js)**
- `notFoundHandler` turns an unmatched route into a 404 `ApiError`.
- `errorHandler(err, req, res, next)`:
  - An `ApiError` is a **known, intentional** error. Send its status and message, plus `errors` if there are details.
  - Anything else is a **bug**. Log it on the server and send a generic 500 "Something went wrong", so internal details never leak to users.
  - The `eslint-disable` comment exists because `next` is unused, but Express needs all **four** parameters to recognize an error handler.
- Every error response has the same shape: `{ success: false, message, errors? }`. The frontend relies on this, which is why it reads `err.response.data.message`.

### 4.7 Utils
**[`ApiError.js`](backend/src/utils/ApiError.js)** extends the built-in `Error` with `statusCode` and `details`. Controllers just `throw new ApiError(404, "Meeting not found")`.

**[`asyncHandler.js`](backend/src/utils/asyncHandler.js)**
```js
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
```
Express 4 doesn't notice errors thrown inside `async` functions. A rejected promise would be "unhandled", and the request would hang. This wrapper catches the rejection and passes it to `next`, which sends it to `errorHandler`. Every controller is wrapped in it, so controllers can simply `throw`.

**[`generateMeetingCode.js`](backend/src/utils/generateMeetingCode.js)**
Picks random letters from `a–z` using `crypto.randomInt`, a **cryptographically secure** random generator. `Math.random()` is predictable, so someone could guess codes. The format is `3-4-3` letters, e.g. `kqz-mwpa-trx`. That gives 26¹⁰ ≈ 141 trillion possible codes.

### 4.8 Validators
[`auth.validator.js`](backend/src/validators/auth.validator.js):
- `registerSchema`: name (non-empty), username (≥ 3 chars, trimmed), password (≥ 6). Passwords are **not trimmed**, because spaces can be intentional.
- `loginSchema`: just non-empty.

[`meeting.validator.js`](backend/src/validators/meeting.validator.js):
- `meetingCodeParamSchema`: code at least 6 chars.
- `historyQuerySchema`: `page` and `limit` are **coerced** from strings, positive integers, and `limit ≤ 50`, so nobody can request a million rows. Defaults are 1 and 10.
- `chatMessageSchema`: 1–2000 characters.
- `mediaStateSchema`: `micOn` and `cameraOn` are booleans.

The last two are used by the **socket** code, because socket events don't pass through Express middleware.

### 4.9 Models
**[`user.model.js`](backend/src/models/user.model.js)**: `name`, `username` (unique), `password` (the **bcrypt hash**, never plain text), plus timestamps.

**[`meeting.model.js`](backend/src/models/meeting.model.js)**: `meetingCode` (unique), `host` (→ User), `status` (`"active"` | `"ended"`, enforced by `enum`), `startedAt`, `endedAt`. The index `{host:1, createdAt:-1}` serves "meetings I hosted, newest first".

**[`participant.model.js`](backend/src/models/participant.model.js)**: one document per **join session**: `meeting`, `user`, `name`, `micOn`, `cameraOn`, `joinedAt`, `leftAt`.
- `leftAt` empty means "currently in the call".
- If Bob joins, leaves, and rejoins, he gets **two** documents, which keeps every session's times accurate.
- `name` is copied in (**denormalized**) so lists render without a join.

**[`message.model.js`](backend/src/models/message.model.js)**: `meeting`, `sender` (→ User), `senderName`, `text`, plus timestamps. The index `{meeting:1, createdAt:1}` makes "chat for this meeting, in time order" fast.

Why separate collections instead of arrays inside Meeting? Arrays would grow without limit, a single MongoDB document maxes out at **16 MB**, and every chat message would rewrite the whole meeting document.

### 4.10 [`controllers/auth.controller.js`](backend/src/controllers/auth.controller.js)
**`signToken(user)`**: `jwt.sign({ id, username, name }, JWT_SECRET, { expiresIn: "7d" })`. `id` is converted with `.toString()` because an ObjectId is an object, not a string.

**`register`**
1. `User.findOne({ username })`. If it exists → **409** "Username already taken".
2. `bcrypt.hash(password, 10)`.
3. `User.create({ name, username, password: hashed })`.
4. Reply **201**. It does **not** log the user in: the frontend switches to the Sign In tab.

**`login`**
1. `User.findOne({ username })`.
2. `bcrypt.compare(password, user?.password ?? DUMMY_PASSWORD_HASH)`. If the user doesn't exist, it still compares against a pre-computed dummy hash, so the request takes the same time either way.
3. If no user **or** the password is wrong → the **same 401** "Invalid username or password". Attackers can't learn which usernames exist, neither from the message nor from the timing. *(This is one of the fixes you committed.)*
4. On success → **200** with `{ token, user: { id, username, name } }`. The password hash is never sent back.

### 4.11 [`controllers/meeting.controller.js`](backend/src/controllers/meeting.controller.js)
**Helpers**
- `createUniqueMeetingCode()`: generate a code, check `Meeting.exists`, retry up to 5 times. The **unique index** is the real safety net if two requests race.
- `findActiveMeeting(code)`: 404 if missing, **410** if ended.

**`createMeeting`**: creates `{ meetingCode, host: req.user.id, status: "active", startedAt: now }` and replies **201**.

**`joinMeeting`**
1. `findActiveMeeting(code)`.
2. `Participant.create(...)` records a **new session**.
3. In parallel (`Promise.all`):
   - active participants: `leftAt: null`, selecting only needed fields (less data on the wire);
   - the **latest 50 messages**: sort **newest-first** (`createdAt: -1`), `limit(50)`, then `.reverse()` back to chronological order. *(Your fix: before, it returned the oldest 50.)*
4. Reply with meeting info, including `isHost` (comparing `meeting.host.toString()` to `req.user.id`, because you can't compare an ObjectId to a string with `===`), plus participants and messages.

**`leaveMeeting`**: finds the user's **latest open** session (`leftAt: null`, sorted by `joinedAt` descending) and sets `leftAt = now`.

**`endMeeting`**
1. 404 if missing. **403** if `req.user.id` isn't the host. This is **authorization** (what you may do), as opposed to authentication (who you are).
2. In parallel: set the meeting to `status: "ended", endedAt`, and `updateMany` every still-open session's `leftAt = endedAt`.

**`getHistory`**
1. `Participant.find({ user: me }).distinct("meeting")` returns the ids of meetings I ever joined.
2. Filter: `$or: [{ host: me }, { _id: { $in: thoseIds } }]` means "meetings I hosted or joined".
3. In parallel: the page of meetings (`sort newest`, `skip((page-1)*limit)`, `limit`, `populate host name`) and the `countDocuments` total.
4. Participant counts via an **aggregation pipeline**, MongoDB's way of transforming data in steps:
   ```js
   { $match: { meeting: { $in: meetingIds } } },                 // only these meetings' sessions
   { $group: { _id: "$meeting", count: { $addToSet: "$user" } } } // per meeting, a SET of unique users
   ```
   Then `count.length` is the number of distinct people (rejoins aren't double-counted). The results go into a `Map` for quick lookup by meeting id.
5. For each meeting: `durationSeconds` = (`endedAt` or *now* if still active) − `startedAt`, clamped to ≥ 0.
6. Reply with `{ data, page, limit, total, totalPages: ceil(total / limit) }`.

### 4.12 [`controllers/socketManager.js`](backend/src/controllers/socketManager.js): the realtime brain
**Three in-memory maps**, which live in the Node process's RAM, not the database:
```js
connections[meetingCode]      = ["sockA", "sockB"]            // who's in the WebRTC mesh
roomParticipants[meetingCode] = Map(sockA → {userId, name, micOn, cameraOn}, ...)  // roster panel
socketSessions[socketId]      = { meetingCode, meetingId, userId, name }           // reverse lookup
```
`socketSessions` answers "which room is this socket in?" in O(1), with no need to scan every room on disconnect.

**`authenticateSocket` (via `io.use`)**: runs once when a client tries to connect. It reads `socket.handshake.auth.token` (sent by the client as `io(url, { auth: { token } })`), verifies it, and stores the payload in `socket.data.user`. If it fails, `next(new Error(...))` **rejects the connection** entirely.

**`connectToSocket(server)`** creates `new Server(server, { cors })`, registers the auth middleware, then for each connection sets up these handlers:

| Event (client → server) | What the server does |
|---|---|
| `join-room {meetingCode}` | Checks the meeting is **active** in the DB (otherwise emits `room-error`). Runs `socket.join(code)`. Adds the socket to `connections` and `roomParticipants`, and records `socketSessions`. Sends the joiner the full **`participant-list`**. Emits **`user-joined`(newId, allIds)** to **every** socket in the room to kick off WebRTC. Tells the others **`participant-joined`**. |
| `signal (toId, message)` | **Relays** SDP/ICE to `toId`, tagged with the sender's id, **only if** the sender is in a room and `toId` is in the **same** room. *(Your fix.)* |
| `chat-message {text}` | Takes the sender's identity **from `socketSessions`**, never from the payload, so names can't be faked. Validates with Zod. **Broadcasts first** (snappy UI), **then** saves to MongoDB. A save failure is logged, not fatal. |
| `media-state {micOn, cameraOn}` | Validates, updates the roster entry, tells **others** `participant-state`, and saves to the Participant document without waiting for the result ("fire and forget", with a `.catch` so errors are still logged). |
| `leave-room` | Calls `removeFromRoom`. |
| `end-meeting` | Re-checks **from the DB** that this user is the host. Emits **`meeting-ended`** to the room, removes every socket from the room, and deletes the maps. The REST `/end` call already saved "ended"; this is just the live notification. |
| `disconnect` (automatic) | Calls `removeFromRoom`. |

**`removeFromRoom(io, socket)`**: looks up the session, removes the socket from both maps (deleting empty rooms to avoid leaking memory), emits `user-left` (video tiles) and `participant-left` (roster), deletes the session, then sets `leftAt` on the latest open Participant document. That last step is why history stays correct even when someone just **closes the tab** without clicking Leave.

---

## 5. Frontend, file by file

### 5.1 [`index.html`](frontend/index.html) and [`main.jsx`](frontend/src/main.jsx)
The browser loads one HTML page with an empty `<div id="root">` and a script tag for `main.jsx`. `createRoot(...).render(<StrictMode><App/></StrictMode>)` mounts React into that div. From then on React controls the page. This is a **Single-Page Application (SPA)**: page changes are handled in JS, with no full reloads.

### 5.2 [`App.jsx`](frontend/src/App.jsx): routing
```
<Router>                 ← provides URL handling
  <AuthProvider>         ← INSIDE Router because it calls useNavigate()
    <Routes>
      /               → LandingPage
      /auth           → Authentication
      /home           → Home          (protected)
      /history        → History       (protected)
      /meeting/:code  → MeetingRoom   (protected)
```

### 5.3 [`config/api.js`](frontend/src/config/api.js)
`import.meta.env.VITE_API_URL || "http://localhost:8000"`. It's one place to change the backend URL for deployment.

### 5.4 [`context/AuthContext.jsx`](frontend/src/context/AuthContext.jsx): the app's API layer
**`client = axios.create({ baseURL: ".../api/v1" })`** is a pre-configured HTTP client.

**Request interceptor** (runs before every request): reads `token` from `localStorage` and adds `Authorization: Bearer ...`. No component ever handles the token manually.

**`AuthProvider`**
- `userData` state starts from `localStorage.getItem("user")` (a **lazy initializer**: the function runs only on first render). So a page refresh keeps you logged in.
- **Response interceptor** (inside `useEffect`, because it needs `navigate`): if **any** response is **401**, it clears storage, sets the user to null, and navigates to `/auth`. That handles expired tokens globally. The effect's cleanup **ejects** the interceptor so it isn't registered twice.
- Functions it provides to the whole app:
  - `handleRegister` → POST `/auth/register`, returns the success message.
  - `handleLogin` → POST `/auth/login`, saves the token and user to localStorage and state, navigates to `/home`.
  - `handleLogout` → clears everything and navigates to `/auth`. There's no server call because JWTs are stateless.
  - `createMeeting`, `joinMeeting`, `leaveMeeting`, `endMeeting` → the matching meeting endpoints.
  - `getHistory(page, limit)` → wrapped in `useCallback` so the History page's effect doesn't loop.
- `<AuthContext.Provider value={data}>` makes all of this available via `useContext(AuthContext)`.

### 5.5 [`utils/withAuth.jsx`](frontend/src/utils/withAuth.jsx)
A HOC that, after rendering, checks `localStorage` for a token and redirects to `/auth` if there isn't one. This is **only a convenience**: anyone can fake localStorage. **Real protection is the server's `requireAuth`.** Say this in interviews.

### 5.6 [`pages/Landing.jsx`](frontend/src/pages/Landing.jsx)
A static marketing page: nav with Register/Login (both go to `/auth`), a headline, and a "Get Started" link.

### 5.7 [`pages/Authentication.jsx`](frontend/src/pages/Authentication.jsx)
- `formState`: `0` = Sign In, `1` = Sign Up. The Full Name field only shows for Sign Up.
- These are **controlled inputs**: each `TextField`'s `value` comes from state, and `onChange` updates that state. React is the single source of truth for the form.
- `handleAuth`: on login, call `handleLogin` (which navigates on success). On register, call `handleRegister`, clear the fields, show a **Snackbar** toast with the success message, and switch to Sign In.
- Errors show `err.response.data.message`, the server's consistent error shape.

### 5.8 [`pages/Home.jsx`](frontend/src/pages/Home.jsx)
- **New Meeting**: calls `createMeeting()`, then navigates to `/meeting/<code>`. A `creating` flag disables the button so a double-click doesn't create two meetings.
- **Join**: just navigates to `/meeting/<typed code>`. Checking whether the code exists happens later, when the room calls the join API.
- Nav: History button and Logout.

### 5.9 [`pages/History.jsx`](frontend/src/pages/History.jsx)
- An effect fetches `getHistory(page, 10)` whenever `page` changes.
- **The `cancelled` flag**: if you click Next quickly, an older, slower response might arrive after a newer one and overwrite it. The cleanup sets `cancelled = true` for the old request, so its result is ignored. This avoids a **race condition**.
- Each meeting is shown as a card: code, Active/Ended chip, host name (from `populate`), formatted start date, duration (`formatDuration`), and participant count.
- Previous/Next buttons, disabled at the edges.

### 5.10 [`pages/MeetingRoom.jsx`](frontend/src/pages/MeetingRoom.jsx): the big one
Read this section slowly. It covers the whole file.

#### Module-level variables (outside the component)
```js
var connections = {};   // remoteSocketId → RTCPeerConnection
const peerConfigConnections = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
```
Peer connections are raw browser objects, not display data. Keeping them outside React state means changing them doesn't trigger re-renders, and they survive re-renders. `resetPeerConnections()` closes them all and empties the map.
`window.localStream` holds **your own** current MediaStream, as a global.

#### Refs
- `socketRef`: the Socket.IO client.
- `socketIdRef`: **my** socket id, used to skip myself.
- `localVideoref`: my `<video>` element.
- `videoRef`: a mirror of the `videos` array that event handlers can read **without stale closures**. A handler created earlier would otherwise see an old version of the state.

#### State
| State | Meaning |
|---|---|
| `videoAvailable`, `audioAvailable`, `screenAvailable` | Does the device or browser support or allow it? |
| `video`, `audio`, `screen` | Is it currently **on**? These start as `undefined`, which means "not decided yet". |
| `phase` | `"lobby"` → `"connecting"` → `"in-call"` |
| `videos` | Remote streams to render: `[{ socketId, stream }]` |
| `participants` | Remote roster (name, mic, cam) from the socket |
| `messages`, `message`, `newMessages` | Chat log, input box, unread badge count |
| `showModal`, `showParticipants` | Whether the chat and participants panels are open |
| `isHost`, `joinError`, `connectionStatus` | Host button, error text, reconnect banner |

#### Lobby
- On mount, `getPermissions()` asks for camera, then mic, checks whether `getDisplayMedia` exists, then gets a combined stream and shows it in the preview `<video>`.
- Clicking **Join Meeting** runs `connect()`, which calls:
  - `getMedia()`: sets `video` and `audio` to the availability flags. That change triggers the `[video, audio]` effect, which calls `getUserMedia()` to start the real stream.
  - `connectToSocketServer()`.

#### `connectToSocketServer()`
1. `phase = "connecting"`.
2. **REST join** (`joinMeeting(code)`). On failure (404 or 410), show the error and go back to the lobby. On success, store `isHost` and load the chat history.
3. Create the socket: `io(server_url, { auth: { token } })`.
4. `registerSocketListeners(socket)`.
5. `socket.once("connect", () => emit("join-room", { meetingCode }))`. `once` means only the **first** connection does this. Reconnects are handled separately.
6. `phase = "in-call"`.

#### `registerSocketListeners`: every incoming event
| Event | Reaction |
|---|---|
| `connect` | Save my socket id. Status becomes "connected". |
| `disconnect` | Status becomes "reconnecting" (shows the banner). |
| `socket.io.on("reconnect")` | **Clean rebuild**: close all peers, clear videos, call `rejoinRoom()` (REST join again, then `join-room` again). It's needed because the new connection has a **new socket id**. |
| `signal` | `gotMessageFromServer`, explained below. |
| `room-error` | Show the message and go back to the lobby. |
| `meeting-ended` | Alert "The host ended this meeting", then `handleEndCall()`. |
| `user-left` | Remove that video tile. |
| `participant-list` / `-joined` / `-left` / `-state` | Update the roster. The `-joined` handler de-duplicates by socket id first. |
| `chat-message` | `addMessage`. The unread count goes up only for messages from **other** people. |
| `user-joined (id, clients)` | **WebRTC setup**, explained next. |

#### `user-joined`: building the mesh
For **every** socket id in `clients`:
1. `connections[id] = new RTCPeerConnection(STUN config)`.
2. `onicecandidate`: whenever my browser finds a candidate, send `signal(id, {ice})`.
3. `onaddstream`: when the remote stream arrives, add or update that tile in `videos`, keeping `videoRef` in sync.
4. Attach my local stream (`addStream`). If I have none, attach a **black-silence** stream, so the connection still has tracks to negotiate.

Then, **if I am the new joiner** (`id === my id`): for every other peer, `createOffer` → `setLocalDescription` → `signal(peer, {sdp})`. **Only the newcomer makes offers**, which avoids both sides offering at once (glare).

*(Known weakness from the prep guide: existing members also rebuild connections for every peer, not just the newcomer. Old connections leak and later renegotiation gets messy. The fix is to create a connection only for the new id.)*

#### `gotMessageFromServer(fromId, message)`: handling signals
- Parse the JSON. Ignore it if it's from myself.
- If it has an **`sdp`**: `setRemoteDescription`. If that SDP was an **offer**, reply: `createAnswer` → `setLocalDescription` → send the answer back via `signal`.
- If it has an **`ice`** candidate: `addIceCandidate`.

#### Toggling camera and mic
`handleVideo` / `handleAudio` flip the state. The `[video, audio]` effect then:
1. calls `getUserMedia()` to get a fresh stream with the new settings. `getUserMediaSuccess` stops the old tracks, shows the new stream, adds it to **every** peer, and **re-offers**, because changing tracks needs renegotiation;
2. emits `media-state` so others' roster icons update.

If both are off, it just stops the tracks.

#### Screen share
`handleScreen` flips `screen`. An effect calls `getDislayMedia()`, and `getDislayMediaSuccess` swaps in the screen stream and re-offers to everyone. When the browser's **"Stop sharing"** button is pressed, the track's `onended` fires: set `screen = false`, show black-silence briefly, then go back to the camera.

#### Black-silence helpers
- `black()`: draws a black rectangle on a `<canvas>`, then `canvas.captureStream()` gives a video track (disabled).
- `silence()`: an `AudioContext` **oscillator** (tone generator) routed to a media stream gives an audio track (disabled).

These give a peer connection valid tracks even with no camera or mic.

#### Leaving
- `handleLeave`: REST `/leave`, then `handleEndCall`.
- `handleEndForEveryone` (host only): REST `/end`, then emit `end-meeting`, then `handleEndCall`.
- `handleEndCall`: stop my tracks (the camera light goes off), close all peers, disconnect the socket, navigate to `/home`.

#### Chat
`sendMessage` trims the text, ignores empty messages, emits `chat-message`, and clears the box. Enter also sends. The message appears for the sender too, because the server broadcasts with `io.to(room)`, which includes the sender. There's no local echo.

#### Rendering
- **Lobby phase**: greeting, error text, Join button (shows "Joining…" while connecting), local preview.
- **In-call phase**: reconnect banner, chat panel, participants panel ("You" first, then everyone else with mic/cam icons), control bar (camera, mic, screen share if supported, chat with unread **Badge**, participants, red leave button, and **End for everyone** if host), my small video, and the grid of remote videos.
- Remote `<video>` elements use a **callback ref**: `ref={(el) => { if (el && stream) el.srcObject = stream }}`. You can't set `srcObject` through JSX attributes, so you set it on the element directly.
- The local `<video>` is `muted` so you don't hear yourself echo.

### 5.11 Styles
[`meetingRoom.module.css`](frontend/src/styles/meetingRoom.module.css) uses `position: absolute` to layer things: your video at bottom-left, controls along the bottom, panels on the sides, a dark-blue background. `App.css` and `index.css` style the landing, home, and nav pages.

---

## 6. The tests ([`backend/tests/`](backend/tests))

- **[`setup.js`](backend/tests/setup.js)** sets a fake `JWT_SECRET` before anything loads. [`jest.config.cjs`](backend/jest.config.cjs) points to it via `setupFiles`.
- **Mocking the database.** `jest.unstable_mockModule("../src/models/meeting.model.js", () => ({ Meeting: mockMeeting }))` swaps the real model for fake functions (`jest.fn()`). In ES modules, mocks must be registered **before** the code is imported, which is why the app is loaded afterwards with `await import("../src/app.js")`.
- **`chainableQuery(result)`** fakes Mongoose's chainable query. `.sort()`, `.limit()` and the rest return the same object, and its `then` makes it `await`-able.
- **Supertest**: `request(app).post("/api/v1/meetings").set("Authorization", ...)` sends a real HTTP request through the whole Express pipeline (CORS, JSON parsing, auth, validation, controller, error handler) without opening a port.
- `authHeader()` signs a real JWT with the test secret.
- **What's tested** (16 tests): register (success, 409, validation stops bad input before the DB), login (success, wrong password 401, unknown user gets the same 401), auth middleware (no token, garbage token), create meeting, join (404, 410, success, **latest messages in order**), end (host OK, non-host 403), paginated history.
- **What's not**: socket events, the frontend, a real database.

Run: `cd backend && npm test`.

---

## 7. Full trace: Alice and Bob

`→` = HTTP request, `⇢` = socket event, `⇄` = WebRTC.

**Sign-up and login (Alice)**
1. → `POST /api/v1/auth/register {name, username, password}` → cors → json → `validate(registerSchema)` → `register`: not taken → bcrypt → save → **201**.
2. → `POST /api/v1/auth/login` → validate → `login`: compare → `signToken` → **200 {token, user}**. The frontend saves both to localStorage and navigates to `/home`.

**Create**
3. → `POST /api/v1/meetings` (Bearer token) → `requireAuth` sets `req.user` → `createMeeting` → code `kqz-mwpa-trx` → **201**. Navigate to `/meeting/kqz-mwpa-trx`.

**Alice joins**
4. Lobby → camera permission → preview. Click Join.
5. → `POST /meetings/kqz-mwpa-trx/join` → Participant(Alice) created → **200** (isHost: true, no messages yet).
6. Socket connects with the token → `io.use` verifies it → ⇢ `join-room`.
7. Server: meeting active ✓, `connections = [A]`. ⇢ `participant-list [Alice]` to Alice. ⇢ `user-joined(A, [A])` to Alice. She creates no offers, since nobody else is there.

**Bob joins**
8. → Bob's REST join → Participant(Bob) → **200** (isHost: false).
9. ⇢ Bob `join-room` → `connections = [A, B]`.
   - ⇢ `participant-list [Alice, Bob]` to Bob.
   - ⇢ `user-joined(B, [A, B])` to **both** A and B.
   - ⇢ `participant-joined (Bob)` to Alice → Alice's roster shows Bob.
10. Both create an `RTCPeerConnection` for each id. Bob sees `id === myId`, so **Bob offers**:
    - Bob `createOffer` → `setLocalDescription` → ⇢ `signal(A, {sdp: offer})` → server checks A is in Bob's room ✓ → ⇢ `signal(B, offer)` to Alice.
    - Alice `setRemoteDescription(offer)` → `createAnswer` → `setLocalDescription` → ⇢ `signal(B, {sdp: answer})` → relayed to Bob → Bob `setRemoteDescription(answer)`.
    - Meanwhile both send ⇢ `signal(..., {ice})` for each candidate, and each side runs `addIceCandidate`.
11. ⇄ A working candidate pair is found (thanks to STUN). Encrypted media flows **directly** Alice ⇄ Bob. `onaddstream` fires and each sees the other's tile.

**During the call**
12. Bob types "hi" → ⇢ `chat-message {text}` → server: sender from `socketSessions`, Zod ✓ → ⇢ broadcast to the room → saved to `messages`. Alice's badge shows 1.
13. Alice mutes → state change → new stream and re-offer to Bob (⇢ `signal` round-trip) and ⇢ `media-state {micOn: false}` → Bob gets ⇢ `participant-state` and Alice's mic icon turns off. The Participant document is updated.

**Network blip (Bob)**
14. Bob's socket drops → the server's `disconnect` runs `removeFromRoom(B)` → Alice gets ⇢ `user-left` and `participant-left` → Bob's session `leftAt` is set. Bob sees "Reconnecting…".
15. Socket.IO reconnects Bob with a **new id B2** → `reconnect` → reset peers → REST join (new Participant session) → ⇢ `join-room` → steps 9–11 repeat with B2.

**End**
16. Alice clicks **End for everyone** → `POST /meetings/kqz-mwpa-trx/end` → host ✓ → meeting `ended`, all open sessions get `leftAt` → **200**.
17. ⇢ `end-meeting` → server re-checks host in the DB → ⇢ `meeting-ended` to the room → everyone removed, maps deleted.
18. Bob gets the alert → `handleEndCall` (camera off, peers closed, socket closed) → `/home`. Alice does the same.
19. If anyone now tries to join `kqz-mwpa-trx` → **410 Gone**.

**History**
20. → `GET /meetings/history?page=1&limit=10` → validate (coerce) → `getHistory` → Alice: hosted ✓, Bob: joined ✓ → duration ≈ the call length, **participantCount = 2**. Bob's two sessions count once, thanks to `$addToSet`.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Aggregation pipeline** | MongoDB's step-by-step data transformation (`$match`, `$group`, …) |
| **Authentication / Authorization** | Who you are (JWT) / what you're allowed to do (host-only end) |
| **bcrypt / salt / cost** | Slow password hash / random data mixed in / how slow (2^cost rounds) |
| **Controller** | Function holding the business logic for a route |
| **CORS** | Browser rule controlling which origins may call your API |
| **Denormalization** | Copying data (like `name`) into another document to avoid joins |
| **ICE / candidate** | Process / possible network address for a WebRTC connection |
| **Idempotent** | Doing it twice has the same effect as once |
| **Index** | Sorted lookup structure that speeds up queries |
| **Interceptor** | Axios hook that runs on every request or response |
| **JWT** | Signed token: header.payload.signature |
| **Mesh / SFU / MCU** | Everyone-to-everyone / server forwards streams / server mixes streams |
| **Middleware** | `(req, res, next)` function in the request pipeline |
| **NAT** | Router translating private IPs to a public one; why STUN/TURN exist |
| **ObjectId** | MongoDB's 12-byte unique id |
| **Populate** | Mongoose: replace a stored id with the referenced document |
| **Room** | Socket.IO group of sockets you can broadcast to |
| **SDP / offer / answer** | Media description / proposal / acceptance |
| **Signaling** | Exchanging SDP and ICE so peers can connect (here: Socket.IO `signal`) |
| **SPA** | Single-page app: one HTML page, JS swaps the views |
| **Stateless** | Server stores no session; each request carries its own proof (JWT) |
| **STUN / TURN** | "What's my public IP?" server / media relay server |
| **Stale closure** | A function still seeing old state values from when it was created |
| **Zod** | Schema library for validating and coercing input |
