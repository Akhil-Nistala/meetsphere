import { jest } from "@jest/globals";

// The model layer is mocked so these are fast HTTP-contract tests that don't
// need a live database. Integration-testing against a real MongoDB would be
// a natural next step (e.g. via mongodb-memory-server in CI).
const mockUser = {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn()
};

jest.unstable_mockModule("../src/models/user.model.js", () => ({ User: mockUser }));

const bcrypt = (await import("bcryptjs")).default;
const request = (await import("supertest")).default;
const { default: app } = await import("../src/app.js");
const jwt = (await import("jsonwebtoken")).default;
const { signSessionToken } = await import("../src/utils/tokens.js");

const sessionCookieFrom = (res) =>
    (res.headers["set-cookie"] ?? []).find((c) => c.startsWith("token="));

// The JWT inside the Set-Cookie header.
const tokenFrom = (cookie) => decodeURIComponent(cookie.split(";")[0].split("=")[1]);

describe("POST /api/v1/auth/register", () => {
    beforeEach(() => jest.clearAllMocks());

    it("registers a new user", async () => {
        mockUser.findOne.mockResolvedValue(null);
        mockUser.create.mockResolvedValue({ _id: "u1", username: "alice123", name: "Alice" });

        const res = await request(app)
            .post("/api/v1/auth/register")
            .send({ name: "Alice", username: "alice123", password: "password123" });

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ success: true, message: "User registered successfully" });
        expect(mockUser.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: "Alice", username: "alice123" })
        );
    });

    it("rejects a duplicate username with 409", async () => {
        mockUser.findOne.mockResolvedValue({ _id: "u1", username: "alice123" });

        const res = await request(app)
            .post("/api/v1/auth/register")
            .send({ name: "Alice", username: "alice123", password: "password123" });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(mockUser.create).not.toHaveBeenCalled();
    });

    it("rejects invalid input before it reaches the database", async () => {
        const res = await request(app)
            .post("/api/v1/auth/register")
            .send({ name: "", username: "ab", password: "123" });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(mockUser.findOne).not.toHaveBeenCalled();
    });
});

describe("POST /api/v1/auth/login", () => {
    beforeEach(() => jest.clearAllMocks());

    it("logs in with correct credentials, setting the session JWT in an httpOnly cookie", async () => {
        const hashedPassword = await bcrypt.hash("password123", 10);
        mockUser.findOne.mockResolvedValue({
            _id: "u1",
            username: "alice123",
            name: "Alice",
            password: hashedPassword
        });

        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ username: "alice123", password: "password123" });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.user).toEqual({ id: "u1", username: "alice123", name: "Alice" });
        // The token is only in the cookie, never in the body where JavaScript could read it.
        expect(res.body.token).toBeUndefined();

        const cookie = sessionCookieFrom(res);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
        const payload = jwt.verify(tokenFrom(cookie), "test-secret");
        expect(payload).toMatchObject({ id: "u1", username: "alice123", name: "Alice" });
        expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
    });

    it("rejects the wrong password with 401", async () => {
        const hashedPassword = await bcrypt.hash("password123", 10);
        mockUser.findOne.mockResolvedValue({
            _id: "u1",
            username: "alice123",
            name: "Alice",
            password: hashedPassword
        });

        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ username: "alice123", password: "wrong-password" });

        expect(res.status).toBe(401);
    });

    it("returns the same 401 for an unknown username as for a wrong password", async () => {
        mockUser.findOne.mockResolvedValue(null);

        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ username: "ghost", password: "password123" });

        expect(res.status).toBe(401);
        expect(res.body.message).toBe("Invalid username or password");
    });
});

describe("POST /api/v1/auth/logout", () => {
    it("clears the session cookie", async () => {
        const res = await request(app).post("/api/v1/auth/logout");

        expect(res.status).toBe(200);
        expect(sessionCookieFrom(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    });
});

describe("GET /api/v1/auth/me", () => {
    beforeEach(() => jest.clearAllMocks());

    const user = { _id: "u1", username: "alice123", name: "Alice" };
    const cookie = () => `token=${signSessionToken(user)}`;

    it("returns the logged-in user from the cookie", async () => {
        mockUser.findById.mockResolvedValue(user);

        const res = await request(app).get("/api/v1/auth/me").set("Cookie", cookie());

        expect(res.status).toBe(200);
        expect(res.body.user).toEqual({ id: "u1", username: "alice123", name: "Alice" });
    });

    it("returns 401 without a cookie", async () => {
        const res = await request(app).get("/api/v1/auth/me");
        expect(res.status).toBe(401);
    });

    it("returns 401 for a tampered cookie", async () => {
        const res = await request(app).get("/api/v1/auth/me").set("Cookie", "token=not.a.jwt");
        expect(res.status).toBe(401);
    });
});

describe("GET /api/v1/auth/socket-token", () => {
    it("returns a one-minute token that only the socket server accepts", async () => {
        const user = { _id: "u1", username: "alice123", name: "Alice" };

        const res = await request(app)
            .get("/api/v1/auth/socket-token")
            .set("Cookie", `token=${signSessionToken(user)}`);

        expect(res.status).toBe(200);
        const payload = jwt.verify(res.body.token, "test-secret");
        expect(payload).toMatchObject({ id: "u1", name: "Alice", purpose: "socket" });
        expect(payload.exp - payload.iat).toBe(60);
    });

    it("returns 401 without a session cookie", async () => {
        const res = await request(app).get("/api/v1/auth/socket-token");
        expect(res.status).toBe(401);
    });
});
