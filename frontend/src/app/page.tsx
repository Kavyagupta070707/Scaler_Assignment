"use client";

import { CalendarPlus, Check, ChevronRight, Clock3, Copy, Link2, LoaderCircle, Plus, Users, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, formatMeetingId, saveHostToken } from "@/lib/api";
import { Meeting } from "@/lib/types";

function MeetingRow({ meeting, recent = false, onCancel }: { meeting: Meeting; recent?: boolean; onCancel?: () => void }) {
  const date = new Date(meeting.scheduled_at);
  const startLink = `/meeting/${meeting.meeting_id}`;
  const [copied, setCopied] = useState(false);
  async function copyInvite() {
    await navigator.clipboard.writeText(meeting.invite_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <article className="meeting-row">
      <div className={`meeting-date ${recent ? "muted" : ""}`}>
        <strong>{date.toLocaleDateString("en-US", { day: "2-digit" })}</strong>
        <span>{date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</span>
      </div>
      <div className="meeting-info">
        <h3>{meeting.title}</h3>
        <p><Clock3 size={14} /> {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {meeting.duration_minutes} min</p>
        <p className="meeting-id">Meeting ID: {formatMeetingId(meeting.meeting_id)}</p>
      </div>
      <div className="meeting-actions">
        {!recent && <Link href={startLink} onClick={() => saveHostToken(meeting)} className="button primary small">Start</Link>}
        <button title="Copy invitation link" className="button ghost small" onClick={copyInvite}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy invite"}</button>
        {!recent && onCancel && <button className="text-button danger-text" onClick={onCancel}>Cancel</button>}
      </div>
    </article>
  );
}

export default function HomePage() {
  const [data, setData] = useState<{ upcoming: Meeting[]; recent: Meeting[] }>({ upcoming: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(new Date());

  async function load() {
    try { setData(await api.meetings()); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load meetings"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  async function newMeeting() {
    setCreating(true);
    try {
      const meeting = await api.instant();
      saveHostToken(meeting);
      window.location.href = `/meeting/${meeting.meeting_id}`;
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to create meeting"); setCreating(false); }
  }

  async function cancelMeeting(id: string) {
    if (!window.confirm("Cancel this meeting? Invitees will no longer be able to join.")) return;
    await api.cancel(id);
    await load();
  }

  return (
    <AppShell>
      <div className="dashboard-heading"><div><p className="eyebrow">WORKPLACE</p><h1>Good {now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, Kavya</h1><p>Here&apos;s what&apos;s happening with your meetings today.</p></div><button className="button outline"><CalendarPlus size={17} /> Add calendar</button></div>
      {error && <div className="alert error">{error}</div>}
      <section className="hero-grid">
        <div className="quick-actions">
          <button title="Start a new meeting now" className="action-card orange" onClick={newMeeting} disabled={creating}><span className="action-icon">{creating ? <LoaderCircle className="spin" /> : <Video fill="currentColor" />}</span><span><strong>New Meeting</strong><small>Start an instant meeting</small></span><ChevronRight /></button>
          <Link className="action-card blue" href="/join"><span className="action-icon"><Plus /></span><span><strong>Join</strong><small>Enter a meeting ID</small></span><ChevronRight /></Link>
          <Link className="action-card purple" href="/schedule"><span className="action-icon"><CalendarPlus /></span><span><strong>Schedule</strong><small>Plan a meeting</small></span><ChevronRight /></Link>
          <button className="action-card cyan" onClick={() => navigator.clipboard.writeText(window.location.origin)}><span className="action-icon"><Link2 /></span><span><strong>Share screen</strong><small>Present using a key</small></span><ChevronRight /></button>
        </div>
        <div className="clock-card"><div className="clock-pattern"/><div className="clock-content"><span>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><p>{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p></div><div className="next-meeting"><span>Next meeting</span>{data.upcoming[0] ? <><strong>{data.upcoming[0].title}</strong><small>{new Date(data.upcoming[0].scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></> : <strong>No meetings today</strong>}</div></div>
      </section>
      <section className="content-card">
        <div className="section-title"><div><h2>Upcoming meetings</h2><p>Your scheduled meetings and events</p></div><Link href="/schedule" className="button primary"><Plus size={17} /> Schedule meeting</Link></div>
        {loading ? <div className="meeting-skeleton" aria-label="Loading meetings">{[1,2].map(item => <div className="skeleton-row" key={item}><i/><span><b/><b/></span><em/></div>)}</div> : data.upcoming.length ? data.upcoming.map(meeting => <MeetingRow meeting={meeting} key={meeting.meeting_id} onCancel={() => cancelMeeting(meeting.meeting_id)} />) : <div className="empty-state"><CalendarPlus /><h3>No upcoming meetings</h3><p>Schedule a meeting to see it here.</p></div>}
      </section>
      <section className="content-card recent-card">
        <div className="section-title"><div><h2>Recent</h2><p>Meetings you joined recently</p></div><button className="text-button">View all</button></div>
        {data.recent.length ? data.recent.map(meeting => <MeetingRow meeting={meeting} recent key={meeting.meeting_id} />) : <div className="empty-inline"><Users size={18} /> No recent meetings yet</div>}
      </section>
    </AppShell>
  );
}
