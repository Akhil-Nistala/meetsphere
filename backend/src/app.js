import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import mongoose from "mongoose";
import cors from "cors";

import { connectToSocket } from "./controllers/socketManager.js";
import userRoutes from "./routes/users.routes.js";

const app = express();
const server = createServer(app);
const io = connectToSocket(server);

const PORT = process.env.PORT || 8000;
const MONGO_URI = process.env.MONGO_URI;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ limit: "40kb", extended: true }));

app.use("/api/v1/users", userRoutes);

const start = async () => {
    if (!MONGO_URI) {
        throw new Error("MONGO_URI is not set. Copy .env.example to .env and fill it in.");
    }

    const connectionDb = await mongoose.connect(MONGO_URI);
    console.log(`MongoDB connected: ${connectionDb.connection.host}`);

    server.listen(PORT, () => {
        console.log(`Lumen Meet server listening on port ${PORT}`);
    });
};

start().catch((err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
});
