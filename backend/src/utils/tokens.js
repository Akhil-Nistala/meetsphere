import jwt from "jsonwebtoken";

export const AUTH_COOKIE_NAME = "token";
const SESSION_DAYS = 7;

const claimsFor = (user) => ({ id: user._id.toString(), username: user.username, name: user.name });

export const signSessionToken = (user) =>
    jwt.sign(claimsFor(user), process.env.JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });

export const verifySessionToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

// The Socket.IO server is reached directly, not through the frontend's /api
// proxy (it can't carry WebSockets), so the session cookie isn't sent with the
// handshake. Instead the client fetches this short-lived token through the
// proxy, where the cookie is sent, and passes it in the handshake. `purpose`
// keeps it from being usable anywhere else.
export const signSocketToken = (user) =>
    jwt.sign({ id: user.id, username: user.username, name: user.name, purpose: "socket" }, process.env.JWT_SECRET, {
        expiresIn: "1m"
    });

// httpOnly: page JavaScript can't read the token, so an XSS bug can't steal it.
// secure: HTTPS-only in production.
// sameSite: "lax" means the browser won't attach the cookie to cross-site
// POSTs (basic CSRF protection). That works locally (same site, different
// ports) and in production when the frontend proxies /api to the backend, so
// the cookie is first-party; render.yaml sets COOKIE_SAMESITE=lax for that.
// If the frontend calls the API on another site directly, browsers only send
// the cookie with SameSite=None, which requires Secure, hence the default.
const cookieOptions = () => {
    const isProduction = process.env.NODE_ENV === "production";
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: process.env.COOKIE_SAMESITE || (isProduction ? "none" : "lax")
    };
};

export const setSessionCookie = (res, user) =>
    res.cookie(AUTH_COOKIE_NAME, signSessionToken(user), {
        ...cookieOptions(),
        maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
    });

export const clearSessionCookie = (res) => res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
