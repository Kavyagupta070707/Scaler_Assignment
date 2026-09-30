import { Meeting } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || API_URL.replace(/^http/, "ws");

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Something went wrong. Please try again.");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  meetings: () => request<{ upcoming: Meeting[]; recent: Meeting[] }>("/api/meetings"),
  meeting: (id: string) => request<Meeting>(`/api/meetings/${encodeURIComponent(id)}`),
  instant: () => request<Meeting>("/api/meetings/instant", { method: "POST" }),
  schedule: (body: unknown) => request<Meeting>("/api/meetings/scheduled", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => request<void>(`/api/meetings/${id}`, { method: "DELETE" }),
  join: (id: string, displayName: string, hostToken?: string) =>
    request<{ participant_id: string; role: "host" | "guest"; meeting: Meeting }>(`/api/meetings/${encodeURIComponent(id)}/join`, {
      method: "POST",
      body: JSON.stringify({ display_name: displayName, host_token: hostToken || null }),
    }),
  end: (id: string, hostToken: string) => request<void>(`/api/meetings/${id}/end?host_token=${encodeURIComponent(hostToken)}`, { method: "POST" }),
};

export function saveHostToken(meeting: Meeting) {
  if (meeting.host_token) localStorage.setItem(`zoomly-host-${meeting.meeting_id}`, meeting.host_token);
}

export function formatMeetingId(id: string) {
  const digits = id.replace(/\D/g, "");
  return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`.trim();
}

export function meetingIdentifier(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    const queryValue = url.searchParams.get("meeting");
    if (queryValue) return queryValue;
    const roomMatch = url.pathname.match(/\/meeting\/([^/]+)/);
    if (roomMatch) return decodeURIComponent(roomMatch[1]);
  } catch {
    // A plain meeting ID or invitation token is already a valid identifier.
  }
  return trimmed;
}
