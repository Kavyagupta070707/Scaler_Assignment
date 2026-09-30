"use client";

import { Check, ChevronUp, Copy, Info, LoaderCircle, LogOut, Mic, MicOff, MonitorUp, MoreHorizontal, PhoneOff, ShieldCheck, Smile, Users, Video, VideoOff, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatMeetingId, WS_URL } from "@/lib/api";
import { Meeting, Participant } from "@/lib/types";

const iceServers: RTCIceServer[] = [
  { urls: process.env.NEXT_PUBLIC_STUN_URL || "stun:stun.l.google.com:19302" },
  ...(process.env.NEXT_PUBLIC_TURN_URL ? [{ urls: process.env.NEXT_PUBLIC_TURN_URL, username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL }] : []),
];

function VideoTile({ participant, local = false }: { participant: Participant; local?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && participant.stream && !participant.videoOff) {
      ref.current.srcObject = participant.stream;
      ref.current.play().catch(() => undefined);
    }
  }, [participant.stream, participant.videoOff]);
  const initials = participant.name.split(" ").map(word => word[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="video-tile">
      {participant.stream && !participant.videoOff ? <video ref={ref} autoPlay playsInline muted={local} /> : <div className="participant-avatar">{initials}</div>}
      <div className="tile-label">{participant.muted ? <MicOff size={13} /> : <Mic size={13} />}{participant.name}{local ? " (You)" : ""}{participant.role === "host" && <ShieldCheck size={13} />}</div>
    </div>
  );
}

