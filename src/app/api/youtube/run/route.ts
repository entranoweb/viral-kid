import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth, getEffectiveUserId } from "@/lib/auth";
import {
  refreshTokenIfNeeded,
  fetchChannelVideos,
  fetchVideoComments,
  postCommentReply,
  type YouTubeComment,
} from "@/lib/youtube/client";

async function createLog(
  accountId: string,
  level: "info" | "warning" | "error" | "success",
  message: string
) {
  await db.log.create({
    data: { accountId, level, message },
  });
}

async function generateReplyWithLLM(
  apiKey: string,
  model: string,
  systemPrompt: string,
  commentContent: string,
  authorName: string,
  videoTitle: string,
  styleOptions: {
    noHashtags: boolean;
    noEmojis: boolean;
    noCapitalization: boolean;
    badGrammar: boolean;
  }
): Promise<string> {
  // Build style instructions
  const styleInstructions: string[] = [];
  if (styleOptions.noHashtags) styleInstructions.push("Do not use hashtags.");
  if (styleOptions.noEmojis) styleInstructions.push("Do not use emojis.");
  if (styleOptions.noCapitalization)
    styleInstructions.push("Use all lowercase letters.");
  if (styleOptions.badGrammar)
    styleInstructions.push("Use casual grammar with minor typos.");

  const fullSystemPrompt = [
    systemPrompt,
    "Keep your reply under 500 characters.",
    ...styleInstructions,
    "IMPORTANT: Output ONLY the reply text itself. Do not include any reasoning, analysis, thinking, explanations, or meta-commentary. Just the raw reply text.",
  ]
    .filter(Boolean)
    .join(" ");

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXTAUTH_URL || "https://viral-kid.app",
        "X-Title": "Viral Kid",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: fullSystemPrompt },
          {
            role: "user",
            content: `Write a reply to this YouTube comment from ${authorName} on your video "${videoTitle}":\n\n"${commentContent}"`,
          },
        ],
        max_tokens: 8000,
        temperature: 0.8,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter error: ${error}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  let reply = message?.content?.trim();

  // Reasoning models may exhaust token budget on thinking (finish_reason: "length")
  // and return empty content. Retry once without reasoning support.
  if (!reply && data.choices?.[0]?.finish_reason === "length") {
    const retryResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXTAUTH_URL || "https://viral-kid.app",
          "X-Title": "Viral Kid",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: fullSystemPrompt },
            {
              role: "user",
              content: `Write a reply to this YouTube comment from ${authorName} on your video "${videoTitle}":\n\n"${commentContent}"`,
            },
          ],
          max_tokens: 8000,
          temperature: 0.8,
        }),
      }
    );

    if (retryResponse.ok) {
      const retryData = await retryResponse.json();
      reply = retryData.choices?.[0]?.message?.content?.trim();
    }
  }

  if (!reply) {
    throw new Error(
      `Empty response from LLM. Response: ${JSON.stringify(data)}`
    );
  }

  // Ensure reply is under 500 chars (YouTube comment limit is 10,000 but we keep it short)
  return reply.slice(0, 500);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { accountId } = body;

    if (!accountId) {
      return NextResponse.json(
        { error: "accountId is required" },
        { status: 400 }
      );
    }

    // Check for cron secret (internal calls) or user session
    const cronSecret = request.headers.get("x-cron-secret");
    const isCronCall =
      cronSecret &&
      cronSecret === process.env.CRON_SECRET &&
      process.env.CRON_SECRET;

    let account;
    if (isCronCall) {
      account = await db.account.findUnique({
        where: { id: accountId },
        include: {
          youtubeCredentials: true,
          youtubeConfig: true,
          openRouterCredentials: true,
        },
      });
    } else {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      account = await db.account.findFirst({
        where: { id: accountId, userId: getEffectiveUserId(session)! },
        include: {
          youtubeCredentials: true,
          youtubeConfig: true,
          openRouterCredentials: true,
        },
      });
    }

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const { youtubeCredentials, youtubeConfig, openRouterCredentials } =
      account;

    // Validate credentials
    if (!youtubeCredentials?.accessToken) {
      await createLog(accountId, "error", "YouTube OAuth not connected");
      return NextResponse.json(
        { error: "YouTube OAuth not connected" },
        { status: 400 }
      );
    }

    if (!youtubeCredentials?.channelId) {
      await createLog(accountId, "error", "YouTube channel not linked");
      return NextResponse.json(
        { error: "YouTube channel not linked" },
        { status: 400 }
      );
    }

    if (!openRouterCredentials?.apiKey) {
      await createLog(accountId, "error", "OpenRouter API key not configured");
      return NextResponse.json(
        { error: "OpenRouter API key not configured" },
        { status: 400 }
      );
    }

    if (!openRouterCredentials?.selectedModel) {
      await createLog(accountId, "error", "No LLM model selected");
      return NextResponse.json(
        { error: "No LLM model selected" },
        { status: 400 }
      );
    }

    // Step 1: Refresh token if needed
    const tokenResult = await refreshTokenIfNeeded({
      clientId: youtubeCredentials.clientId,
      clientSecret: youtubeCredentials.clientSecret,
      accessToken: youtubeCredentials.accessToken,
      refreshToken: youtubeCredentials.refreshToken,
      tokenExpiresAt: youtubeCredentials.tokenExpiresAt,
    });

    if (!tokenResult) {
      await createLog(accountId, "error", "Failed to get valid access token");
      return NextResponse.json(
        { error: "YouTube authentication failed" },
        { status: 401 }
      );
    }

    // Update tokens in database if refreshed
    if (tokenResult.accessToken !== youtubeCredentials.accessToken) {
      await db.youTubeCredentials.update({
        where: { accountId },
        data: {
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
          tokenExpiresAt: tokenResult.expiresAt,
        },
      });
    }

    const accessToken = tokenResult.accessToken;

    // Step 2: Check for pending comments (stored but not yet replied to)
    const pendingComment = await db.youTubeCommentInteraction.findFirst({
      where: {
        accountId,
        ourReply: null,
      },
      orderBy: { likeCount: "desc" },
    });

    if (pendingComment) {
      // We have a pending comment — reply to it without re-fetching
      await createLog(
        accountId,
        "info",
        `Replying to pending comment by ${pendingComment.authorName} (${pendingComment.likeCount} likes) on "${pendingComment.videoTitle}"`
      );

      return await replyToComment(
        accountId,
        accessToken,
        pendingComment,
        openRouterCredentials as typeof openRouterCredentials & {
          selectedModel: string;
        }
      );
    }

    // Step 3: No pending comments — fetch fresh comments from YouTube
    await createLog(accountId, "info", "No pending comments, fetching fresh");

    let videos;
    try {
      videos = await fetchChannelVideos(accessToken, 5);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch videos";
      await createLog(accountId, "error", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }

    if (videos.length === 0) {
      await createLog(accountId, "warning", "No videos found on channel");
      return NextResponse.json({
        success: true,
        replied: false,
        message: "No videos found on channel",
      });
    }

    await createLog(accountId, "info", `Found ${videos.length} videos`);

    // Step 4: Fetch comments from all videos
    const allComments: YouTubeComment[] = [];
    const minimumLikesCount = youtubeConfig?.minimumLikesCount ?? 5;

    for (const video of videos) {
      try {
        const comments = await fetchVideoComments(
          accessToken,
          video.videoId,
          video.title
        );
        const filteredComments = comments.filter(
          (c) => c.likeCount >= minimumLikesCount
        );
        allComments.push(...filteredComments);
      } catch (error) {
        console.error(`Error fetching comments for ${video.videoId}:`, error);
      }
    }

    if (allComments.length === 0) {
      await createLog(
        accountId,
        "warning",
        `No comments found with at least ${minimumLikesCount} likes`
      );
      return NextResponse.json({
        success: true,
        replied: false,
        message: "No comments found matching criteria",
      });
    }

    // Step 5: Filter out already-replied comments
    const existingInteractions = await db.youTubeCommentInteraction.findMany({
      where: {
        accountId,
        commentId: { in: allComments.map((c) => c.commentId) },
      },
      select: { commentId: true, ourReply: true },
    });

    const knownCommentIds = new Set(
      existingInteractions.map((i) => i.commentId)
    );

    const newComments = allComments.filter(
      (c) => !knownCommentIds.has(c.commentId)
    );

    if (newComments.length === 0) {
      await createLog(
        accountId,
        "info",
        "All comments already known — nothing new to reply to"
      );
      return NextResponse.json({
        success: true,
        replied: false,
        message: "All comments already processed",
      });
    }

    // Step 6: Store all new comments as pending (ourReply = null)
    let storedCount = 0;
    for (const comment of newComments) {
      try {
        await db.youTubeCommentInteraction.create({
          data: {
            accountId,
            commentId: comment.commentId,
            videoId: comment.videoId,
            videoTitle: comment.videoTitle,
            userComment: comment.userComment,
            authorName: comment.authorName,
            authorChannelId: comment.authorChannelId,
            likeCount: comment.likeCount,
          },
        });
        storedCount++;
      } catch {
        // Duplicate — already exists, skip
      }
    }

    await createLog(
      accountId,
      "info",
      `Stored ${storedCount} new comments as pending. Will reply over next ${storedCount} runs.`
    );

    // Step 7: Reply to the first one now (highest likes)
    const firstPending = await db.youTubeCommentInteraction.findFirst({
      where: {
        accountId,
        ourReply: null,
      },
      orderBy: { likeCount: "desc" },
    });

    if (!firstPending) {
      return NextResponse.json({
        success: true,
        replied: false,
        message: `Stored ${storedCount} pending comments`,
      });
    }

    await createLog(
      accountId,
      "info",
      `Replying to comment by ${firstPending.authorName} (${firstPending.likeCount} likes) on "${firstPending.videoTitle}"`
    );

    return await replyToComment(
      accountId,
      accessToken,
      firstPending,
      openRouterCredentials as typeof openRouterCredentials & {
        selectedModel: string;
      }
    );
  } catch (error) {
    console.error("YouTube pipeline error:", error);
    return NextResponse.json(
      { error: "Pipeline failed unexpectedly" },
      { status: 500 }
    );
  }
}

