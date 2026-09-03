"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import {
  getOrCreateProfile,
  updateDisplayName,
  updatePersonalInfo,
  uploadAvatar,
  deleteAccount,
} from "@/lib/supabase/db";
import { getStoredTheme, setTheme, type Theme } from "@/lib/theme";

// Supabase throws plain {message, details, hint, code} objects, not native
// Error instances — `err instanceof Error` is false for those, so checking
// it before reading `.message` silently swallows the real error everywhere
// it's used. Read `.message` off whatever shape came back instead.
function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as any).message === "string") {
    return (err as any).message;
  }
  return fallback;
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");

  // Appearance card
  const [theme, setThemeState] = useState<Theme>("dark");

  // Profile card
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);

  // Personal info card (all optional)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [savingPersonalInfo, setSavingPersonalInfo] = useState(false);
  const [personalInfoMsg, setPersonalInfoMsg] = useState<string | null>(null);
  const [personalInfoErr, setPersonalInfoErr] = useState<string | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);

  // Email card
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);

  // Password card
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordErr, setPasswordErr] = useState<string | null>(null);

  // Danger zone
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  useEffect(() => {
    // Set on the client only, after mount — initializing state directly from
    // localStorage would mismatch the server-rendered "dark" default and
    // trigger a hydration warning. The blocking script in layout.tsx already
    // applies the real theme before paint; this just syncs the switch's
    // displayed position to match.
    setThemeState(getStoredTheme());
  }, []);

  function handleThemeChange(next: Theme) {
    setThemeState(next);
    setTheme(next);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setEmail(user?.email ?? "");

        const profile = await getOrCreateProfile();
        setDisplayName(profile.display_name ?? "");
        setFirstName(profile.first_name ?? "");
        setLastName(profile.last_name ?? "");
        setDateOfBirth(profile.date_of_birth ?? "");
        setAddress(profile.address ?? "");
        setPhoneNumber(profile.phone_number ?? "");
        setAvatarUrl(profile.avatar_url ?? null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    setNameMsg(null);
    setNameErr(null);
    try {
      await updateDisplayName(displayName);
      // Also mirror into auth user_metadata — Header listens for
      // onAuthStateChange (fired by updateUser) to know when to refetch the
      // profile, since it only fetches once on mount otherwise and would
      // keep showing the old name until the next login/reload.
      await supabase.auth.updateUser({ data: { display_name: displayName.trim() || null } });
      setNameMsg("Display name updated ✓");
    } catch (err) {
      setNameErr(errorMessage(err, "Failed to update display name."));
    } finally {
      setSavingName(false);
    }
  }

  async function handleSavePersonalInfo(e: React.FormEvent) {
    e.preventDefault();
    setSavingPersonalInfo(true);
    setPersonalInfoMsg(null);
    setPersonalInfoErr(null);
    try {
      await updatePersonalInfo({ firstName, lastName, dateOfBirth, address, phoneNumber });
      setPersonalInfoMsg("Personal info saved ✓");
    } catch (err) {
      setPersonalInfoErr(errorMessage(err, "Failed to save personal info."));
    } finally {
      setSavingPersonalInfo(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setUploadingAvatar(true);
    setAvatarErr(null);
    try {
      const updated = await uploadAvatar(file);
      setAvatarUrl(updated.avatar_url ?? null);
    } catch (err) {
      setAvatarErr(errorMessage(err, "Failed to upload photo."));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSaveEmail(e: React.FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    setEmailMsg(null);
    setEmailErr(null);

    if (!newEmail.trim()) {
      setEmailErr("Please enter a new email address.");
      setSavingEmail(false);
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) {
        setEmailErr(error.message);
        return;
      }
      setEmailMsg(
        "Check your new email address for a confirmation link — the change won't take effect until you confirm it."
      );
      setNewEmail("");
    } catch (err) {
      setEmailErr(errorMessage(err, "Failed to update email."));
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleSavePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPassword(true);
    setPasswordMsg(null);
    setPasswordErr(null);

    if (!currentPassword) {
      setPasswordErr("Please enter your current password.");
      setSavingPassword(false);
      return;
    }
    if (newPassword.length < 6) {
      setPasswordErr("New password must be at least 6 characters.");
      setSavingPassword(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordErr("New passwords do not match.");
      setSavingPassword(false);
      return;
    }

    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (verifyError) {
        setPasswordErr("Current password is incorrect.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        setPasswordErr(updateError.message);
        return;
      }

      setPasswordMsg("Password updated ✓");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordErr(errorMessage(err, "Failed to update password."));
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText !== "DELETE" || deleting) return;

    setDeleting(true);
    setDeleteErr(null);

    try {
      await deleteAccount();
      router.push("/");
    } catch (err) {
      setDeleteErr(errorMessage(err, "Failed to delete account."));
      setDeleting(false);
    }
  }

  if (loading) {
    return <div className="card">Loading settings…</div>;
  }

  const inputClass =
    "mt-1.5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 outline-none focus:border-white/25 disabled:opacity-50";
  const labelClass = "block text-sm font-medium text-white/80";
  const errorClass = "rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300";
  const successClass = "rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300";

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-white/70">Manage your account details.</p>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-1">Appearance</h2>
        <p className="text-sm text-white/50 mb-4">Switch between dark and light mode.</p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={theme === "light"}
            onClick={() => handleThemeChange(theme === "dark" ? "light" : "dark")}
            className="relative rounded-full transition-colors"
            style={{
              width: "52px",
              height: "28px",
              background: theme === "light" ? "var(--accent-purple)" : "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            <span
              className="absolute rounded-full bg-white transition-transform"
              style={{
                width: "22px",
                height: "22px",
                top: "2px",
                left: "2px",
                transform: theme === "light" ? "translateX(24px)" : "translateX(0)",
              }}
            />
          </button>
          <span className="text-sm text-white/80">
            {theme === "light" ? "☀️ Light" : "🌙 Dark"}
          </span>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Profile</h2>
        <form onSubmit={handleSaveName} className="space-y-4">
          <div>
            <label htmlFor="displayName" className={labelClass}>
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={savingName}
              placeholder="Your name"
              className={inputClass}
            />
          </div>
          {nameErr && <div className={errorClass}>{nameErr}</div>}
          {nameMsg && <div className={successClass}>{nameMsg}</div>}
          <button type="submit" disabled={savingName} className="btn btn-primary">
            {savingName ? "Saving..." : "Save name"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-1">Personal Info</h2>
        <p className="text-sm text-white/50 mb-4">
          Completely optional — helps us personalize goals and content for you down the line. See our{" "}
          <Link href="/privacy" className="text-purple-300 hover:text-purple-200 underline">
            Privacy Policy
          </Link>
          .
        </p>

        <div className="flex items-center gap-4 mb-6">
          <div
            className="flex items-center justify-center rounded-full overflow-hidden flex-shrink-0"
            style={{
              width: "64px",
              height: "64px",
              background: "linear-gradient(135deg, var(--accent-purple), var(--accent-blue))",
            }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Profile photo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-white">
                {(displayName || email || "U").charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <label className="btn" style={{ cursor: uploadingAvatar ? "not-allowed" : "pointer", opacity: uploadingAvatar ? 0.5 : 1 }}>
              {uploadingAvatar ? "Uploading..." : "Change photo"}
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                disabled={uploadingAvatar}
                className="hidden"
              />
            </label>
            <div className="mt-1 text-xs text-white/40">JPG or PNG, up to 5MB</div>
            {avatarErr && <div className="mt-2 text-xs text-red-300">{avatarErr}</div>}
          </div>
        </div>

        <form onSubmit={handleSavePersonalInfo} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className={labelClass}>
                First Name
              </label>
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={savingPersonalInfo}
                placeholder="First name"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="lastName" className={labelClass}>
                Last Name
              </label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={savingPersonalInfo}
                placeholder="Last name"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dateOfBirth" className={labelClass}>
                Date of Birth
              </label>
              <input
                id="dateOfBirth"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                disabled={savingPersonalInfo}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="phoneNumber" className={labelClass}>
                Phone Number
              </label>
              <input
                id="phoneNumber"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={savingPersonalInfo}
                placeholder="+1 (555) 123-4567"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="address" className={labelClass}>
              Address
            </label>
            <input
              id="address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={savingPersonalInfo}
              placeholder="Street, city, state"
              className={inputClass}
            />
          </div>

          {personalInfoErr && <div className={errorClass}>{personalInfoErr}</div>}
          {personalInfoMsg && <div className={successClass}>{personalInfoMsg}</div>}
          <button type="submit" disabled={savingPersonalInfo} className="btn btn-primary">
            {savingPersonalInfo ? "Saving..." : "Save personal info"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Email</h2>
        <form onSubmit={handleSaveEmail} className="space-y-4">
          <div>
            <label className={labelClass}>Current Email</label>
            <input type="email" value={email} disabled className={inputClass} />
          </div>
          <div>
            <label htmlFor="newEmail" className={labelClass}>
              New Email
            </label>
            <input
              id="newEmail"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              disabled={savingEmail}
              placeholder="new@example.com"
              className={inputClass}
              autoComplete="email"
            />
          </div>
          {emailErr && <div className={errorClass}>{emailErr}</div>}
          {emailMsg && <div className={successClass}>{emailMsg}</div>}
          <button type="submit" disabled={savingEmail} className="btn btn-primary">
            {savingEmail ? "Saving..." : "Update email"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Password</h2>
        <form onSubmit={handleSavePassword} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className={labelClass}>
              Current Password
            </label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={savingPassword}
              placeholder="••••••••"
              className={inputClass}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label htmlFor="newPassword" className={labelClass}>
              New Password
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={savingPassword}
              placeholder="••••••••"
              className={inputClass}
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-white/50">Minimum 6 characters</p>
          </div>
          <div>
            <label htmlFor="confirmNewPassword" className={labelClass}>
              Confirm New Password
            </label>
            <input
              id="confirmNewPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={savingPassword}
              placeholder="••••••••"
              className={inputClass}
              autoComplete="new-password"
            />
          </div>
          {passwordErr && <div className={errorClass}>{passwordErr}</div>}
          {passwordMsg && <div className={successClass}>{passwordMsg}</div>}
          <button type="submit" disabled={savingPassword} className="btn btn-primary">
            {savingPassword ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>

      <div className="card" style={{ border: "1px solid rgba(239, 68, 68, 0.35)" }}>
        <h2 className="text-lg font-semibold mb-2 text-red-300">Danger Zone</h2>
        <p className="text-sm text-white/60">
          This permanently deletes all your goals, plans, notes, and reschedule history, and
          resets your points to zero. You'll be signed out immediately after.
        </p>
        <p className="mt-2 text-xs text-white/40">
          Note: this wipes your data but doesn't remove the login itself (that requires a
          server-side operation this app isn't set up to perform) — you could technically sign
          back in to an empty account afterward.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="deleteConfirm" className={labelClass}>
              Type <span className="font-mono font-bold text-red-300">DELETE</span> to confirm
            </label>
            <input
              id="deleteConfirm"
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deleting}
              placeholder="DELETE"
              className={inputClass}
            />
          </div>
          {deleteErr && <div className={errorClass}>{deleteErr}</div>}
          <button
            type="button"
            onClick={handleDeleteAccount}
            disabled={deleteConfirmText !== "DELETE" || deleting}
            className="btn"
            style={{
              background: "rgba(239, 68, 68, 0.15)",
              borderColor: "rgba(239, 68, 68, 0.4)",
              color: "#fca5a5",
              opacity: deleteConfirmText !== "DELETE" || deleting ? 0.5 : 1,
              cursor: deleteConfirmText !== "DELETE" || deleting ? "not-allowed" : "pointer",
            }}
          >
            {deleting ? "Deleting..." : "Delete Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
