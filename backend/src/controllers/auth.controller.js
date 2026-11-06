import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const signToken = (user) =>
    jwt.sign({ id: user._id.toString(), username: user.username, name: user.name }, process.env.JWT_SECRET, {
        expiresIn: "7d"
    });

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

    const token = signToken(user);

    res.status(200).json({
        success: true,
        token,
        user: { id: user._id, username: user.username, name: user.name }
    });
});

export { login, register };
