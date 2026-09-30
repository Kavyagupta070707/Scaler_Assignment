export type Meeting = {
  meeting_id: string;
  title: string;
  description: string;
  meeting_type: "instant" | "scheduled";
  status: "scheduled" | "live" | "ended" | "cancelled";
  scheduled_at: string;
  duration_minutes: number;
  timezone_name: string;
  waiting_room: boolean;
  participants_video: boolean;
  invite_url: string;
  host_token?: string | null;
};

export type Participant = {
  id: string;
  name: string;
  role: "host" | "guest";
  muted: boolean;
  videoOff: boolean;
  sharing?: boolean;
  stream?: MediaStream;
};
