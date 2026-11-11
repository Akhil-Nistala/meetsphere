import { jest } from "@jest/globals";

// The model layer is mocked so these are fast HTTP-contract tests that don't
// need a live database. Integration-testing against a real MongoDB would be
// a natural next step (e.g. via mongodb-memory-server in CI).
const mockUser = {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn()
};

const mockRefreshToken = {
    create: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn()
};

jest.unstable_mockModule("../src/models/user.model.js", () => ({ User: mockUser }));
jest.unstable_mockModule("../src/models/refreshToken.model.js", () => ({ RefreshToken: mockRefreshToken }));

const bcrypt = (await import("bcryptjs")).default;
const request = (await import("supertest")).default;
const { default: app } = await import("../src/app.js");
const { hashToken } = await import("../src/utils/tokens.js");

const refreshCookieFrom = (res) =>
    (res.headers["set-cookie"] ?? []).find((c) => c.startsWith("refreshToken="));

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

    it("logs in with correct credentials, returning a JWT and an httpOnly refresh cookie", async () => {
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
        expect(typeof res.body.token).toBe("string");

        const cookie = refreshCookieFrom(res);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toContain("Path=/api/v1/auth");
        // Only the hash is persisted, never the raw token.
        const rawToken = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
        expect(mockRefreshToken.create).toHaveBeenCalledWith(
            expect.objectContaining({ user: "u1", tokenHash: hashToken(rawToken) })
        );
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

describe("POST /api/v1/auth/refresh", () => {
    beforeEach(() => jest.clearAllMocks());

    const user = { _id: "u1", username: "alice123", name: "Alice" };
    const storedToken = (overrides = {}) => ({
        _id: "rt1",
        user: "u1",
        family: "fam1",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        ...overrides
    });

    it("rejects a request with no refresh cookie", async () => {
        const res = await request(app).post("/api/v1/auth/refresh");

        expect(res.status).toBe(401);
        expect(mockRefreshToken.findOne).not.toHaveBeenCalled();
    });

    it("rejects an unknown refresh token", async () => {
        mockRefreshToken.findOne.mockResolvedValue(null);

        const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", "refreshToken=bogus");

        expect(res.status).toBe(401);
        expect(mockRefreshToken.findOne).toHaveBeenCalledWith({ tokenHash: hashToken("bogus") });
    });

    it("rotates a valid token: revokes the old one, issues a new one in the same family", async () => {
        mockRefreshToken.findOne.mockResolvedValue(storedToken());
        mockRefreshToken.findOneAndUpdate.mockResolvedValue(storedToken());
        mockUser.findById.mockResolvedValue(user);

        const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", "refreshToken=good-token");

        expect(res.status).toBe(200);
        expect(typeof res.body.token).toBe("string");
        expect(res.body.user).toEqual({ id: "u1", username: "alice123", name: "Alice" });

        expect(mockRefreshToken.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: "rt1", revokedAt: null },
            expect.objectContaining({ revokedAt: expect.any(Date) })
        );
        expect(mockRefreshToken.create).toHaveBeenCalledWith(
            expect.objectContaining({ user: "u1", family: "fam1" })
        );

        const newCookie = refreshCookieFrom(res);
        expect(newCookie).toBeDefined();
        expect(newCookie).not.toContain("refreshToken=good-token");
    });

    it("treats reuse of a revoked token as theft and revokes the whole family", async () => {
        mockRefreshToken.findOne.mockResolvedValue(storedToken({ revokedAt: new Date() }));

        const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", "refreshToken=old-token");

        expect(res.status).toBe(401);
        expect(mockRefreshToken.updateMany).toHaveBeenCalledWith(
            { family: "fam1", revokedAt: null },
            expect.objectContaining({ revokedAt: expect.any(Date) })
        );
        expect(mockRefreshToken.create).not.toHaveBeenCalled();
    });

    it("rejects an expired token", async () => {
        mockRefreshToken.findOne.mockResolvedValue(storedToken({ expiresAt: new Date(Date.now() - 1000) }));

        const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", "refreshToken=stale");

        expect(res.status).toBe(401);
        expect(mockRefreshToken.create).not.toHaveBeenCalled();
    });

    it("rejects the loser of a concurrent refresh race without issuing a token", async () => {
        mockRefreshToken.findOne.mockResolvedValue(storedToken());
        mockUser.findById.mockResolvedValue(user);
        mockRefreshToken.findOneAndUpdate.mockResolvedValue(null); // someone else revoked it first

        const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", "refreshToken=raced");

        expect(res.status).toBe(401);
        expect(mockRefreshToken.create).not.toHaveBeenCalled();
    });
});

describe("POST /api/v1/auth/logout", () => {
    beforeEach(() => jest.clearAllMocks());

    it("revokes the token family and clears the cookie", async () => {
        mockRefreshToken.findOne.mockResolvedValue({ _id: "rt1", family: "fam1" });

        const res = await request(app).post("/api/v1/auth/logout").set("Cookie", "refreshToken=good-token");

        expect(res.status).toBe(200);
        expect(mockRefreshToken.updateMany).toHaveBeenCalledWith(
            { family: "fam1", revokedAt: null },
            expect.objectContaining({ revokedAt: expect.any(Date) })
        );
        expect(refreshCookieFrom(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it("succeeds even without a cookie", async () => {
        const res = await request(app).post("/api/v1/auth/logout");

        expect(res.status).toBe(200);
        expect(mockRefreshToken.updateMany).not.toHaveBeenCalled();
    });
});
