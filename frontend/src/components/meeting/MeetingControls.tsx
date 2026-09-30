"use client";

import { ChevronUp, Hand, Info, LogOut, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, PhoneOff, Smile, Users, Video, VideoOff, X } from "lucide-react";
import { useState } from "react";

const reactions = ["👏", "👍", "❤️", "😂", "🎉", "😮"];

type MeetingControlsProps = {
  muted: boolean;
  videoOff: boolean;
  sharing: boolean;
  raisedHand: boolean;
  isHost: boolean;
  participantCount: number;
  waitingCount: number;
  messageCount: number;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleParticipants: () => void;
  onToggleChat: () => void;
  onToggleShare: () => void;
  onToggleHand: () => void;
  onOpenInfo: () => void;
  onReaction: (emoji: string) => void;
  onLeave: () => void;
  onEnd: () => void;
};

export default function MeetingControls({
  muted,
  videoOff,
  sharing,
  raisedHand,
  isHost,
  participantCount,
  waitingCount,
  messageCount,
  onToggleMute,
  onToggleVideo,
  onToggleParticipants,
  onToggleChat,
  onToggleShare,
  onToggleHand,
  onOpenInfo,
  onReaction,
  onLeave,
  onEnd,
}: MeetingControlsProps) {
  const [showReactions, setShowReactions] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);

  function closeMobileMore() {
    setShowMobileMore(false);
    setShowReactions(false);
  }

  function react(emoji: string) {
    onReaction(emoji);
    setShowReactions(false);
    setShowMobileMore(false);
  }

  return (
    <>
      {showMobileMore && (
        <>
          <button className="mobile-more-backdrop" aria-label="Close more controls" onClick={closeMobileMore} />
          <section className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More meeting controls">
            <div className="mobile-more-heading"><strong>More</strong><button aria-label="Close more controls" onClick={closeMobileMore}><X /></button></div>
            <div className="mobile-more-grid">
              <button onClick={() => { onToggleParticipants(); closeMobileMore(); }}><span><Users /></span>Participants<b>{participantCount + waitingCount}</b></button>
              <button onClick={() => setShowReactions(current => !current)}><span><Smile /></span>Reactions</button>
              <button className={raisedHand ? "active" : ""} onClick={() => { onToggleHand(); closeMobileMore(); }}><span><Hand /></span>{raisedHand ? "Lower Hand" : "Raise Hand"}</button>
              <button className={sharing ? "active share" : ""} onClick={() => { onToggleShare(); closeMobileMore(); }}><span><MonitorUp /></span>{sharing ? "Stop Share" : "Share Screen"}</button>
              <button onClick={() => { onOpenInfo(); closeMobileMore(); }}><span><Info /></span>Meeting Info</button>
            </div>
            {showReactions && <div className="mobile-reaction-picker" aria-label="Choose a reaction">{reactions.map(emoji => <button key={emoji} onClick={() => react(emoji)}>{emoji}</button>)}</div>}
          </section>
        </>
      )}
      <footer className="meeting-toolbar">
        <div className="toolbar-group">
          <button title="Mute/unmute (Alt+A)" className={muted ? "tool off" : "tool"} onClick={onToggleMute}>{muted ? <MicOff /> : <Mic />}<span>{muted ? "Unmute" : "Mute"}</span></button>
          <button className="chevron-tool" aria-label="Audio settings"><ChevronUp /></button>
          <button title="Start/stop video (Alt+V)" className={videoOff ? "tool off" : "tool"} onClick={onToggleVideo}>{videoOff ? <VideoOff /> : <Video />}<span>{videoOff ? "Start Video" : "Stop Video"}</span></button>
          <button className="chevron-tool" aria-label="Video settings"><ChevronUp /></button>
        </div>
        <div className="toolbar-group center">
          <button title="View participants" className="tool desktop-participants" onClick={onToggleParticipants}><Users /><span>Participants</span><b>{participantCount + waitingCount}</b></button>
          <button title="Open meeting chat" className="tool mobile-primary-chat" onClick={onToggleChat}><MessageSquare /><span>Chat</span>{messageCount > 0 && <b>{messageCount}</b>}</button>
          <div className="reaction-menu-wrap"><button title="Send a reaction" className="tool" onClick={() => setShowReactions(current => !current)}><Smile /><span>Reactions</span></button>{showReactions && <div className="reaction-menu">{reactions.map(emoji => <button key={emoji} onClick={() => react(emoji)}>{emoji}</button>)}</div>}</div>
          <button title={raisedHand ? "Lower hand" : "Raise hand"} className={`tool ${raisedHand ? "active" : ""}`} onClick={onToggleHand}><Hand /><span>{raisedHand ? "Lower Hand" : "Raise Hand"}</span></button>
          <button title={sharing ? "Stop sharing" : "Share your screen"} className={`tool share ${sharing ? "active" : ""}`} onClick={onToggleShare}><MonitorUp /><span>{sharing ? "Stop Share" : "Share"}</span></button>
          <button title="More meeting controls" className={`tool mobile-more-trigger ${showMobileMore ? "active" : ""}`} onClick={() => setShowMobileMore(current => !current)}><MoreHorizontal /><span>More</span></button>
        </div>
        <div className="toolbar-group end">
          {isHost ? <button title="End meeting for everyone" className="end-button" onClick={onEnd}><PhoneOff /> End</button> : <button title="Leave meeting" className="end-button" onClick={onLeave}><LogOut /> Leave</button>}
        </div>
      </footer>
    </>
  );
}