export default function MeetingPage() {
  const id = String(useParams().id);
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [name, setName] = useState("");
  const [stage, setStage] = useState<"loading" | "preview" | "room" | "error">("loading");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sidePanel, setSidePanel] = useState<"participants" | "info" | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localParticipant, setLocalParticipant] = useState<Participant | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const mutedRef = useRef(false);
  const videoOffRef = useRef(false);
  const sharingRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  const updateParticipant = useCallback((updated: Participant) => {
    setParticipants(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
  }, []);

  useEffect(() => {
    async function prepare() {
      try {
        const found = await api.meeting(id); setMeeting(found);
        setName(sessionStorage.getItem(`zoomly-name-${found.meeting_id}`) || "Kavya Gupta");
        try {
          const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          streamRef.current = media; cameraTrackRef.current = media.getVideoTracks()[0] || null;
          if (localVideo.current) localVideo.current.srcObject = media;
        } catch {
          videoOffRef.current = true;
          mutedRef.current = true;
          setVideoOff(true);
          setMuted(true);
        }
        setStage("preview");
      } catch (err) { setError(err instanceof Error ? err.message : "Meeting unavailable"); setStage("error"); }
    }
    prepare();
    return () => {
      screenStreamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current?.getTracks().forEach(track => track.stop());
      socketRef.current?.close();
      peersRef.current.forEach(peer => peer.close());
    };
  }, [id]);

  useEffect(() => {
    if (stage === "preview" && localVideo.current && streamRef.current && !videoOff) {
      localVideo.current.srcObject = streamRef.current;
      localVideo.current.play().catch(() => undefined);
    }
  }, [stage, videoOff]);

  async function createPeer(target: string, initiator: boolean) {
    let peer = peersRef.current.get(target);
    if (peer) return peer;
    peer = new RTCPeerConnection({ iceServers });
    peersRef.current.set(target, peer);
    streamRef.current?.getAudioTracks().forEach(track => peer!.addTrack(track, streamRef.current!));
    const outgoingVideoStream = screenStreamRef.current || streamRef.current;
    const outgoingVideoTrack = outgoingVideoStream?.getVideoTracks()[0];
    if (outgoingVideoTrack && outgoingVideoStream) peer.addTrack(outgoingVideoTrack, outgoingVideoStream);
    peer.onicecandidate = event => { if (event.candidate) socketRef.current?.send(JSON.stringify({ type: "signal", target, data: { candidate: event.candidate } })); };
    peer.ontrack = event => setParticipants(current => current.map(item => item.id === target ? { ...item, stream: event.streams[0] } : item));
    peer.onconnectionstatechange = () => { if (peer?.connectionState === "failed") peer.restartIce(); };
    if (initiator) {
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      socketRef.current?.send(JSON.stringify({ type: "signal", target, data: { description: peer.localDescription } }));
    }
    return peer;
  }

  async function handleSignal(from: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    const peer = await createPeer(from, false);
    if (data.description) {
      await peer.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
        socketRef.current?.send(JSON.stringify({ type: "signal", target: from, data: { description: peer.localDescription } }));
      }
    } else if (data.candidate) {
      try { await peer.addIceCandidate(data.candidate); } catch { /* candidate can arrive after a peer leaves */ }
    }
  }

  async function enterRoom() {
    if (!meeting || name.trim().length < 2) return;
    setJoining(true); setError("");
    try {
      const hostToken = localStorage.getItem(`zoomly-host-${meeting.meeting_id}`) || undefined;
      const joined = await api.join(meeting.meeting_id, name.trim(), hostToken);
      const local: Participant = { id: joined.participant_id, name: name.trim(), role: joined.role, muted, videoOff, stream: streamRef.current || undefined };
      setLocalParticipant(local); setStage("room");
      const socket = new WebSocket(`${WS_URL}/ws/meetings/${meeting.meeting_id}?participant_id=${joined.participant_id}`);
      socketRef.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "media-state", muted, videoOff }));
      socket.onmessage = async event => {
        const message = JSON.parse(event.data);
        if (message.type === "room-state") { setParticipants(message.participants); for (const participant of message.participants) await createPeer(participant.id, true); }
        if (message.type === "participant-joined") setParticipants(current => [...current.filter(item => item.id !== message.participant.id), message.participant]);
        if (message.type === "participant-left") { setParticipants(current => current.filter(item => item.id !== message.participantId)); peersRef.current.get(message.participantId)?.close(); peersRef.current.delete(message.participantId); }
        if (message.type === "signal") await handleSignal(message.from, message.data);
        if (message.type === "media-state") updateParticipant(message.participant);
        if (message.type === "mute-request") {
          streamRef.current?.getAudioTracks().forEach(track => { track.enabled = false; });
          mutedRef.current = true;
          setMuted(true);
          setLocalParticipant(current => current ? { ...current, muted: true } : current);
          socket.send(JSON.stringify({ type: "media-state", muted: true, videoOff: sharingRef.current ? false : videoOffRef.current }));
        }
        if (message.type === "removed") { alert("The host removed you from the meeting."); leave(); }
        if (message.type === "meeting-ended") { alert("The host ended the meeting."); leave(); }
      };
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to join"); setJoining(false); }
  }

  function publishMedia(nextMuted: boolean, nextVideoOff: boolean) {
    mutedRef.current = nextMuted;
    videoOffRef.current = nextVideoOff;
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
    streamRef.current?.getVideoTracks().forEach(track => { track.enabled = !nextVideoOff; });
    const publishedVideoOff = sharingRef.current ? false : nextVideoOff;
    setLocalParticipant(current => current ? { ...current, muted: nextMuted, videoOff: publishedVideoOff } : current);
    socketRef.current?.send(JSON.stringify({ type: "media-state", muted: nextMuted, videoOff: publishedVideoOff }));
  }
  function toggleMute() { const next = !muted; setMuted(next); publishMedia(next, videoOff); }
  function toggleVideo() { const next = !videoOff; setVideoOff(next); publishMedia(muted, next); }

  function replaceOutgoingVideo(track: MediaStreamTrack | null) {
    peersRef.current.forEach(peer => {
      const sender = peer.getSenders().find(item => item.track?.kind === "video");
      if (sender) sender.replaceTrack(track).catch(() => undefined);
    });
  }

  function stopScreenShare() {
    const screenStream = screenStreamRef.current;
    screenStreamRef.current = null;
    sharingRef.current = false;
    screenStream?.getVideoTracks().forEach(track => { track.onended = null; track.stop(); });
    replaceOutgoingVideo(cameraTrackRef.current);
    setLocalParticipant(current => current ? {
      ...current,
      stream: streamRef.current || undefined,
      videoOff: videoOffRef.current,
    } : current);
    socketRef.current?.send(JSON.stringify({ type: "media-state", muted: mutedRef.current, videoOff: videoOffRef.current }));
    setSharing(false);
  }

  async function toggleShare() {
    if (sharingRef.current) { stopScreenShare(); return; }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      screenStreamRef.current = display;
      sharingRef.current = true;
      replaceOutgoingVideo(track);
      setLocalParticipant(current => current ? { ...current, stream: display, videoOff: false } : current);
      socketRef.current?.send(JSON.stringify({ type: "media-state", muted: mutedRef.current, videoOff: false }));
      track.onended = stopScreenShare;
      setSharing(true);
    } catch { /* user cancelled */ }
  }
  function leave() { screenStreamRef.current?.getTracks().forEach(track => track.stop()); socketRef.current?.close(); streamRef.current?.getTracks().forEach(track => track.stop()); router.push("/"); }
  async function endForAll() { if (!meeting) return; const token = localStorage.getItem(`zoomly-host-${meeting.meeting_id}`); if (token) await api.end(meeting.meeting_id, token); leave(); }
  async function copyInvite() { if (!meeting) return; await navigator.clipboard.writeText(meeting.invite_url); setCopied(true); setTimeout(() => setCopied(false), 1800); }

  if (stage === "loading") return <div className="meeting-loading"><LoaderCircle className="spin" /><p>Preparing your meeting…</p></div>;
  if (stage === "error") return <div className="meeting-loading"><div className="error-orb"><X /></div><h1>Unable to join meeting</h1><p>{error}</p><button className="button primary" onClick={() => router.push("/")}>Return home</button></div>;
  if (stage === "preview") return (
    <main className="preview-page"><header className="preview-header"><div className="brand"><span className="brand-mark"><Video size={22} fill="currentColor" /></span><span>zoomly</span></div><span>Meeting ID: {meeting && formatMeetingId(meeting.meeting_id)}</span></header><div className="preview-body"><section className="camera-preview"><video ref={localVideo} autoPlay muted playsInline className={videoOff ? "hidden" : ""} />{videoOff && <div className="preview-avatar">{name.split(" ").map(word => word[0]).join("").slice(0,2).toUpperCase()}</div>}<div className="preview-controls"><button className={muted ? "off" : ""} onClick={toggleMute}>{muted ? <MicOff /> : <Mic />}</button><button className={videoOff ? "off" : ""} onClick={toggleVideo}>{videoOff ? <VideoOff /> : <Video />}</button></div></section><section className="join-panel"><p className="eyebrow">READY TO JOIN?</p><h1>{meeting?.title}</h1><p>Set your name and choose how you&apos;ll appear in the meeting.</p><label><span>Your name</span><input value={name} onChange={event => setName(event.target.value)} maxLength={100} /></label>{error && <div className="alert error">{error}</div>}<button className="button primary full large" onClick={enterRoom} disabled={joining || name.trim().length < 2}>{joining && <LoaderCircle className="spin" />} Join meeting</button><div className="device-status"><span><Check /> Audio connected</span><span><Check /> Camera ready</span></div></section></div></main>
  );

  const allParticipants = localParticipant ? [localParticipant, ...participants] : participants;
  return (
    <main className="meeting-room">
      <header className="room-header">
        <button className="meeting-security"><ShieldCheck size={16} /></button>
        <span>{meeting?.title}</span>
        <button onClick={() => setSidePanel(sidePanel === "info" ? null : "info")}><Info size={18} /></button>
      </header>
      <section className={`meeting-stage ${sidePanel ? "panel-open" : ""}`}>
        <div className={`video-grid count-${Math.min(allParticipants.length, 4)}`}>
          {allParticipants.map(person => <VideoTile participant={person} local={person.id === localParticipant?.id} key={person.id} />)}
        </div>
        {sidePanel && (
          <aside className="room-panel">
            <div className="panel-heading">
              <h2>{sidePanel === "participants" ? `Participants (${allParticipants.length})` : "Meeting information"}</h2>
              <button onClick={() => setSidePanel(null)}><X /></button>
            </div>
            {sidePanel === "participants" ? (
              <>
                <div className="participant-list">
                  {allParticipants.map(person => (
                    <div className="participant-row" key={person.id}>
                      <span className="mini-avatar">{person.name[0]}</span>
                      <span><strong>{person.name}{person.id === localParticipant?.id ? " (You)" : ""}</strong><small>{person.role === "host" ? "Host" : "Participant"}</small></span>
                      <span>
                        {person.muted ? <MicOff /> : <Mic />}
                        {person.videoOff ? <VideoOff /> : <Video />}
                        {localParticipant?.role === "host" && person.role !== "host" && (
                          <button onClick={() => socketRef.current?.send(JSON.stringify({ type: "remove", target: person.id }))}><X /></button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {localParticipant?.role === "host" && <button className="button ghost full" onClick={() => socketRef.current?.send(JSON.stringify({ type: "mute-all" }))}>Mute all</button>}
              </>
            ) : (
              <div className="meeting-details">
                <label>Topic<strong>{meeting?.title}</strong></label>
                <label>Meeting ID<strong>{meeting && formatMeetingId(meeting.meeting_id)}</strong></label>
                <label>Invite link<div className="copy-field"><span>{meeting?.invite_url}</span><button onClick={copyInvite}>{copied ? <Check /> : <Copy />}</button></div></label>
              </div>
            )}
          </aside>
        )}
      </section>
      <footer className="meeting-toolbar">
        <div className="toolbar-group">
          <button className={muted ? "tool off" : "tool"} onClick={toggleMute}>{muted ? <MicOff /> : <Mic />}<span>{muted ? "Unmute" : "Mute"}</span></button>
          <button className="chevron-tool"><ChevronUp /></button>
          <button className={videoOff ? "tool off" : "tool"} onClick={toggleVideo}>{videoOff ? <VideoOff /> : <Video />}<span>{videoOff ? "Start Video" : "Stop Video"}</span></button>
          <button className="chevron-tool"><ChevronUp /></button>
        </div>
        <div className="toolbar-group center">
          <button className="tool" onClick={() => setSidePanel(sidePanel === "participants" ? null : "participants")}><Users /><span>Participants</span><b>{allParticipants.length}</b></button>
          <button className="tool"><Smile /><span>Reactions</span></button>
          <button className={`tool share ${sharing ? "active" : ""}`} onClick={toggleShare}><MonitorUp /><span>{sharing ? "Stop Share" : "Share"}</span></button>
          <button className="tool"><MoreHorizontal /><span>More</span></button>
        </div>
        <div className="toolbar-group end">
          {localParticipant?.role === "host" ? <button className="end-button" onClick={endForAll}><PhoneOff /> End</button> : <button className="end-button" onClick={leave}><LogOut /> Leave</button>}
        </div>
      </footer>
    </main>
  );
}
