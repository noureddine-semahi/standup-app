import AuthGate from "@/components/AuthGate";

export default function StandupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <div className="min-h-screen relative pointer-events-auto">
        {/* ✅ Safety background layer: never blocks clicks */}
        <div className="pointer-events-none absolute inset-0 opacity-50 -z-10" />

        {/* ✅ Force children above */}
        <div className="relative z-10 pointer-events-auto">{children}</div>
      </div>
    </AuthGate>
  );
}
