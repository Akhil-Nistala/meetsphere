# Lumen

A full-stack video conferencing app — sign in, share a meeting code, and jump into a WebRTC video call with live chat.

- **Frontend:** React 19 + Vite, React Router, MUI
- **Backend:** Node.js, Express, Socket.IO (signaling), MongoDB/Mongoose

## Project structure

```
lumen-meet/
├── backend/   # Express API + Socket.IO signaling server
└── frontend/  # React + Vite client
```

## Getting started

Set up your env files first, then install and run both apps together from the root:

```bash
cp backend/.env.example backend/.env    # then fill in MONGO_URI
cp frontend/.env.example frontend/.env  # points to your backend URL

npm install
npm run install:all
npm run dev
```

This runs the backend (`http://localhost:8000`) and frontend (`http://localhost:5173`) together.

To run them separately instead:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## Environment variables

**backend/.env**

| Variable | Description |
| --- | --- |
| `PORT` | Port the API/socket server listens on (default `8000`) |
| `MONGO_URI` | MongoDB connection string |
| `CLIENT_ORIGIN` | Allowed CORS origin for the frontend |

**frontend/.env**

| Variable | Description |
| --- | --- |
| `VITE_API_URL` | Base URL of the backend API/socket server |

## Features

- Email/username + password auth (bcrypt-hashed, token-based sessions)
- Instant or scheduled meetings via a shareable meeting code
- Peer-to-peer video/audio over WebRTC, with screen sharing
- In-call chat
- Meeting history per user
