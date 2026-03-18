import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { db } from "@/lib/db";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    invite: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    account: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock Redis with getRedisClient function
const mockRedis = {
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(true),
};

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => mockRedis,
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password"),
  },
}));

describe("Signup API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.incr.mockResolvedValue(1); // Reset rate limit
  });

  describe("GET /api/auth/signup (token validation)", () => {
    it("returns error for missing token", async () => {
      const request = new Request("http://localhost/api/auth/signup");
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Token");
    });

    it("returns error for invalid token", async () => {
      vi.mocked(db.invite.findUnique).mockResolvedValue(null);

      const request = new Request(
        "http://localhost/api/auth/signup?token=invalid"
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.valid).toBe(false);
    });

    it("returns error for expired token", async () => {
      vi.mocked(db.invite.findUnique).mockResolvedValue({
        id: "invite-1",
        token: "valid-token",
        email: "test@example.com",
        expiresAt: new Date(Date.now() - 86400000), // Expired yesterday
        usedAt: null,
        createdAt: new Date(),
        invitedById: "admin-1",
      } as never);

      const request = new Request(
        "http://localhost/api/auth/signup?token=valid-token"
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.valid).toBe(false);
      expect(data.error).toContain("expired");
    });

    it("returns error for already used token", async () => {
      vi.mocked(db.invite.findUnique).mockResolvedValue({
        id: "invite-1",
        token: "valid-token",
        email: "test@example.com",
        expiresAt: new Date(Date.now() + 86400000),
        usedAt: new Date(), // Already used
        createdAt: new Date(),
        invitedById: "admin-1",
      } as never);

      const request = new Request(
        "http://localhost/api/auth/signup?token=valid-token"
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.valid).toBe(false);
    });

    it("returns valid for good token", async () => {
      vi.mocked(db.invite.findUnique).mockResolvedValue({
        id: "invite-1",
        token: "valid-token",
        email: "test@example.com",
        expiresAt: new Date(Date.now() + 86400000),
        usedAt: null,
        createdAt: new Date(),
        invitedById: "admin-1",
      } as never);

      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      const request = new Request(
        "http://localhost/api/auth/signup?token=valid-token"
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.valid).toBe(true);
      expect(data.email).toBe("test@example.com");
    });
  });

  describe("POST /api/auth/signup (registration)", () => {
    it("validates required fields", async () => {
      const request = new Request("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it("validates email format", async () => {
      const request = new Request("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "not-an-email",
          password: "password123",
          token: "valid-token",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.toLowerCase()).toContain("email");
    });

    it("validates password minimum length", async () => {
      const request = new Request("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "test@example.com",
          password: "short",
          token: "valid-token",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("8");
    });

    it("prevents duplicate email registration", async () => {
      vi.mocked(db.invite.findUnique).mockResolvedValue({
        id: "invite-1",
        token: "valid-token",
        email: "test@example.com",
        expiresAt: new Date(Date.now() + 86400000),
        usedAt: null,
        createdAt: new Date(),
        invitedById: "admin-1",
      } as never);

      // The route uses db.$transaction(async (tx) => { tx.user.findUnique(...) })
      // so we need the transaction mock to execute the callback with a tx
      // that returns an existing user
      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        const tx = {
          user: {
            findUnique: vi.fn().mockResolvedValue({
              id: "existing-user",
              email: "test@example.com",
              passwordHash: "hashed",
              role: "USER",
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
            create: vi.fn(),
          },
          account: { create: vi.fn() },
          invite: { update: vi.fn() },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (cb as (tx: any) => Promise<unknown>)(tx);
      });

      const request = new Request("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "test@example.com",
          password: "password123",
          token: "valid-token",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.toLowerCase()).toContain("exists");
    });

    it("enforces rate limiting", async () => {
      // Simulate exceeding rate limit
      mockRedis.incr.mockResolvedValue(6);

      const request = new Request("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "test@example.com",
          password: "password123",
          token: "valid-token",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(429);
    });
  });
});
