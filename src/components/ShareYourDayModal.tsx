"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { connectionDisplayName, type Connection } from "@/lib/supabase/db";

type ShareYourDayModalProps = {
  selectedAudienceValue: string;
  onAudienceChange: (value: string) => void;
  acceptedConnections: Connection[];
  published: boolean;
  publishing: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  onClose: () => void;
};

/** Today's "Share Your Day" flow -- audience SELECTION only updates selectedAudienceValue; publication happens exclusively via the explicit Publish button (onPublish), which hands off to the unchanged canonical handlePublish(). Existing Unpublish stays reachable here too, reusing handleUnpublish verbatim. */
export default function ShareYourDayModal({
  selectedAudienceValue,
  onAudienceChange,
  acceptedConnections,
  published,
  publishing,
  onPublish,
  onUnpublish,
  onClose,
}: ShareYourDayModalProps) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !publishing) onClose();
      }}
    >
      <div
        className="card"
        style={{ maxWidth: "440px", width: "100%", position: "relative", zIndex: 10000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-1">{t("today.shareModalTitle")}</h2>
        <p className="mt-1 text-sm text-white/70">{t("today.shareModalBody")}</p>

        <label className="mt-4 block text-xs text-white/50 mb-1.5">{t("today.publishLabel")}</label>
        <select
          value={selectedAudienceValue}
          onChange={(e) => onAudienceChange(e.target.value)}
          disabled={publishing}
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/40 disabled:opacity-50"
        >
          <option value="" disabled>
            {t("today.publishSelectPlaceholder")}
          </option>
          <option value="everyone">{t("today.publishEveryoneBtn")}</option>
          <option value="connections">{t("today.publishConnectionsBtn")}</option>
          {acceptedConnections.length > 0 && (
            <optgroup label={t("today.publishIndividualGroupLabel")}>
              {acceptedConnections.map((c) => (
                <option key={c.otherUserId} value={`individual:${c.otherUserId}`}>
                  {connectionDisplayName(c, t)}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {published && (
          <button
            type="button"
            onClick={onUnpublish}
            disabled={publishing}
            className="btn standup-metal-btn mt-3"
            style={{ fontSize: "0.8rem", padding: "0.4rem 0.7rem" }}
          >
            {publishing ? t("today.unpublishing") : t("today.unpublish")}
          </button>
        )}

        <div className="flex gap-3 mt-4">
          <button onClick={onClose} disabled={publishing} className="btn standup-metal-btn">
            {t("today.cancel")}
          </button>
          <button
            onClick={onPublish}
            disabled={!selectedAudienceValue || publishing}
            className="btn standup-metal-btn standup-metal-btn--accent flex-1"
          >
            {publishing ? t("today.publishing") : t("today.publishBtn")}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
