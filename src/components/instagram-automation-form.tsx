"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  X,
  Loader2,
  ChevronDown,
  Search,
  Image as ImageIcon,
  AlertCircle,
} from "lucide-react";
import { backdropVariants, dropdownVariants } from "@/lib/animations";
import { IconButton } from "@/components/ui/icon-button";
import { ModalButton } from "@/components/ui/modal-button";

interface InstagramAutomationFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  accountId: string;
  automation?: Automation | null;
}

interface Automation {
  id: string;
  postId: string;
  postUrl: string;
  postCaption: string;
  enabled: boolean;
  keywords: string;
  commentTemplates: string;
  dmTemplates: string;
  dmDelay: number;
}

interface InstagramPost {
  id: string;
  caption?: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  hasAutomation: boolean;
}

export function InstagramAutomationForm({
  isOpen,
  onClose,
  onSave,
  accountId,
  automation,
}: InstagramAutomationFormProps) {
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [selectedPost, setSelectedPost] = useState<InstagramPost | null>(null);
  const [keywords, setKeywords] = useState("");
  const [commentTemplates, setCommentTemplates] = useState("");
  const [dmTemplates, setDmTemplates] = useState("");
  const [dmDelay, setDmDelay] = useState(60);

  // Dropdown state
  const [isPostDropdownOpen, setIsPostDropdownOpen] = useState(false);
  const [postSearchQuery, setPostSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const postButtonRef = useRef<HTMLButtonElement>(null);
  const [postDropdownPos, setPostDropdownPos] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  const isEditing = !!automation;

  const fetchPosts = useCallback(async () => {
    setIsLoadingPosts(true);
    try {
      const res = await fetch(`/api/instagram/posts?accountId=${accountId}`);
      if (!res.ok) {
        const data = await res.json();
        if (res.status === 400 && data.error?.includes("not connected")) {
          toast.error("Connect your Instagram account first");
        } else {
          toast.error(data.error || "Failed to load posts");
        }
        return;
      }
      const data = await res.json();
      setPosts(data);
    } catch (err) {
      console.error("Failed to fetch posts:", err);
      toast.error("Failed to load posts");
    } finally {
      setIsLoadingPosts(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (isOpen && accountId) {
      fetchPosts();

      if (automation) {
        // Populate form for editing
        setKeywords(automation.keywords);
        setCommentTemplates(parseTemplatesForEdit(automation.commentTemplates));
        setDmTemplates(parseTemplatesForEdit(automation.dmTemplates));
        setDmDelay(automation.dmDelay);
        // We'll set selectedPost after posts load
      } else {
        // Reset form for new automation
        setSelectedPost(null);
        setKeywords("");
        setCommentTemplates("");
        setDmTemplates("");
        setDmDelay(60);
      }
    }
  }, [isOpen, accountId, automation, fetchPosts]);

  // Set selectedPost for editing after posts load
  useEffect(() => {
    if (automation && posts.length > 0) {
      const post = posts.find((p) => p.id === automation.postId);
      if (post) {
        setSelectedPost(post);
      }
    }
  }, [automation, posts]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isPostDropdownOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsPostDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isPostDropdownOpen]);

  const parseTemplatesForEdit = (json: string): string => {
    try {
      const arr = JSON.parse(json);
      return Array.isArray(arr) ? arr.join("\n") : "";
    } catch {
      return "";
    }
  };

  const parseTemplatesFromInput = (input: string): string[] => {
    return input
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  };

  const handleSave = async () => {
    if (!selectedPost && !isEditing) {
      toast.error("Please select a post");
      return;
    }

    if (!keywords.trim()) {
      toast.error("Please enter at least one keyword");
      return;
    }

    const commentTemplatesList = parseTemplatesFromInput(commentTemplates);
    if (commentTemplatesList.length === 0) {
      toast.error("Please enter at least one comment reply template");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        keywords: keywords.trim(),
        commentTemplates: commentTemplatesList,
        dmTemplates: parseTemplatesFromInput(dmTemplates),
        dmDelay,
        ...(selectedPost && !isEditing
          ? {
              postId: selectedPost.id,
              postUrl: selectedPost.permalink,
              postCaption: selectedPost.caption || "",
            }
          : {}),
      };

      const url = isEditing
        ? `/api/instagram/automations/${automation.id}`
        : `/api/instagram/automations?accountId=${accountId}`;

      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      toast.success(isEditing ? "Automation updated" : "Automation created");
      onSave();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save automation";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const truncateCaption = (caption?: string, maxLength = 40): string => {
    if (!caption) return "(No caption)";
    if (caption.length <= maxLength) return caption;
    return caption.slice(0, maxLength) + "...";
  };

  const filteredPosts = posts.filter(
    (post) =>
      !post.hasAutomation &&
      (post.caption?.toLowerCase().includes(postSearchQuery.toLowerCase()) ||
        post.id.includes(postSearchQuery))
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 z-0 bg-black/80 backdrop-blur-sm"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="relative z-10 flex w-full max-w-3xl flex-col rounded-2xl border"
            style={{
              background:
                "linear-gradient(to bottom, rgba(30,30,35,0.98) 0%, rgba(20,20,25,0.99) 100%)",
              borderColor: "rgba(255,255,255,0.1)",
              boxShadow:
                "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
              maxHeight: "85vh",
            }}
            initial={{ scale: 0.95, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 20, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {/* Header - Fixed */}
            <div
              className="shrink-0 flex items-center justify-between border-b border-white/10 px-6 py-4"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(30,30,30,0.98) 0%, rgba(25,25,25,0.98) 100%)",
                borderRadius: "16px 16px 0 0",
              }}
            >
              <h2 className="text-sm font-semibold tracking-wide text-white/90">
                {isEditing ? "Edit Automation" : "New Automation"}
              </h2>
              <IconButton
                icon={<X className="h-4 w-4" />}
                onClick={onClose}
                label="Close"
              />
            </div>

            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-6" data-lenis-prevent>
              {/* Two Column Layout */}
              <div className="flex flex-col gap-6 md:flex-row">
                {/* Left Column - Post & Settings */}
                <div className="flex-1">
                  {/* Post Selector (only for new automations) */}
                  {!isEditing && (
                    <div className="mb-5">
                      <label className="mb-2 block text-sm font-semibold tracking-wide text-white/70">
                        Select Post
                      </label>
                      <div className="relative" ref={dropdownRef}>
                        <motion.button
                          ref={postButtonRef}
                          type="button"
                          onClick={() => {
                            if (!isPostDropdownOpen && postButtonRef.current) {
                              const rect =
                                postButtonRef.current.getBoundingClientRect();
                              setPostDropdownPos({
                                top: rect.bottom + 4,
                                left: rect.left,
                                width: rect.width,
                              });
                            }
                            setIsPostDropdownOpen(!isPostDropdownOpen);
                          }}
                          disabled={isLoadingPosts}
                          className="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left"
                          style={{
                            background: "rgba(255,255,255,0.05)",
                            borderColor: isPostDropdownOpen
                              ? "rgba(255,255,255,0.3)"
                              : "rgba(255,255,255,0.1)",
                          }}
                          whileHover={{ borderColor: "rgba(255,255,255,0.2)" }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {selectedPost ? (
                              <>
                                {selectedPost.media_url ||
                                selectedPost.thumbnail_url ? (
                                  <Image
                                    src={
                                      selectedPost.thumbnail_url ||
                                      selectedPost.media_url ||
                                      ""
                                    }
                                    alt=""
                                    width={32}
                                    height={32}
                                    className="h-8 w-8 rounded object-cover"
                                    unoptimized
                                  />
                                ) : (
                                  <div className="flex h-8 w-8 items-center justify-center rounded bg-white/10">
                                    <ImageIcon className="h-4 w-4 text-white/40" />
                                  </div>
                                )}
                                <span className="truncate text-sm text-white/90">
                                  {truncateCaption(selectedPost.caption)}
                                </span>
                              </>
                            ) : (
                              <span className="text-sm text-white/40">
                                {isLoadingPosts
                                  ? "Loading posts..."
                                  : "Select a post..."}
                              </span>
                            )}
                          </div>
                          <motion.div
                            animate={{ rotate: isPostDropdownOpen ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            {isLoadingPosts ? (
                              <Loader2 className="h-4 w-4 animate-spin text-white/50" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-white/50" />
                            )}
                          </motion.div>
                        </motion.button>

                        {typeof document !== "undefined" &&
                          createPortal(
                            <AnimatePresence>
                              {isPostDropdownOpen && posts.length > 0 && (
                                <motion.div
                                  variants={dropdownVariants}
                                  initial="hidden"
                                  animate="visible"
                                  exit="exit"
                                  className="overflow-hidden rounded-lg border"
                                  style={{
                                    position: "fixed",
                                    top: postDropdownPos.top,
                                    left: postDropdownPos.left,
                                    width: postDropdownPos.width,
                                    zIndex: 99999,
                                    background:
                                      "linear-gradient(to bottom, rgba(30,30,30,0.98) 0%, rgba(20,20,20,0.98) 100%)",
                                    borderColor: "rgba(255,255,255,0.15)",
                                    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                                  }}
                                >
                                  {/* Search */}
                                  <div
                                    className="border-b p-2"
                                    style={{
                                      borderColor: "rgba(255,255,255,0.1)",
                                    }}
                                  >
                                    <div className="relative">
                                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                                      <input
                                        type="text"
                                        value={postSearchQuery}
                                        onChange={(e) =>
                                          setPostSearchQuery(e.target.value)
                                        }
                                        placeholder="Search posts..."
                                        className="w-full rounded border bg-transparent py-1.5 pr-3 pl-8 text-sm text-white/90 outline-none"
                                        style={{
                                          borderColor: "rgba(255,255,255,0.1)",
                                        }}
                                        autoFocus
                                      />
                                    </div>
                                  </div>

                                  {/* Posts List */}
                                  <div
                                    className="max-h-48 overflow-y-auto"
                                    data-lenis-prevent
                                    onWheel={(e) => e.stopPropagation()}
                                    style={{ overscrollBehavior: "contain" }}
                                  >
                                    {filteredPosts.length === 0 ? (
                                      <p className="px-3 py-4 text-center text-xs text-white/40">
                                        {posts.every((p) => p.hasAutomation)
                                          ? "All posts already have automations"
                                          : "No posts found"}
                                      </p>
                                    ) : (
                                      filteredPosts.map((post) => (
                                        <motion.button
                                          key={post.id}
                                          type="button"
                                          onClick={() => {
                                            setSelectedPost(post);
                                            setIsPostDropdownOpen(false);
                                            setPostSearchQuery("");
                                          }}
                                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                                          whileHover={{
                                            backgroundColor:
                                              "rgba(255,255,255,0.08)",
                                          }}
                                        >
                                          {post.media_url ||
                                          post.thumbnail_url ? (
                                            <Image
                                              src={
                                                post.thumbnail_url ||
                                                post.media_url ||
                                                ""
                                              }
                                              alt=""
                                              width={40}
                                              height={40}
                                              className="h-10 w-10 rounded object-cover"
                                              unoptimized
                                            />
                                          ) : (
                                            <div className="flex h-10 w-10 items-center justify-center rounded bg-white/10">
                                              <ImageIcon className="h-5 w-5 text-white/40" />
                                            </div>
                                          )}
                                          <span className="truncate text-sm text-white/80">
                                            {truncateCaption(post.caption)}
                                          </span>
                                        </motion.button>
                                      ))
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>,
                            document.body
                          )}
                      </div>
                    </div>
                  )}

                  {/* Keywords */}
                  <div className="mb-5">
                    <label className="mb-2 block text-sm font-semibold tracking-wide text-white/70">
                      Trigger Keywords
                    </label>
                    <input
                      type="text"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="boom, send, guide"
                      className="w-full rounded-lg border px-3 py-2.5 text-sm text-white/90 outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        borderColor: "rgba(255,255,255,0.1)",
                      }}
                    />
                    <p className="mt-1 text-xs text-white/40">
                      Separate multiple keywords with commas
                    </p>
                  </div>

                  {/* DM Delay */}
                  <div className="mb-5">
                    <label className="mb-2 block text-sm font-semibold tracking-wide text-white/70">
                      DM Delay (seconds)
                    </label>
                    <input
                      type="number"
                      value={dmDelay}
                      onChange={(e) =>
                        setDmDelay(Math.max(0, parseInt(e.target.value) || 0))
                      }
                      min={0}
                      className="w-32 rounded-lg border px-3 py-2.5 text-sm text-white/90 outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        borderColor: "rgba(255,255,255,0.1)",
                      }}
                    />
                    <p className="mt-1 text-xs text-white/40">
                      Wait time after replying before sending DM
                    </p>
                  </div>

                  {/* Info Box */}
                  <div
                    className="flex items-start gap-2 rounded-lg border px-4 py-3"
                    style={{
                      background: "rgba(59,130,246,0.1)",
                      borderColor: "rgba(59,130,246,0.3)",
                    }}
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                    <p className="text-xs text-white/70">
                      DMs can only be sent to users who have interacted with
                      your account within 7 days (Instagram API limitation).
                    </p>
                  </div>
                </div>

                {/* Divider */}
                <div
                  className="hidden w-px self-stretch md:block"
                  style={{ background: "rgba(255,255,255,0.1)" }}
                />

                {/* Right Column - Templates */}
                <div className="flex-1">
                  {/* Comment Templates */}
                  <div className="mb-5">
                    <label className="mb-2 block text-sm font-semibold tracking-wide text-white/70">
                      Comment Reply Templates
                    </label>
                    <textarea
                      value={commentTemplates}
                      onChange={(e) => setCommentTemplates(e.target.value)}
                      placeholder={
                        "Sent to your DMs!\nCheck your inbox!\nOn its way!"
                      }
                      rows={5}
                      data-lenis-prevent
                      className="w-full resize-none overflow-y-auto rounded-lg border px-3 py-2.5 text-sm text-white/90 outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        borderColor: "rgba(255,255,255,0.1)",
                      }}
                    />
                    <p className="mt-1 text-xs text-white/40">
                      One template per line. Templates rotate to avoid
                      repetition.
                    </p>
                  </div>

                  {/* DM Templates */}
                  <div>
                    <label className="mb-2 block text-sm font-semibold tracking-wide text-white/70">
                      DM Templates (Optional)
                    </label>
                    <textarea
                      value={dmTemplates}
                      onChange={(e) => setDmTemplates(e.target.value)}
                      placeholder={
                        "Hey {{username}}! Here's the link: https://...\nThanks for commenting! Your guide: https://..."
                      }
                      rows={5}
                      data-lenis-prevent
                      className="w-full resize-none overflow-y-auto rounded-lg border px-3 py-2.5 text-sm text-white/90 outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        borderColor: "rgba(255,255,255,0.1)",
                      }}
                    />
                    <p className="mt-1 text-xs text-white/40">
                      Use {"{{username}}"} for commenter&apos;s name. Leave
                      empty to skip DMs.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer - Fixed */}
            <div className="shrink-0 flex gap-3 border-t border-white/10 px-6 py-4">
              <ModalButton
                onClick={onClose}
                variant="secondary"
                className="flex-1"
              >
                Cancel
              </ModalButton>
              <ModalButton
                onClick={handleSave}
                disabled={isSaving}
                variant="primary"
                className="flex-1"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : isEditing ? (
                  "Update"
                ) : (
                  "Create"
                )}
              </ModalButton>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
