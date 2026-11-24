import bcrypt from "bcryptjs";

import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { clearSessionCookie, setSessionCookie, signSocketToken } from "../utils/tokens.js";

const publicUser = (user) => ({ id: user._id, username: user.username, name: user.name });

const register = asyncHandler(async (req, res) => {
    const { name, username, password } = req.body;

    const existingUser = await User.findOne({ username });
    if (existingUser) {
        throw new ApiError(409, "Username already taken");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ name, username, password: hashedPassword });

    res.status(201).json({ success: true, message: "User registered successfully" });
});

// Compared against when the username doesn't exist, so "unknown user" and
// "wrong password" take about the same time and can't be told apart by timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

const login = asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    const user = await User.findOne({ username });

    // Same status and message for both failure cases, so the endpoint can't be
    // used to discover which usernames are registered.
    const isPasswordCorrect = await bcrypt.compare(password, user?.password ?? DUMMY_PASSWORD_HASH);
    if (!user || !isPasswordCorrect) {
        throw new ApiError(401, "Invalid username or password");
    }

    setSessionCookie(res, user);
    res.status(200).json({ success: true, user: publicUser(user) });
});

const logout = (req, res) => {
    clearSessionCookie(res);
    res.status(200).json({ success: true, message: "Logged out" });
};

// Lets the frontend ask "who am I?" on load, since it can't read the
// httpOnly cookie itself.
const me = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        throw new ApiError(401, "Account not found");
    }
    res.status(200).json({ success: true, user: publicUser(user) });
});

// A one-minute token for the Socket.IO handshake (see signSocketToken).
const socketToken = (req, res) => {
    res.status(200).json({ success: true, token: signSocketToken(req.user) });
};

export { login, logout, me, register, socketToken };
