"use client";

import { ArrowLeft, LoaderCircle, Video } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api";

function JoinForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [meetingId, setMeetingId] = useState(params.get("meeting") || "");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true); setError("");
    try {
      const meeting = await api.meeting(meetingId.trim());
      sessionStorage.setItem(`zoomly-name-${meeting.meeting_id}`, name.trim());
      router.push(`/meeting/${meeting.meeting_id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Meeting not found"); setLoading(false); }
  }

  return (
    <main className="auth-page">
      <Link href="/" className="back-link"><ArrowLeft size={18} /> Back to home</Link>
      <section className="auth-card">
        <div className="brand centered"><span className="brand-mark"><Video size={22} fill="currentColor" /></span><span>zoomly</span></div>
        <div className="auth-heading"><h1>Join a meeting</h1><p>Enter the meeting details shared by the host.</p></div>
        <form onSubmit={submit} className="stack-form">
          <label><span>Meeting ID or invitation link</span><input required value={meetingId} onChange={e => setMeetingId(e.target.value)} placeholder="Enter meeting ID or invitation token" autoFocus /></label>
          <label><span>Your name</span><input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Enter your display name" /></label>
          {error && <div className="alert error">{error}</div>}
          <button className="button primary full large" disabled={loading || !meetingId.trim() || name.trim().length < 2}>{loading ? <LoaderCircle className="spin" /> : null} Join meeting</button>
        </form>
        <p className="legal-copy">By joining, you agree to our Terms of Service and Privacy Statement.</p>
      </section>
    </main>
  );
}

export default function JoinPage() {
  return <Suspense><JoinForm /></Suspense>;
}

