"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile, updateDisplayName } from "@/lib/supabase/db";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");

  // Profile card
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);

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
      setNameErr(err instanceof Error ? err.message : "Failed to update display name.");
    } finally {
      setSavingName(false);
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
      setEmailErr(err instanceof Error ? err.message : "Failed to update email.");
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
      setPasswordErr(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setSavingPassword(false);
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
    </div>
  );
}
