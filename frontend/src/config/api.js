// Base URL for REST calls. In production builds it defaults to "" (same origin):
// the host proxies /api to the backend (see vercel.json), which keeps the
// refresh-token cookie first-party so browsers that block third-party cookies
// don't log users out.
const apiBaseUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:8000");

// Socket.IO connects to the backend directly, since the static host's proxy
// can't carry WebSockets. Auth travels in the handshake, not in a cookie.
export const socketUrl = import.meta.env.VITE_SOCKET_URL || apiBaseUrl || window.location.origin;

export default apiBaseUrl;
