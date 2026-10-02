"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Avatar from "@/components/Avatar";
import { formatDateTimeDisplay, connectionDisplayName, type Connection } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * Minimal "View profile" peek for an accepted connection — just who they
 * are and how long you've been connected, using fields the Connections
 * list already has (no new fetch). Explicit user call: make this the
 * primary action on a connection card instead of Remove, which previously
 * made the whole page read as administrative rather than social. Dismissible
 * (backdrop/Esc/X), unlike CommunityGuidelinesModal's hard gate.
 */
export default function ConnectionProfileModal({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const name = connectionDisplayName(connection, t);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modalContent = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "360px", width: "100%", position: "relative", zIndex: 10000, textAlign: "center" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute"
          style={{ top: "14px", right: "14px", color: "rgba(var(--tint-rgb), 0.6)" }}
          title={t("social.closeProfile")}
        >
          <X size={18} />
        </button>

        <div className="flex justify-center mb-3">
          <Avatar avatarUrl={connection.otherAvatarUrl} label={name} size={72} />
        </div>
        <h2 className="text-xl font-bold mb-1">{name}</h2>
        <p className="text-sm text-white/50">
          {t("social.connectedSince", { date: formatDateTimeDisplay(connection.responded_at ?? connection.created_at) })}
        </p>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
