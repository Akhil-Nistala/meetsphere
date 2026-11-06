import { Server } from "socket.io";
import jwt from "jsonwebtoken";

import { Meeting } from "../models/meeting.model.js";
import { Participant } from "../models/participant.model.js";
import { Message } from "../models/message.model.js";
import { chatMessageSchema, mediaStateSchema } from "../validators/meeting.validator.js";

// meetingCode -> array of socket ids (used for the WebRTC signaling mesh)
const connections = {};

// meetingCode -> Map<socketId, { userId, name, micOn, cameraOn }> (used for the participant panel)
const roomParticipants = {};

// socketId -> { meetingCode, meetingId, userId, name } — lets disconnect/chat handlers
// find "which room was this socket in" without scanning every room.
const socketSessions = {};

const authenticateSocket = (socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
        return next(new Error("Authentication required"));
    }

    try {
        socket.data.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        next(new Error("Invalid or expired token"));
    }
};

const removeFromRoom = async (io, socket) => {
    const session = socketSessions[socket.id];
    if (!session) return;

    const { meetingCode, meetingId, userId } = session;

    if (connections[meetingCode]) {
        connections[meetingCode] = connections[meetingCode].filter((id) => id !== socket.id);
        if (connections[meetingCode].length === 0) delete connections[meetingCode];
    }

    roomParticipants[meetingCode]?.delete(socket.id);
    if (roomParticipants[meetingCode]?.size === 0) delete roomParticipants[meetingCode];

    io.to(meetingCode).emit("user-left", socket.id);
    io.to(meetingCode).emit("participant-left", { socketId: socket.id });

    delete socketSessions[socket.id];

    // Best-effort: mark this participant's session as ended even if they
    // never explicitly clicked "Leave" (e.g. closed the tab, lost network).
    try {
        await Participant.findOneAndUpdate(
            { meeting: meetingId, user: userId, leftAt: null },
            { leftAt: new Date() },
            { sort: { joinedAt: -1 } }
        );
    } catch (err) {
        console.error("Failed to record participant leave on disconnect:", err.message);
    }
};

export const connectToSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: process.env.CLIENT_ORIGIN || "*",
            methods: ["GET", "POST"]
        }
    });

    io.use(authenticateSocket);

    io.on("connection", (socket) => {
        const { id: userId, name } = socket.data.user;

        socket.on("join-room", async (payload) => {
            const meetingCode = payload?.meetingCode;
            if (!meetingCode) return;

            const meeting = await Meeting.findOne({ meetingCode, status: "active" });
            if (!meeting) {
                socket.emit("room-error", { message: "Meeting not found or already ended" });
                return;
            }

            socket.join(meetingCode);

            connections[meetingCode] = connections[meetingCode] || [];
            connections[meetingCode].push(socket.id);

            roomParticipants[meetingCode] = roomParticipants[meetingCode] || new Map();
            roomParticipants[meetingCode].set(socket.id, { userId, name, micOn: true, cameraOn: true });

            socketSessions[socket.id] = { meetingCode, meetingId: meeting._id.toString(), userId, name };

            // Send the joining client the full current roster (for the participant panel)
            // and the list of socket ids already in the room (for the WebRTC mesh setup).
            socket.emit(
                "participant-list",
                Array.from(roomParticipants[meetingCode].entries()).map(([socketId, p]) => ({ socketId, ...p }))
            );

            for (const socketId of connections[meetingCode]) {
                io.to(socketId).emit("user-joined", socket.id, connections[meetingCode]);
            }

            socket.to(meetingCode).emit("participant-joined", { socketId: socket.id, userId, name, micOn: true, cameraOn: true });
        });

        // Only relay signaling between sockets in the same meeting — otherwise
        // any authenticated user could push SDP/ICE at arbitrary socket ids.
        socket.on("signal", (toId, message) => {
            const session = socketSessions[socket.id];
            if (!session || toId === socket.id) return;
            if (!connections[session.meetingCode]?.includes(toId)) return;

            io.to(toId).emit("signal", socket.id, message);
        });

        socket.on("chat-message", async (payload) => {
            const session = socketSessions[socket.id];
            if (!session) return;

            const result = chatMessageSchema.safeParse(payload);
            if (!result.success) return;

            const { text } = result.data;
            const { meetingCode, meetingId, userId: senderId, name: senderName } = session;

            io.to(meetingCode).emit("chat-message", {
                text,
                senderName,
                senderSocketId: socket.id,
                createdAt: new Date().toISOString()
            });

            try {
                await Message.create({ meeting: meetingId, sender: senderId, senderName, text });
            } catch (err) {
                console.error("Failed to persist chat message:", err.message);
            }
        });

        socket.on("media-state", (payload) => {
            const session = socketSessions[socket.id];
            if (!session) return;

            const result = mediaStateSchema.safeParse(payload);
            if (!result.success) return;

            const { micOn, cameraOn } = result.data;
            const { meetingCode, meetingId, userId } = session;

            const participant = roomParticipants[meetingCode]?.get(socket.id);
            if (participant) {
                participant.micOn = micOn;
                participant.cameraOn = cameraOn;
            }

            socket.to(meetingCode).emit("participant-state", { socketId: socket.id, micOn, cameraOn });

            Participant.findOneAndUpdate(
                { meeting: meetingId, user: userId, leftAt: null },
                { micOn, cameraOn },
                { sort: { joinedAt: -1 } }
            ).catch((err) => console.error("Failed to persist media state:", err.message));
        });

        socket.on("leave-room", () => {
            removeFromRoom(io, socket);
        });

        // The REST /meetings/:code/end call is what actually persists "ended"
        // state; this just lets the host notify everyone still connected so
        // their clients can hang up instead of talking to a dead room.
        socket.on("end-meeting", async () => {
            const session = socketSessions[socket.id];
            if (!session) return;

            const { meetingCode, meetingId, userId } = session;
            const meeting = await Meeting.findById(meetingId);
            if (!meeting || meeting.host.toString() !== userId) return;

            io.to(meetingCode).emit("meeting-ended");

            for (const socketId of connections[meetingCode] || []) {
                io.sockets.sockets.get(socketId)?.leave(meetingCode);
            }
            delete connections[meetingCode];
            delete roomParticipants[meetingCode];
        });

        socket.on("disconnect", () => {
            removeFromRoom(io, socket);
        });
    });

    return io;
};
