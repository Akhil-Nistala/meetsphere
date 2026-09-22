import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";

const mockMeeting = {
    exists: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    updateOne: jest.fn()
};

const mockParticipant = {
    create: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
    aggregate: jest.fn()
};

const mockMessage = {
    find: jest.fn()
};

jest.unstable_mockModule("../src/models/meeting.model.js", () => ({ Meeting: mockMeeting }));
jest.unstable_mockModule("../src/models/participant.model.js", () => ({ Participant: mockParticipant }));
jest.unstable_mockModule("../src/models/message.model.js", () => ({ Message: mockMessage }));

const request = (await import("supertest")).default;
const { default: app } = await import("../src/app.js");

// A mongoose Query is chainable (find().sort().limit()...) and only resolves
// when awaited. This stands in for that shape without needing a real DB.
const chainableQuery = (result) => {
    const query = {};
    ["sort", "skip", "limit", "select", "populate"].forEach((method) => {
        query[method] = jest.fn(() => query);
    });
    query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
    return query;
};

const authHeader = (overrides = {}) => {
    const token = jwt.sign({ id: "user1", username: "alice", name: "Alice", ...overrides }, process.env.JWT_SECRET);
    return `Bearer ${token}`;
};

describe("auth middleware", () => {
    it("rejects requests with no token", async () => {
        const res = await request(app).post("/api/v1/meetings");
        expect(res.status).toBe(401);
    });

    it("rejects requests with a garbage token", async () => {
        const res = await request(app).post("/api/v1/meetings").set("Authorization", "Bearer not-a-real-token");
        expect(res.status).toBe(401);
    });
});

describe("POST /api/v1/meetings", () => {
    beforeEach(() => jest.clearAllMocks());

    it("creates a meeting for the authenticated host", async () => {
        mockMeeting.exists.mockResolvedValue(false);
        mockMeeting.create.mockResolvedValue({
            meetingCode: "abc-defg-hij",
            status: "active",
            startedAt: new Date()
        });

        const res = await request(app).post("/api/v1/meetings").set("Authorization", authHeader());

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.meeting.meetingCode).toBe("abc-defg-hij");
        expect(mockMeeting.create).toHaveBeenCalledWith(
            expect.objectContaining({ host: "user1", status: "active" })
        );
    });
});

describe("POST /api/v1/meetings/:code/join", () => {
    beforeEach(() => jest.clearAllMocks());

    it("returns 404 when the meeting doesn't exist", async () => {
        mockMeeting.findOne.mockResolvedValue(null);

        const res = await request(app)
            .post("/api/v1/meetings/nope-nope-nope/join")
            .set("Authorization", authHeader());

        expect(res.status).toBe(404);
    });

    it("returns 410 when the meeting has already ended", async () => {
        mockMeeting.findOne.mockResolvedValue({ status: "ended" });

        const res = await request(app)
            .post("/api/v1/meetings/abc-defg-hij/join")
            .set("Authorization", authHeader());

        expect(res.status).toBe(410);
    });

    it("joins an active meeting and returns the roster + recent messages", async () => {
        mockMeeting.findOne.mockResolvedValue({
            _id: "m1",
            meetingCode: "abc-defg-hij",
            host: { toString: () => "user1" },
            status: "active",
            startedAt: new Date()
        });
        mockParticipant.create.mockResolvedValue({});
        mockParticipant.find.mockReturnValue(chainableQuery([{ user: "user1", name: "Alice" }]));
        mockMessage.find.mockReturnValue(chainableQuery([]));

        const res = await request(app)
            .post("/api/v1/meetings/abc-defg-hij/join")
            .set("Authorization", authHeader());

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.meeting.isHost).toBe(true);
        expect(res.body.participants).toHaveLength(1);
    });
});

describe("POST /api/v1/meetings/:code/end", () => {
    beforeEach(() => jest.clearAllMocks());

    it("lets the host end the meeting", async () => {
        mockMeeting.findOne.mockResolvedValue({ _id: "m1", host: { toString: () => "user1" } });
        mockMeeting.updateOne.mockResolvedValue({});
        mockParticipant.updateMany.mockResolvedValue({});

        const res = await request(app)
            .post("/api/v1/meetings/abc-defg-hij/end")
            .set("Authorization", authHeader());

        expect(res.status).toBe(200);
        expect(mockMeeting.updateOne).toHaveBeenCalled();
        expect(mockParticipant.updateMany).toHaveBeenCalled();
    });

    it("blocks a non-host from ending the meeting", async () => {
        mockMeeting.findOne.mockResolvedValue({ _id: "m1", host: { toString: () => "someone-else" } });

        const res = await request(app)
            .post("/api/v1/meetings/abc-defg-hij/end")
            .set("Authorization", authHeader());

        expect(res.status).toBe(403);
        expect(mockMeeting.updateOne).not.toHaveBeenCalled();
    });
});

describe("GET /api/v1/meetings/history", () => {
    beforeEach(() => jest.clearAllMocks());

    it("returns paginated meeting history for the user", async () => {
        mockParticipant.find.mockReturnValue({ distinct: jest.fn().mockResolvedValue([]) });
        mockMeeting.find.mockReturnValue(
            chainableQuery([
                {
                    _id: "m1",
                    meetingCode: "abc-defg-hij",
                    host: { name: "Alice", username: "alice" },
                    status: "ended",
                    startedAt: new Date(Date.now() - 3600_000),
                    endedAt: new Date()
                }
            ])
        );
        mockMeeting.countDocuments.mockResolvedValue(1);
        mockParticipant.aggregate.mockResolvedValue([{ _id: "m1", count: ["user1", "user2"] }]);

        const res = await request(app)
            .get("/api/v1/meetings/history?page=1&limit=10")
            .set("Authorization", authHeader());

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.total).toBe(1);
        expect(res.body.data[0]).toMatchObject({ meetingCode: "abc-defg-hij", participantCount: 2 });
    });
});
