"use client";

import { Check, ChevronUp, Copy, Hand, Info, LoaderCircle, LogOut, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, PhoneOff, Send, ShieldCheck, Smile, UserCheck, UserX, Users, Video, VideoOff, Wifi, WifiOff, X } from "lucide-react";
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
      <div className="tile-label">{participant.muted ? <MicOff size={13} /> : <Mic size={13} />}{participant.name}{local ? " (You)" : ""}{participant.role === "host" && <ShieldCheck size={13} />}{participant.raisedHand && <Hand className="raised-hand" size={14} />}</div>
    </div>
  );
}

type SharedScreen = { participantId: string; name: string; stream: MediaStream };
type ChatMessage = { id: string; participantId: string; name: string; text: string; timestamp: string; pending?: boolean };
type Reaction = { id: string; participantId: string; name: string; emoji: string };
type Toast = { message: string; tone: "info" | "success" | "error" };

function ScreenStage({ screen }: { screen: SharedScreen }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = screen.stream;
      ref.current.play().catch(() => undefined);
    }
  }, [screen.stream]);
  return (
    <div className="screen-share-main">
      <video ref={ref} autoPlay playsInline muted={screen.participantId === "local"} />
      <div className="screen-share-label"><MonitorUp size={14} /> {screen.name}&apos;s screen</div>
    </div>
  );
}

