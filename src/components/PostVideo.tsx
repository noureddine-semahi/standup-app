"use client";

import { useEffect, useState } from "react";
import { getPostVideoUrl } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** Resolves and renders a post's attached video — mirrors PostImage.tsx exactly, swapping <img> for a controlled <video>. */
export default function PostVideo({ videoPath }: { videoPath: string }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    getPostVideoUrl(videoPath)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  if (failed) {
    return <div className="mb-3 text-xs text-white/40 italic">{t("social.videoUnavailable")}</div>;
  }

  if (!url) {
    return <div className="mb-3 h-40 rounded-lg bg-white/5 animate-pulse" />;
  }

  return (
    <video
      src={url}
      controls
      playsInline
      className="mb-3 max-h-80 w-full rounded-lg bg-black"
      onError={() => setFailed(true)}
    />
  );
}
