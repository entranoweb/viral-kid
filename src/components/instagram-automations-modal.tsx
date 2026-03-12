"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useEscapeClose } from "@/lib/hooks/use-escape-close";
import toast from "react-hot-toast";
import {
  X,
  Loader2,
  Plus,
  Trash2,
  Edit2,
  ToggleLeft,
  ToggleRight,
  MessageSquare,
  Send,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { ModalButton } from "@/components/ui/modal-button";
import { InstagramAutomationForm } from "./instagram-automation-form";

interface InstagramAutomationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
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
  _count: {
    interactions: number;
  };
}

export function InstagramAutomationsModal({
  isOpen,
  onClose,
  accountId,
}: InstagramAutomationsModalProps) {
  useEscapeClose(isOpen, onClose);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(
    null
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAutomations = useCallback(async () => {
    if (!accountId) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/instagram/automations?accountId=${accountId}`
      );
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setAutomations(data);
    } catch (err) {
      console.error("Failed to fetch automations:", err);
      toast.error("Failed to load automations");
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (isOpen && accountId) {
      fetchAutomations();
    }
  }, [isOpen, accountId, fetchAutomations]);

  const handleToggle = async (automation: Automation) => {
    setTogglingId(automation.id);
    try {
      const res = await fetch(`/api/instagram/automations/${automation.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !automation.enabled }),
      });

      if (!res.ok) throw new Error("Failed to toggle");

      setAutomations((prev) =>
        prev.map((a) =>
          a.id === automation.id ? { ...a, enabled: !a.enabled } : a
        )
      );
      toast.success(
        automation.enabled ? "Automation paused" : "Automation enabled"
      );
    } catch {
      toast.error("Failed to toggle automation");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (automation: Automation) => {
    if (!confirm("Delete this automation? This cannot be undone.")) return;

    setDeletingId(automation.id);
    try {
      const res = await fetch(`/api/instagram/automations/${automation.id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete");

      setAutomations((prev) => prev.filter((a) => a.id !== automation.id));
      toast.success("Automation deleted");
    } catch {
      toast.error("Failed to delete automation");
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdit = (automation: Automation) => {
    setEditingAutomation(automation);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingAutomation(null);
  };

  const handleFormSave = () => {
    handleFormClose();
    fetchAutomations();
  };

  const parseTemplateCount = (json: string): number => {
    try {
      const arr = JSON.parse(json);
      return Array.isArray(arr) ? arr.length : 0;
    } catch {
      return 0;
    }
  };

  const truncateCaption = (caption: string, maxLength = 50): string => {
    if (!caption) return "(No caption)";
    if (caption.length <= maxLength) return caption;
    return caption.slice(0, maxLength) + "...";
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 z-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="relative z-10 flex w-full max-w-md flex-col rounded-2xl border md:max-w-2xl"
            style={{
              background:
                "linear-gradient(to bottom, rgba(30,30,35,0.98) 0%, rgba(20,20,25,0.99) 100%)",
              borderColor: "rgba(255,255,255,0.1)",
              boxShadow:
                "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.2)",
              maxHeight: "80vh",
            }}
            initial={{ scale: 0.95, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 20, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-wide text-white/90">
                  Comment Automations
                </h2>
                {automations.length > 0 && (
                  <motion.span
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-white/70"
                    style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
                  >
                    {automations.length}
                  </motion.span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <ModalButton
                  onClick={() => setIsFormOpen(true)}
                  variant="primary"
                  className="text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </ModalButton>
                <IconButton
                  icon={<X className="h-4 w-4" />}
                  onClick={onClose}
                  label="Close"
                />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4" data-lenis-prevent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-white/50" />
                </div>
              ) : automations.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center py-12"
                >
                  <MessageSquare className="mb-2 h-8 w-8 text-white/30" />
                  <p className="text-sm text-white/50">No automations yet</p>
                  <p className="mt-1 text-xs text-white/30">
                    Create one to auto-reply to comments
                  </p>
                </motion.div>
              ) : (
                <div className="space-y-2">
                  {automations.map((automation, index) => (
                    <motion.div
                      key={automation.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="rounded-lg border p-4"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        borderColor: automation.enabled
                          ? "rgba(34,197,94,0.3)"
                          : "rgba(255,255,255,0.08)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          {/* Caption */}
                          <p className="truncate text-sm font-medium text-white/90">
                            {truncateCaption(automation.postCaption)}
                          </p>

                          {/* Keywords */}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {automation.keywords
                              .split(",")
                              .filter((k) => k.trim())
                              .slice(0, 5)
                              .map((keyword, i) => (
                                <span
                                  key={i}
                                  className="rounded-full px-2 py-0.5 text-xs"
                                  style={{
                                    background: "rgba(236,72,153,0.15)",
                                    color: "rgba(236,72,153,0.9)",
                                  }}
                                >
                                  {keyword.trim()}
                                </span>
                              ))}
                            {automation.keywords
                              .split(",")
                              .filter((k) => k.trim()).length > 5 && (
                              <span className="text-xs text-white/40">
                                +
                                {automation.keywords
                                  .split(",")
                                  .filter((k) => k.trim()).length - 5}{" "}
                                more
                              </span>
                            )}
                          </div>

                          {/* Stats */}
                          <div className="mt-3 flex items-center gap-4 text-xs text-white/40">
                            <span className="flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              {parseTemplateCount(
                                automation.commentTemplates
                              )}{" "}
                              replies
                            </span>
                            <span className="flex items-center gap-1">
                              <Send className="h-3 w-3" />
                              {parseTemplateCount(automation.dmTemplates)} DMs
                            </span>
                            <span>{automation._count.interactions} sent</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <IconButton
                            icon={
                              togglingId === automation.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : automation.enabled ? (
                                <ToggleRight className="h-5 w-5" />
                              ) : (
                                <ToggleLeft className="h-5 w-5" />
                              )
                            }
                            onClick={() => handleToggle(automation)}
                            label={automation.enabled ? "Disable" : "Enable"}
                            className={
                              automation.enabled ? "text-green-500" : ""
                            }
                          />
                          <IconButton
                            icon={<Edit2 className="h-4 w-4" />}
                            onClick={() => handleEdit(automation)}
                            label="Edit"
                          />
                          <IconButton
                            icon={
                              deletingId === automation.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )
                            }
                            onClick={() => handleDelete(automation)}
                            label="Delete"
                            variant="danger"
                          />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* Automation Form Modal */}
          <InstagramAutomationForm
            isOpen={isFormOpen}
            onClose={handleFormClose}
            onSave={handleFormSave}
            accountId={accountId}
            automation={editingAutomation}
          />
        </div>
      )}
    </AnimatePresence>
  );
}
