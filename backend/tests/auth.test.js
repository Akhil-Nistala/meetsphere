import { jest } from "@jest/globals";

// The model layer is mocked so these are fast HTTP-contract tests that don't
// need a live database. Integration-testing against a real MongoDB would be
// a natural next step (e.g. via mongodb-memory-server in CI).
const mockUser = {
    findOne: jest.fn(),
    create: jest.fn()
};

jest.unstable_mockModule("../src/models/user.model.js", () => ({ User: mockUser }));

const bcrypt = (await import("bcryptjs")).default;
const request = (await import("supertest")).default;
const { default: app } = await import("../src/app.js");

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

    it("logs in with correct credentials and returns a JWT", async () => {
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

    it("returns 404 for an unknown username", async () => {
        mockUser.findOne.mockResolvedValue(null);

        const res = await request(app)
            .post("/api/v1/auth/login")
            .send({ username: "ghost", password: "password123" });

        expect(res.status).toBe(404);
    });
});
