"use client";

import { useEffect, useState } from "react";
import { getPostImageUrl } from "@/lib/supabase/db";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * Resolves and renders a post's attached photo. This is the first async,
 * stateful concern in a PostCard-adjacent component (a signed URL has to
 * be fetched, and can fail/expire) — kept out of PostCard itself the same
 * way GlimpseReactionPicker/CommentThread already are, rather than
 * inlined alongside its purely-synchronous type branches.
 */
export default function PostImage({ imagePath }: { imagePath: string }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    getPostImageUrl(imagePath)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [imagePath]);

  if (failed) {
    return <div className="mb-3 text-xs text-white/40 italic">{t("social.photoUnavailable")}</div>;
  }

  if (!url) {
    return <div className="mb-3 h-40 rounded-lg bg-white/5 animate-pulse" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={t("social.photoAlt")}
      className="mb-3 max-h-80 w-full rounded-lg object-cover"
      onError={() => setFailed(true)}
    />
  );
}