function ToastView({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return <div className={`meeting-toast ${toast.tone}`} role="status">{toast.tone === "success" && <Check />}{toast.tone === "error" && <WifiOff />}{toast.message}</div>;
}

export default function MeetingPage() {
  const id = String(useParams().id);
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [name, setName] = useState("");
  const [stage, setStage] = useState<"loading" | "preview" | "connecting" | "waiting" | "room" | "error">("loading");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [sharedScreen, setSharedScreen] = useState<SharedScreen | null>(null);
  const [copied, setCopied] = useState(false);
  const [sidePanel, setSidePanel] = useState<"participants" | "info" | "chat" | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [waitingParticipants, setWaitingParticipants] = useState<Participant[]>([]);
  const [localParticipant, setLocalParticipant] = useState<Participant | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "reconnecting" | "disconnected">("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [showReactions, setShowReactions] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [raisedHand, setRaisedHand] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const mutedRef = useRef(false);
  const videoOffRef = useRef(false);
  const sharingRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const screenSendersRef = useRef<Map<string, RTCRtpSender>>(new Map());
  const participantsRef = useRef<Participant[]>([]);
  const joinedRef = useRef<{ participantId: string; role: "host" | "guest" } | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidePanelRef = useRef<typeof sidePanel>(null);

  const updateParticipant = useCallback((updated: Participant) => {
    setParticipants(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
  }, []);

  const showToast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => { participantsRef.current = participants; }, [participants]);
  useEffect(() => { sidePanelRef.current = sidePanel; }, [sidePanel]);

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
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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
    const cameraTrack = streamRef.current?.getVideoTracks()[0];
    if (cameraTrack && streamRef.current) peer.addTrack(cameraTrack, streamRef.current);
    const activeScreen = screenStreamRef.current;
    const screenTrack = activeScreen?.getVideoTracks()[0];
    if (screenTrack && activeScreen) screenSendersRef.current.set(target, peer.addTrack(screenTrack, activeScreen));
    peer.onicecandidate = event => { if (event.candidate) socketRef.current?.send(JSON.stringify({ type: "signal", target, data: { candidate: event.candidate } })); };
    peer.ontrack = event => {
      const incomingStream = event.streams[0] || new MediaStream([event.track]);
      const isScreenTrack = event.track.kind === "video" && incomingStream.getAudioTracks().length === 0;
      if (isScreenTrack) {
        const participantName = participantsRef.current.find(item => item.id === target)?.name || "Participant";
        setSharedScreen({ participantId: target, name: participantName, stream: incomingStream });
        event.track.onended = () => setSharedScreen(current => current?.participantId === target ? null : current);
      } else {
        setParticipants(current => current.map(item => item.id === target ? { ...item, stream: incomingStream } : item));
      }
    };
    peer.onconnectionstatechange = () => { if (peer?.connectionState === "failed") peer.restartIce(); };
    if (initiator) {
      await negotiate(target, peer);
    }
    return peer;
  }

  async function negotiate(target: string, peer: RTCPeerConnection) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socketRef.current?.send(JSON.stringify({ type: "signal", target, data: { description: peer.localDescription } }));
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

  function closePeers() {
    peersRef.current.forEach(peer => peer.close());
    peersRef.current.clear();
    screenSendersRef.current.clear();
    participantsRef.current = [];
    setParticipants([]);
    setSharedScreen(current => current?.participantId === joinedRef.current?.participantId ? current : null);
  }

  async function enterActiveRoom(roomParticipants: Participant[]) {
    participantsRef.current = roomParticipants;
    setParticipants(roomParticipants);
    setStage("room");
    setJoining(false);
    for (const participant of roomParticipants) await createPeer(participant.id, true);
  }

  async function handleSocketMessage(message: Record<string, any>, socket: WebSocket) {
    if (message.type === "room-state" || message.type === "admitted") await enterActiveRoom(message.participants || []);
    if (message.type === "waiting-room") { setStage("waiting"); setJoining(false); }
    if (message.type === "waiting-room-state") setWaitingParticipants(message.participants || []);
    if (message.type === "waiting-participant") {
      setWaitingParticipants(current => [...current.filter(item => item.id !== message.participant.id), message.participant]);
      showToast(`${message.participant.name} is waiting to join`, "info");
    }
    if (message.type === "waiting-participant-left") setWaitingParticipants(current => current.filter(item => item.id !== message.participantId));
    if (message.type === "participant-joined") {
      setParticipants(current => [...current.filter(item => item.id !== message.participant.id), message.participant]);
      showToast(`${message.participant.name} joined`, "success");
    }
    if (message.type === "participant-left") {
      setParticipants(current => current.filter(item => item.id !== message.participantId));
      setSharedScreen(current => current?.participantId === message.participantId ? null : current);
      peersRef.current.get(message.participantId)?.close();
      peersRef.current.delete(message.participantId);
      screenSendersRef.current.delete(message.participantId);
    }
    if (message.type === "signal") await handleSignal(message.from, message.data);
    if (message.type === "media-state" || message.type === "participant-update") updateParticipant(message.participant);
    if (message.type === "screen-share-state") {
      setParticipants(current => current.map(item => item.id === message.participantId ? { ...item, sharing: message.sharing } : item));
      if (!message.sharing) setSharedScreen(current => current?.participantId === message.participantId ? null : current);
      else setSharedScreen(current => {
        if (!current || current.participantId !== message.participantId) return current;
        return { ...current, name: message.name };
      });
    }
    if (message.type === "chat") {
      setMessages(current => {
        const existing = current.findIndex(item => item.id === message.message.id);
        if (existing < 0) return [...current, message.message];
        return current.map((item, index) => index === existing ? { ...message.message, pending: false } : item);
      });
      if (sidePanelRef.current !== "chat" && message.message.participantId !== joinedRef.current?.participantId) showToast(`New message from ${message.message.name}`, "info");
    }
    if (message.type === "reaction") {
      const reaction = { ...message, id: message.id || `${message.participantId}-${Date.now()}-${Math.random()}` } as Reaction;
      setReactions(current => current.some(item => item.id === reaction.id) ? current : [...current, reaction]);
      setTimeout(() => setReactions(current => current.filter(item => item.id !== reaction.id)), 3200);
    }
    if (message.type === "mute-request") {
      streamRef.current?.getAudioTracks().forEach(track => { track.enabled = false; });
      mutedRef.current = true;
      setMuted(true);
      setLocalParticipant(current => current ? { ...current, muted: true } : current);
      socket.send(JSON.stringify({ type: "media-state", muted: true, videoOff: videoOffRef.current }));
      showToast("The host muted everyone", "info");
    }
    if (message.type === "denied") {
      intentionalCloseRef.current = true;
      setError("The host did not admit you to this meeting.");
      setStage("error");
      socket.close();
    }
    if (message.type === "removed" || message.type === "meeting-ended") {
      intentionalCloseRef.current = true;
      showToast(message.type === "removed" ? "The host removed you from the meeting" : "The host ended the meeting", "error");
      setTimeout(leave, 1500);
    }
  }

  function connectSocket(meetingId: string, participantId: string, reconnecting = false) {
    setConnectionStatus(reconnecting ? "reconnecting" : "connecting");
    const socket = new WebSocket(`${WS_URL}/ws/meetings/${meetingId}?participant_id=${participantId}`);
    socketRef.current = socket;
    socket.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setConnectionStatus("connected");
      socket.send(JSON.stringify({ type: "media-state", muted: mutedRef.current, videoOff: videoOffRef.current }));
      if (sharingRef.current) socket.send(JSON.stringify({ type: "screen-share-state", sharing: true }));
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      keepAliveRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 20_000);
      if (reconnecting) showToast("You are back online", "success");
    };
    socket.onmessage = event => { void handleSocketMessage(JSON.parse(event.data), socket); };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (keepAliveRef.current) clearInterval(keepAliveRef.current);
      if (intentionalCloseRef.current) return;
      closePeers();
      const attempt = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = attempt;
      setConnectionStatus(attempt >= 5 ? "disconnected" : "reconnecting");
      if (attempt === 1) showToast("Connection interrupted. Reconnecting…", "error");
      const delay = Math.min(1000 * 2 ** (attempt - 1), 15_000);
      reconnectTimerRef.current = setTimeout(() => connectSocket(meetingId, participantId, true), delay);
    };
  }

  async function enterRoom() {
    if (!meeting || name.trim().length < 2) return;
    setJoining(true); setError(""); setStage("connecting");
    try {
      const hostToken = localStorage.getItem(`zoomly-host-${meeting.meeting_id}`) || undefined;
      const joined = await api.join(meeting.meeting_id, name.trim(), hostToken);
      const local: Participant = { id: joined.participant_id, name: name.trim(), role: joined.role, muted, videoOff, stream: streamRef.current || undefined };
      joinedRef.current = { participantId: joined.participant_id, role: joined.role };
      setLocalParticipant(local);
      intentionalCloseRef.current = false;
      connectSocket(meeting.meeting_id, joined.participant_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join");
      setJoining(false); setStage("preview");
    }
  }

  function publishMedia(nextMuted: boolean, nextVideoOff: boolean) {
    mutedRef.current = nextMuted;
    videoOffRef.current = nextVideoOff;
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
    streamRef.current?.getVideoTracks().forEach(track => { track.enabled = !nextVideoOff; });
    setLocalParticipant(current => current ? { ...current, muted: nextMuted, videoOff: nextVideoOff } : current);
    socketRef.current?.send(JSON.stringify({ type: "media-state", muted: nextMuted, videoOff: nextVideoOff }));
  }
  function toggleMute() { const next = !muted; setMuted(next); publishMedia(next, videoOff); }
  function toggleVideo() { const next = !videoOff; setVideoOff(next); publishMedia(muted, next); }

  async function stopScreenShare() {
    const screenStream = screenStreamRef.current;
    screenStreamRef.current = null;
    sharingRef.current = false;
    screenStream?.getVideoTracks().forEach(track => { track.onended = null; track.stop(); });
    const negotiations: Promise<void>[] = [];
    peersRef.current.forEach((peer, target) => {
      const sender = screenSendersRef.current.get(target);
      if (sender) peer.removeTrack(sender);
      screenSendersRef.current.delete(target);
      negotiations.push(negotiate(target, peer).catch(() => undefined));
    });
    await Promise.all(negotiations);
    setSharedScreen(current => current?.participantId === localParticipant?.id ? null : current);
    socketRef.current?.send(JSON.stringify({ type: "screen-share-state", sharing: false }));
    setSharing(false);
  }

  async function toggleShare() {
    if (sharingRef.current) { await stopScreenShare(); return; }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      screenStreamRef.current = display;
      sharingRef.current = true;
      if (localParticipant) setSharedScreen({ participantId: localParticipant.id, name: localParticipant.name, stream: display });
      const negotiations: Promise<void>[] = [];
      peersRef.current.forEach((peer, target) => {
        screenSendersRef.current.set(target, peer.addTrack(track, display));
        negotiations.push(negotiate(target, peer));
      });
      await Promise.all(negotiations);
      socketRef.current?.send(JSON.stringify({ type: "screen-share-state", sharing: true }));
      track.onended = () => { void stopScreenShare(); };
      setSharing(true);
    } catch { showToast("Screen sharing was cancelled", "info"); }
  }
  function sendSocket(payload: object) {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      showToast("Still reconnecting. Please try again in a moment.", "error");
      return false;
    }
    socketRef.current.send(JSON.stringify(payload));
    return true;
  }
  function admitParticipant(participantId: string) { sendSocket({ type: "admit", target: participantId }); }
  function denyParticipant(participantId: string) { sendSocket({ type: "deny", target: participantId }); }
  function sendChat(event: React.FormEvent) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || !localParticipant) return;
    const clientId = crypto.randomUUID();
    if (!sendSocket({ type: "chat", text, clientId })) return;
    setMessages(current => [...current, {
      id: clientId,
      participantId: localParticipant.id,
      name: localParticipant.name,
      text,
      timestamp: new Date().toISOString(),
      pending: true,
    }]);
    setChatInput("");
  }
  function sendReaction(emoji: string) {
    if (!localParticipant) return;
    const clientId = crypto.randomUUID();
    if (!sendSocket({ type: "reaction", emoji, clientId })) return;
    const reaction = { id: clientId, participantId: localParticipant.id, name: localParticipant.name, emoji };
    setReactions(current => [...current, reaction]);
    setTimeout(() => setReactions(current => current.filter(item => item.id !== clientId)), 3200);
    setShowReactions(false);
    setShowMobileMore(false);
  }
  function toggleRaiseHand() {
    const next = !raisedHand;
    setRaisedHand(next);
    setLocalParticipant(current => current ? { ...current, raisedHand: next } : current);
    sendSocket({ type: "raise-hand", raised: next });
    showToast(next ? "Your hand is raised" : "You lowered your hand", "info");
  }
  function leave() {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    screenStreamRef.current?.getTracks().forEach(track => track.stop());
    socketRef.current?.close();
    streamRef.current?.getTracks().forEach(track => track.stop());
    router.push("/");
  }
  async function endForAll() {
    if (!meeting) return;
    const token = localStorage.getItem(`zoomly-host-${meeting.meeting_id}`);
    try { if (token) await api.end(meeting.meeting_id, token); leave(); }
    catch { showToast("Unable to end the meeting. Please try again.", "error"); }
  }
  async function copyInvite() {
    if (!meeting) return;
    await navigator.clipboard.writeText(meeting.invite_url);
    setCopied(true); showToast("Invitation copied", "success");
    setTimeout(() => setCopied(false), 1800);
  }

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (stage !== "room" || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.altKey && event.key.toLowerCase() === "a") { event.preventDefault(); toggleMute(); }
      if (event.altKey && event.key.toLowerCase() === "v") { event.preventDefault(); toggleVideo(); }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [stage, muted, videoOff]);

  if (stage === "loading") return <div className="meeting-loading"><LoaderCircle className="spin" /><p>Preparing your meeting…</p></div>;
  if (stage === "error") return <div className="meeting-loading"><div className="error-orb"><X /></div><h1>Unable to join meeting</h1><p>{error}</p><button className="button primary" onClick={() => router.push("/")}>Return home</button></div>;
  if (stage === "connecting") return <div className="meeting-loading dark"><LoaderCircle className="spin" /><h1>Joining {meeting?.title}</h1><p>Establishing a secure connection…</p><button className="button ghost" onClick={leave}>Cancel</button></div>;
  if (stage === "waiting") return (
    <main className="waiting-room-page">
      <ToastView toast={toast} />
      <div className="waiting-room-card"><div className="waiting-pulse"><Users /></div><p className="eyebrow">WAITING ROOM</p><h1>The host will let you in soon</h1><p>You&apos;re connected. Keep this window open and we&apos;ll join automatically when the host admits you.</p><div className="waiting-user"><span className="avatar">{name.split(" ").map(word => word[0]).join("").slice(0, 2)}</span><span><strong>{name}</strong><small><Wifi size={13} /> Connected</small></span></div><button className="button ghost" onClick={leave}>Leave waiting room</button></div>
    </main>
  );
  if (stage === "preview") return (
    <main className="preview-page"><header className="preview-header"><div className="brand"><span className="brand-mark"><Video size={22} fill="currentColor" /></span><span>zoomly</span></div><span>Meeting ID: {meeting && formatMeetingId(meeting.meeting_id)}</span></header><div className="preview-body"><section className="camera-preview"><video ref={localVideo} autoPlay muted playsInline className={videoOff ? "hidden" : ""} />{videoOff && <div className="preview-avatar">{name.split(" ").map(word => word[0]).join("").slice(0,2).toUpperCase()}</div>}<div className="preview-controls"><button className={muted ? "off" : ""} onClick={toggleMute}>{muted ? <MicOff /> : <Mic />}</button><button className={videoOff ? "off" : ""} onClick={toggleVideo}>{videoOff ? <VideoOff /> : <Video />}</button></div></section><section className="join-panel"><p className="eyebrow">READY TO JOIN?</p><h1>{meeting?.title}</h1><p>Set your name and choose how you&apos;ll appear in the meeting.</p><label><span>Your name</span><input value={name} onChange={event => setName(event.target.value)} maxLength={100} /></label>{error && <div className="alert error">{error}</div>}<button className="button primary full large" onClick={enterRoom} disabled={joining || name.trim().length < 2}>{joining && <LoaderCircle className="spin" />} Join meeting</button><div className="device-status"><span><Check /> Audio connected</span><span><Check /> Camera ready</span></div></section></div></main>
  );

  const allParticipants = localParticipant ? [localParticipant, ...participants] : participants;
  return (
    <main className="meeting-room">
      <ToastView toast={toast} />
      {connectionStatus !== "connected" && <div className={`connection-banner ${connectionStatus}`}><WifiOff />{connectionStatus === "disconnected" ? "Connection lost — still trying to reconnect" : "Reconnecting to the meeting…"}</div>}
      <div className="reaction-layer" aria-live="polite">{reactions.map(reaction => <div className="floating-reaction" key={reaction.id}><span>{reaction.emoji}</span><small>{reaction.name}</small></div>)}</div>
      <header className="room-header">
        <button className="meeting-security"><ShieldCheck size={16} /></button>
        <span>{meeting?.title}</span>
        <button onClick={() => setSidePanel(sidePanel === "info" ? null : "info")}><Info size={18} /></button>
      </header>
      <section className={`meeting-stage ${sidePanel ? "panel-open" : ""}`}>
        {sharedScreen ? (
          <div className="screen-share-layout">
            <ScreenStage screen={sharedScreen} />
            <div className="video-filmstrip" aria-label="Participant videos">
              {allParticipants.map(person => <VideoTile participant={person} local={person.id === localParticipant?.id} key={person.id} />)}
            </div>
          </div>
        ) : (
          <div className={`video-grid count-${Math.min(allParticipants.length, 4)}`}>
            {allParticipants.map(person => <VideoTile participant={person} local={person.id === localParticipant?.id} key={person.id} />)}
          </div>
        )}
        {sidePanel && (
          <aside className="room-panel">
            <div className="panel-heading">
              <h2>{sidePanel === "participants" ? `Participants (${allParticipants.length})` : sidePanel === "chat" ? "Meeting chat" : "Meeting information"}</h2>
              <button title="Close panel" aria-label="Close panel" onClick={() => setSidePanel(null)}><X /></button>
            </div>
            {sidePanel === "participants" ? (
              <>
                {localParticipant?.role === "host" && waitingParticipants.length > 0 && <div className="waiting-list"><h3>Waiting room ({waitingParticipants.length})</h3>{waitingParticipants.map(person => <div className="waiting-row" key={person.id}><span className="mini-avatar">{person.name[0]}</span><strong>{person.name}</strong><button title={`Admit ${person.name}`} onClick={() => admitParticipant(person.id)}><UserCheck /></button><button className="deny" title={`Deny ${person.name}`} onClick={() => denyParticipant(person.id)}><UserX /></button></div>)}</div>}
                <div className="participant-list">
                  {allParticipants.map(person => (
                    <div className="participant-row" key={person.id}>
                      <span className="mini-avatar">{person.name[0]}</span>
                      <span><strong>{person.name}{person.id === localParticipant?.id ? " (You)" : ""}</strong><small>{person.role === "host" ? "Host" : "Participant"}</small></span>
                      <span>
                        {person.muted ? <MicOff /> : <Mic />}
                        {person.videoOff ? <VideoOff /> : <Video />}{person.raisedHand && <Hand className="raised-hand" />}
                        {localParticipant?.role === "host" && person.role !== "host" && (
                          <button title={`Remove ${person.name}`} onClick={() => sendSocket({ type: "remove", target: person.id })}><X /></button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {localParticipant?.role === "host" && <button className="button ghost full" onClick={() => sendSocket({ type: "mute-all" })}>Mute all</button>}
              </>
            ) : sidePanel === "chat" ? (
              <div className="chat-panel">
                <div className="chat-messages">{messages.length === 0 ? <div className="chat-empty"><MessageSquare /><strong>No messages yet</strong><span>Messages are visible to everyone in the meeting.</span></div> : messages.map(message => <div className={`chat-message ${message.participantId === localParticipant?.id ? "mine" : ""}`} key={message.id}><div><strong>{message.participantId === localParticipant?.id ? "You" : message.name}</strong><time>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p>{message.text}</p></div>)}</div>
                <form className="chat-form" onSubmit={sendChat}><input aria-label="Chat message" maxLength={1000} placeholder="Type a message…" value={chatInput} onChange={event => setChatInput(event.target.value)} /><button title="Send message" aria-label="Send message" disabled={!chatInput.trim() || connectionStatus !== "connected"}><Send /></button></form>
              </div>
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
      {showMobileMore && (
        <>
          <button className="mobile-more-backdrop" aria-label="Close more controls" onClick={() => { setShowMobileMore(false); setShowReactions(false); }} />
          <section className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More meeting controls">
            <div className="mobile-more-heading"><strong>More</strong><button aria-label="Close more controls" onClick={() => { setShowMobileMore(false); setShowReactions(false); }}><X /></button></div>
            <div className="mobile-more-grid">
              <button onClick={() => { setSidePanel("chat"); setShowMobileMore(false); }}><span><MessageSquare /></span>Chat{messages.length > 0 && <b>{messages.length}</b>}</button>
              <button onClick={() => setShowReactions(current => !current)}><span><Smile /></span>Reactions</button>
              <button className={raisedHand ? "active" : ""} onClick={() => { toggleRaiseHand(); setShowMobileMore(false); }}><span><Hand /></span>{raisedHand ? "Lower Hand" : "Raise Hand"}</button>
              <button className={sharing ? "active share" : ""} onClick={() => { void toggleShare(); setShowMobileMore(false); }}><span><MonitorUp /></span>{sharing ? "Stop Share" : "Share Screen"}</button>
              <button onClick={() => { setSidePanel("info"); setShowMobileMore(false); }}><span><Info /></span>Meeting Info</button>
            </div>
            {showReactions && <div className="mobile-reaction-picker" aria-label="Choose a reaction">{["👏", "👍", "❤️", "😂", "🎉", "😮"].map(emoji => <button key={emoji} onClick={() => sendReaction(emoji)}>{emoji}</button>)}</div>}
          </section>
        </>
      )}
      <footer className="meeting-toolbar">
        <div className="toolbar-group">
          <button title="Mute/unmute (Alt+A)" className={muted ? "tool off" : "tool"} onClick={toggleMute}>{muted ? <MicOff /> : <Mic />}<span>{muted ? "Unmute" : "Mute"}</span></button>
          <button className="chevron-tool"><ChevronUp /></button>
          <button title="Start/stop video (Alt+V)" className={videoOff ? "tool off" : "tool"} onClick={toggleVideo}>{videoOff ? <VideoOff /> : <Video />}<span>{videoOff ? "Start Video" : "Stop Video"}</span></button>
          <button className="chevron-tool"><ChevronUp /></button>
        </div>
        <div className="toolbar-group center">
          <button title="View participants" className="tool" onClick={() => setSidePanel(sidePanel === "participants" ? null : "participants")}><Users /><span>Participants</span><b>{allParticipants.length + waitingParticipants.length}</b></button>
          <button title="Open meeting chat" className="tool" onClick={() => setSidePanel(sidePanel === "chat" ? null : "chat")}><MessageSquare /><span>Chat</span>{messages.length > 0 && <b>{messages.length}</b>}</button>
          <div className="reaction-menu-wrap"><button title="Send a reaction" className="tool" onClick={() => setShowReactions(current => !current)}><Smile /><span>Reactions</span></button>{showReactions && <div className="reaction-menu">{["👏", "👍", "❤️", "😂", "🎉", "😮"].map(emoji => <button key={emoji} onClick={() => sendReaction(emoji)}>{emoji}</button>)}</div>}</div>
          <button title={raisedHand ? "Lower hand" : "Raise hand"} className={`tool ${raisedHand ? "active" : ""}`} onClick={toggleRaiseHand}><Hand /><span>{raisedHand ? "Lower Hand" : "Raise Hand"}</span></button>
          <button title={sharing ? "Stop sharing" : "Share your screen"} className={`tool share ${sharing ? "active" : ""}`} onClick={toggleShare}><MonitorUp /><span>{sharing ? "Stop Share" : "Share"}</span></button>
          <button title="More meeting controls" className={`tool mobile-more-trigger ${showMobileMore ? "active" : ""}`} onClick={() => setShowMobileMore(current => !current)}><MoreHorizontal /><span>More</span></button>
        </div>
        <div className="toolbar-group end">
          {localParticipant?.role === "host" ? <button title="End meeting for everyone" className="end-button" onClick={endForAll}><PhoneOff /> End</button> : <button title="Leave meeting" className="end-button" onClick={leave}><LogOut /> Leave</button>}
        </div>
      </footer>
    </main>
  );
}
