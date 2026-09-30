"use client";

import { ArrowLeft, CalendarDays, Check, Clock3, LoaderCircle, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, saveHostToken } from "@/lib/api";

export default function SchedulePage() {
  const router = useRouter();
  const initialDate = useMemo(() => {
    const date = new Date(Date.now() + 86_400_000);
    date.setMinutes(0, 0, 0);
    return date.toISOString().slice(0, 16);
  }, []);
  const [form, setForm] = useState({ title: "", description: "", scheduled_at: initialDate, duration_minutes: 30, timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata", waiting_room: false, participants_video: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function update<T extends keyof typeof form>(key: T, value: (typeof form)[T]) { setForm(current => ({ ...current, [key]: value })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const meeting = await api.schedule({ ...form, scheduled_at: new Date(form.scheduled_at).toISOString() });
      saveHostToken(meeting); router.push("/?scheduled=1");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not schedule meeting"); setSaving(false); }
  }
  return (
    <AppShell>
      <div className="form-page">
        <Link href="/" className="back-link"><ArrowLeft size={18} /> Back</Link>
        <div className="form-heading"><div className="form-icon"><CalendarDays /></div><div><h1>Schedule a meeting</h1><p>Choose a date and invite people to connect.</p></div></div>
        <form className="schedule-form" onSubmit={submit}>
          <section className="form-section"><h2>Meeting details</h2><p>Add a topic and context for your attendees.</p><div className="form-fields"><label className="wide"><span>Topic</span><input required minLength={2} maxLength={180} value={form.title} onChange={e => update("title", e.target.value)} placeholder="e.g. Weekly team sync" autoFocus /></label><label className="wide"><span>Description <em>Optional</em></span><textarea rows={4} maxLength={2000} value={form.description} onChange={e => update("description", e.target.value)} placeholder="Add meeting notes or an agenda" /></label></div></section>
          <section className="form-section"><h2>Date and time</h2><p>Set when this meeting will take place.</p><div className="form-fields two"><label><span><CalendarDays size={15}/> Date & time</span><input type="datetime-local" required min={new Date().toISOString().slice(0, 16)} value={form.scheduled_at} onChange={e => update("scheduled_at", e.target.value)} /></label><label><span><Clock3 size={15}/> Duration</span><select value={form.duration_minutes} onChange={e => update("duration_minutes", Number(e.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={90}>1.5 hours</option><option value={120}>2 hours</option></select></label><label className="wide"><span>Time zone</span><input value={form.timezone_name} onChange={e => update("timezone_name", e.target.value)} /></label></div></section>
          <section className="form-section"><h2>Meeting options</h2><p>Choose how participants enter your meeting.</p><div className="option-list"><label className="switch-row"><span><strong>Participant video</strong><small>Allow participant cameras when they join</small></span><input type="checkbox" checked={form.participants_video} onChange={e => update("participants_video", e.target.checked)} /><i /></label><label className="switch-row"><span><strong>Waiting room</strong><small>Admit participants when you&apos;re ready</small></span><input type="checkbox" checked={form.waiting_room} onChange={e => update("waiting_room", e.target.checked)} /><i /></label></div></section>
          {error && <div className="alert error">{error}</div>}
          <div className="form-footer"><Link className="button ghost" href="/">Cancel</Link><button className="button primary large" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Check />} Schedule meeting</button></div>
        </form>
      </div>
    </AppShell>
  );
}
