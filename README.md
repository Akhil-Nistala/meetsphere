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

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # then fill in MONGO_URI
npm run dev
```

The server starts on `http://localhost:8000` by default.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # points to your backend URL
npm run dev
```

The app starts on `http://localhost:5173` by default.

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