/**
 * Generate an LLM reply and post it to YouTube for a single comment.
 * Updates the DB record and cleans up old interactions.
 */
async function replyToComment(
  accountId: string,
  accessToken: string,
  comment: {
    id: string;
    commentId: string;
    videoId: string;
    videoTitle: string;
    userComment: string;
    authorName: string;
    authorChannelId: string;
    likeCount: number;
  },
  openRouterCredentials: {
    apiKey: string;
    selectedModel: string;
    systemPrompt: string | null;
    noHashtags: boolean;
    noEmojis: boolean;
    noCapitalization: boolean;
    badGrammar: boolean;
  }
) {
  // Generate reply
  let generatedReply: string;
  try {
    generatedReply = await generateReplyWithLLM(
      openRouterCredentials.apiKey,
      openRouterCredentials.selectedModel,
      openRouterCredentials.systemPrompt || "",
      comment.userComment,
      comment.authorName,
      comment.videoTitle,
      {
        noHashtags: openRouterCredentials.noHashtags,
        noEmojis: openRouterCredentials.noEmojis,
        noCapitalization: openRouterCredentials.noCapitalization,
        badGrammar: openRouterCredentials.badGrammar,
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate reply";
    await createLog(accountId, "error", `LLM error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await createLog(
    accountId,
    "info",
    `Generated reply: "${generatedReply.slice(0, 50)}..."`
  );

  // Post reply via YouTube API
  let replyId: string;
  try {
    replyId = await postCommentReply(
      accessToken,
      comment.commentId,
      generatedReply
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to post reply";
    await createLog(accountId, "error", `YouTube API error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await createLog(
    accountId,
    "success",
    `Posted reply to ${comment.authorName}`
  );

  // Update the interaction record
  try {
    await db.youTubeCommentInteraction.update({
      where: { id: comment.id },
      data: {
        ourReply: generatedReply,
        ourReplyId: replyId,
        repliedAt: new Date(),
      },
    });

    // Clean up old interactions (older than 14 days)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    await db.youTubeCommentInteraction.deleteMany({
      where: {
        accountId,
        createdAt: { lt: fourteenDaysAgo },
      },
    });
  } catch (dbError) {
    console.error("Failed to update interaction:", dbError);
    await createLog(
      accountId,
      "warning",
      "Reply posted but failed to update database"
    );
  }

  // Count remaining pending
  const remainingPending = await db.youTubeCommentInteraction.count({
    where: { accountId, ourReply: null },
  });

  return NextResponse.json({
    success: true,
    replied: true,
    repliedTo: comment.authorName,
    commentId: comment.commentId,
    videoTitle: comment.videoTitle,
    replyId,
    reply: generatedReply,
    pendingRemaining: remainingPending,
  });
}
