import { Meeting } from "../models/meeting.model.js";
import { Participant } from "../models/participant.model.js";
import { Message } from "../models/message.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { generateMeetingCode } from "../utils/generateMeetingCode.js";

const RECENT_MESSAGE_LIMIT = 50;

const createUniqueMeetingCode = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateMeetingCode();
        const exists = await Meeting.exists({ meetingCode: code });
        if (!exists) return code;
    }
    throw new ApiError(500, "Could not generate a unique meeting code, please try again");
};

const findActiveMeeting = async (code) => {
    const meeting = await Meeting.findOne({ meetingCode: code });
    if (!meeting) {
        throw new ApiError(404, "Meeting not found");
    }
    if (meeting.status === "ended") {
        throw new ApiError(410, "This meeting has already ended");
    }
    return meeting;
};

const createMeeting = asyncHandler(async (req, res) => {
    const meetingCode = await createUniqueMeetingCode();

    const meeting = await Meeting.create({
        meetingCode,
        host: req.user.id,
        status: "active",
        startedAt: new Date()
    });

    res.status(201).json({
        success: true,
        meeting: {
            meetingCode: meeting.meetingCode,
            host: req.user.id,
            status: meeting.status,
            startedAt: meeting.startedAt
        }
    });
});

const joinMeeting = asyncHandler(async (req, res) => {
    const { code } = req.params;
    const meeting = await findActiveMeeting(code);

    // Each join creates its own participant record, so a user who leaves and
    // rejoins gets a fresh session (accurate per-session join/leave times)
    // instead of one record being silently reused.
    await Participant.create({
        meeting: meeting._id,
        user: req.user.id,
        name: req.user.name
    });

    const [participants, messages] = await Promise.all([
        Participant.find({ meeting: meeting._id, leftAt: null }).select("user name micOn cameraOn joinedAt"),
        Message.find({ meeting: meeting._id })
            .sort({ createdAt: 1 })
            .limit(RECENT_MESSAGE_LIMIT)
            .select("senderName text createdAt")
    ]);

    res.status(200).json({
        success: true,
        meeting: {
            meetingCode: meeting.meetingCode,
            host: meeting.host,
            status: meeting.status,
            startedAt: meeting.startedAt,
            isHost: meeting.host.toString() === req.user.id
        },
        participants,
        messages
    });
});

const leaveMeeting = asyncHandler(async (req, res) => {
    const { code } = req.params;
    const meeting = await Meeting.findOne({ meetingCode: code });
    if (!meeting) {
        throw new ApiError(404, "Meeting not found");
    }

    await Participant.findOneAndUpdate(
        { meeting: meeting._id, user: req.user.id, leftAt: null },
        { leftAt: new Date() },
        { sort: { joinedAt: -1 } }
    );

    res.status(200).json({ success: true, message: "Left meeting" });
});

const endMeeting = asyncHandler(async (req, res) => {
    const { code } = req.params;
    const meeting = await Meeting.findOne({ meetingCode: code });
    if (!meeting) {
        throw new ApiError(404, "Meeting not found");
    }
    if (meeting.host.toString() !== req.user.id) {
        throw new ApiError(403, "Only the host can end the meeting");
    }

    const endedAt = new Date();

    await Promise.all([
        Meeting.updateOne({ _id: meeting._id }, { status: "ended", endedAt }),
        Participant.updateMany({ meeting: meeting._id, leftAt: null }, { leftAt: endedAt })
    ]);

    res.status(200).json({ success: true, message: "Meeting ended", endedAt });
});

const getHistory = asyncHandler(async (req, res) => {
    const { page, limit } = req.query;

    const participantMeetingIds = await Participant.find({ user: req.user.id }).distinct("meeting");

    const filter = { $or: [{ host: req.user.id }, { _id: { $in: participantMeetingIds } }] };

    const [meetings, total] = await Promise.all([
        Meeting.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate("host", "name username"),
        Meeting.countDocuments(filter)
    ]);

    const meetingIds = meetings.map((m) => m._id);
    const participantCounts = await Participant.aggregate([
        { $match: { meeting: { $in: meetingIds } } },
        { $group: { _id: "$meeting", count: { $addToSet: "$user" } } }
    ]);
    const countByMeeting = new Map(participantCounts.map((c) => [c._id.toString(), c.count.length]));

    const data = meetings.map((meeting) => ({
        meetingCode: meeting.meetingCode,
        host: meeting.host,
        status: meeting.status,
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        durationSeconds: Math.max(
            0,
            Math.round(((meeting.endedAt ?? new Date()) - meeting.startedAt) / 1000)
        ),
        participantCount: countByMeeting.get(meeting._id.toString()) ?? 0
    }));

    res.status(200).json({
        success: true,
        data,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
    });
});

export { createMeeting, joinMeeting, leaveMeeting, endMeeting, getHistory };
