import jwt from "jsonwebtoken";
import { ApiError } from "../utils/ApiError.js";

export const requireAuth = (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
        return next(new ApiError(401, "Missing authentication token"));
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        next(new ApiError(401, "Invalid or expired token"));
    }
};
