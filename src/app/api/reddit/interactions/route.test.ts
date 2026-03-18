import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, DELETE } from "./route";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    account: {
      findFirst: vi.fn(),
    },
    redditInteraction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getEffectiveUserId: vi.fn(),
}));

// Import after mocking
import { db } from "@/lib/db";
import { auth, getEffectiveUserId } from "@/lib/auth";

// Type-safe mock helpers
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockGetEffectiveUserId = getEffectiveUserId as unknown as ReturnType<
  typeof vi.fn
>;
const mockAccountFindFirst = db.account.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockInteractionFindMany = db.redditInteraction
  .findMany as unknown as ReturnType<typeof vi.fn>;
const mockInteractionFindUnique = db.redditInteraction
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockInteractionDelete = db.redditInteraction
  .delete as unknown as ReturnType<typeof vi.fn>;
const mockInteractionDeleteMany = db.redditInteraction
  .deleteMany as unknown as ReturnType<typeof vi.fn>;

function createRequest(url: string, method = "GET"): Request {
  return new Request(url, { method });
}

describe("Reddit Interactions API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveUserId.mockReturnValue("user1");
  });

  describe("GET /api/reddit/interactions", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);

      const request = createRequest(
        "http://localhost/api/reddit/interactions?accountId=123"
      );
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    it("returns 400 when accountId is missing", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user1" },
        expires: "",
      });

      const request = createRequest("http://localhost/api/reddit/interactions");
      const response = await GET(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "accountId is required" });
    });

    it("returns 404 when account not found", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user1" },
        expires: "",
      });
      mockAccountFindFirst.mockResolvedValueOnce(null);

      const request = createRequest(
        "http://localhost/api/reddit/interactions?accountId=123"
      );
      const response = await GET(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Account not found" });
    });

    it("returns interactions for valid account", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user1" },
        expires: "",
      });
      mockAccountFindFirst.mockResolvedValueOnce({
        id: "acc123",
        userId: "user1",
        name: "Test Account",
        platform: "reddit",
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const mockInteractions = [
        {
          id: "int1",
          accountId: "acc123",
          postId: "post1",
          subreddit: "fitness",
          postTitle: "Best protein?",
          postAuthor: "user2",
          postUrl: "https://reddit.com/r/fitness/post1",
          upvotes: 50,
          commentCount: 10,
          ourComment: "Great question!",
          ourCommentId: "t1_comment1",
          repliedAt: new Date("2024-01-15"),
          createdAt: new Date("2024-01-15"),
          updatedAt: new Date("2024-01-15"),
        },
        {
          id: "int2",
          accountId: "acc123",
          postId: "post2",
          subreddit: "supplements",
          postTitle: "Creatine timing?",
          postAuthor: "user3",
          postUrl: "https://reddit.com/r/supplements/post2",
          upvotes: 100,
          commentCount: 25,
          ourComment: "Pre or post workout works!",
          ourCommentId: "t1_comment2",
          repliedAt: new Date("2024-01-14"),
          createdAt: new Date("2024-01-14"),
          updatedAt: new Date("2024-01-14"),
        },
      ];

      mockInteractionFindMany.mockResolvedValueOnce(mockInteractions);

      const request = createRequest(
        "http://localhost/api/reddit/interactions?accountId=acc123"
      );
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveLength(2);
      expect(data[0].subreddit).toBe("fitness");
      expect(data[1].subreddit).toBe("supplements");

      expect(mockInteractionFindMany).toHaveBeenCalledWith({
        where: { accountId: "acc123" },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    });
  });

  describe("DELETE /api/reddit/interactions", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth.mockResolvedValueOnce(null);

      const request = createRequest(
        "http://localhost/api/reddit/interactions?accountId=123",
        "DELETE"
      );
      const response = await DELETE(request);

      expect(response.status).toBe(401);
    });

    it("returns 400 when neither accountId nor id provided", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user1" },
        expires: "",
      });

      const request = createRequest(
        "http://localhost/api/reddit/interactions",
        "DELETE"
      );
      const response = await DELETE(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "accountId or id is required",
      });
    });

    it("deletes single interaction by id", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user1" },
        expires: "",
      });
      mockInteractionFindUnique.mockResolvedValueOnce({
        id: "int1",
        accountId: "acc123",
        postId: "post1",
        subreddit: "fitness",
        postTitle: "Test",
        postAuthor: "user2",
        postUrl: "https://reddit.com/test",
        upvotes: 10,
        commentCount: 5,
        ourComment: "test",
        ourCommentId: "t1_test",
        repliedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        account: {
          userId: "user1",
        },
      });
      mockInteractionDelete.mockResolvedValueOnce({});

      const request = createRequest(
        "http://localhost/api/reddit/interactions?id=int1",
        "DELETE"
      );
      const response = await DELETE(request);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(mockInteractionDelete).toHaveBeenCalledWith({
        where: { id: "int1" },
      });
    });

    it("returns 404 when deleting non-existent interaction", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user1" },
        expires: "",
      });
      mockInteractionFindUnique.mockResolvedValueOnce(null);

      const request = createRequest(
        "http://localhost/api/reddit/interactions?id=nonexistent",
        "DELETE"
      );
      const response = await DELETE(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Interaction not found",
      });
    });

    it("returns 404 when interaction belongs to different user", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user1" },
        expires: "",
      });
      mockInteractionFindUnique.mockResolvedValueOnce({
        id: "int1",
        accountId: "acc123",
        postId: "post1",
        subreddit: "fitness",
        postTitle: "Test",
        postAuthor: "user2",
        postUrl: "https://reddit.com/test",
        upvotes: 10,
        commentCount: 5,
        ourComment: "test",
        ourCommentId: "t1_test",
        repliedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        account: {
          userId: "different_user",
        },
      });

      const request = createRequest(
        "http://localhost/api/reddit/interactions?id=int1",
        "DELETE"
      );
      const response = await DELETE(request);

      expect(response.status).toBe(404);
    });

    it("deletes all interactions for account", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user1" },
        expires: "",
      });
      mockAccountFindFirst.mockResolvedValueOnce({
        id: "acc123",
        userId: "user1",
        name: "Test Account",
        platform: "reddit",
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockInteractionDeleteMany.mockResolvedValueOnce({
        count: 5,
      });

      const request = createRequest(
        "http://localhost/api/reddit/interactions?accountId=acc123",
        "DELETE"
      );
      const response = await DELETE(request);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(mockInteractionDeleteMany).toHaveBeenCalledWith({
        where: { accountId: "acc123" },
      });
    });

    it("returns 404 when account not found for bulk delete", async () => {
      mockAuth.mockResolvedValueOnce({
        user: { id: "user1" },
        expires: "",
      });
      mockAccountFindFirst.mockResolvedValueOnce(null);

      const request = createRequest(
        "http://localhost/api/reddit/interactions?accountId=nonexistent",
        "DELETE"
      );
      const response = await DELETE(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Account not found" });
    });
  });
});
