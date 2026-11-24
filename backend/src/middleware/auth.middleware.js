import { ApiError } from "../utils/ApiError.js";
import { AUTH_COOKIE_NAME, verifySessionToken } from "../utils/tokens.js";

// Reads the JWT from the httpOnly cookie, verifies its signature and expiry,
// and exposes its claims ({ id, username, name }) as req.user.
export const requireAuth = (req, res, next) => {
    const token = req.cookies?.[AUTH_COOKIE_NAME];

    if (!token) {
        return next(new ApiError(401, "Not logged in"));
    }

    try {
        req.user = verifySessionToken(token);
        next();
    } catch {
        next(new ApiError(401, "Session expired, please log in again"));
    }
};
