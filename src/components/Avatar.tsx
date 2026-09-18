/**
 * Shared avatar-circle pattern -- an image when avatarUrl is set, else the
 * first uppercased character of label (display name, email local-part, or
 * a generic fallback the caller already resolved). Extracted from the two
 * inline copies that used to live in Header.tsx.
 */
export default function Avatar({
  avatarUrl,
  label,
  size = 32,
}: {
  avatarUrl?: string | null;
  label: string;
  size?: number;
}) {
  return (
    <span className="avatar-circle" style={{ width: size, height: size }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center font-bold text-white"
          style={{ fontSize: Math.round(size * 0.45) }}
        >
          {(label || "U").charAt(0).toUpperCase()}
        </div>
      )}
    </span>
  );
}
