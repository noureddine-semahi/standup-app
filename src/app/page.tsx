"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        router.push("/standup/dashboard");
      } else {
        setLoading(false);
      }
    }

    checkAuth();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob" />
          <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000" />
          <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-emerald-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000" />
        </div>

        <div className="max-w-6xl mx-auto px-4 py-20 sm:py-32 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-purple-500/30 bg-purple-500/10 mb-8 animate-fadeIn">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
            </span>
            <span className="text-sm text-purple-300 font-medium">Daily Execution System</span>
          </div>

          {/* Hero Headline */}
          <h1 className="text-5xl sm:text-7xl font-bold mb-6 leading-tight">
            <span className="block gradient-text">Build Consistency.</span>
            <span className="block text-white/90">Execute Daily.</span>
          </h1>

          <p className="text-xl sm:text-2xl text-white/70 mb-10 max-w-3xl mx-auto">
            Transform your goals into daily habits with awareness-driven planning and reflection.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link href="/signup" className="btn btn-primary text-lg px-8 py-4 hover-scale">
              Get Started Free →
            </Link>
            <Link href="/about" className="btn btn-ghost text-lg px-8 py-4">
              Learn More
            </Link>
          </div>

          {/* Visual Mockup */}
          <div className="relative max-w-5xl mx-auto">
            <div className="card hover-scale">
              {/* Simplified dashboard preview */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 p-6">
                  <div className="text-sm text-purple-300 mb-2">Total Points</div>
                  <div className="text-4xl font-bold gradient-text">247</div>
                </div>
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-6">
                  <div className="text-sm text-blue-300 mb-2">Daily Streak</div>
                  <div className="text-4xl font-bold text-blue-400">12 🔥</div>
                </div>
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-6">
                  <div className="text-sm text-emerald-300 mb-2">Completed</div>
                  <div className="text-4xl font-bold text-emerald-400">85%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Why StandUp?</h2>
          <p className="text-xl text-white/70">Built on proven principles of execution</p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {/* Feature 1 */}
          <div className="card hover-scale group">
            <div className="text-5xl mb-4 group-hover:bounce">🧠</div>
            <h3 className="text-xl font-bold mb-2">Awareness First</h3>
            <p className="text-white/70">
              Review before acting. Every goal gets conscious attention before execution.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="card hover-scale group">
            <div className="text-5xl mb-4 group-hover:bounce">🔄</div>
            <h3 className="text-xl font-bold mb-2">Daily Reflection</h3>
            <p className="text-white/70">
              Learn from yesterday. Plan tomorrow only after reviewing today.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="card hover-scale group">
            <div className="text-5xl mb-4 group-hover:bounce">📈</div>
            <h3 className="text-xl font-bold mb-2">Progress Tracking</h3>
            <p className="text-white/70">
              Earn points, build streaks, and watch your consistency compound.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="card hover-scale group">
            <div className="text-5xl mb-4 group-hover:bounce">🎯</div>
            <h3 className="text-xl font-bold mb-2">Priority Focus</h3>
            <p className="text-white/70">
              One P1 goal per day keeps you focused on what truly matters.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="card hover-scale group">
            <div className="text-5xl mb-4 group-hover:bounce">📅</div>
            <h3 className="text-xl font-bold mb-2">Smart Scheduling</h3>
            <p className="text-white/70">
              Reschedule goals seamlessly. They appear automatically on the right day.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="card hover-scale group">
            <div className="text-5xl mb-4 group-hover:bounce">🔥</div>
            <h3 className="text-xl font-bold mb-2">Daily Habits</h3>
            <p className="text-white/70">
              Small wins compound. Build lasting habits through daily engagement.
            </p>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">How It Works</h2>
          <p className="text-xl text-white/70">Three simple steps to daily execution</p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="card hover-scale relative">
            <div className="absolute -top-4 -left-4 w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xl font-bold">
              1
            </div>
            <h3 className="text-xl font-bold mb-3 mt-4">Plan Tomorrow</h3>
            <p className="text-white/70">
              Every evening, set at least 3 goals. Assign priorities (only one P1). Submit your plan.
            </p>
          </div>

          <div className="card hover-scale relative">
            <div className="absolute -top-4 -left-4 w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-xl font-bold">
              2
            </div>
            <h3 className="text-xl font-bold mb-3 mt-4">Review Today</h3>
            <p className="text-white/70">
              Each morning, review yesterday's goals. Update status, add notes, close out the day.
            </p>
          </div>

          <div className="card hover-scale relative">
            <div className="absolute -top-4 -left-4 w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-purple-500 flex items-center justify-center text-xl font-bold">
              3
            </div>
            <h3 className="text-xl font-bold mb-3 mt-4">Build Momentum</h3>
            <p className="text-white/70">
              Earn points, track streaks, and watch your daily execution habit strengthen over time.
            </p>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="card bg-gradient-to-br from-purple-500/20 to-blue-500/20 border-purple-500/30">
          <h2 className="text-4xl font-bold mb-4">Ready to Build Your Habit?</h2>
          <p className="text-xl text-white/70 mb-8">
            Join StandUp today and start your daily execution journey.
          </p>
          <Link href="/signup" className="btn btn-primary text-lg px-8 py-4 hover-scale">
            Get Started Free →
          </Link>
          <p className="text-sm text-white/50 mt-4">No credit card required</p>
        </div>
      </div>
    </div>
  );
}