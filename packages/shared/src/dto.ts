import {
  ParticipantRole,
  ParticipantStatus,
  RecordingStatus,
  SessionStatus,
  UserRole,
  MessageType,
  Sentiment,
} from './enums';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
}

export interface SessionParticipant {
  id: string;
  sessionId: string;
  userId?: string | null;
  displayName: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  joinedAt?: string | null;
  leftAt?: string | null;
  durationSeconds?: number | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  connectionQuality?: 'excellent' | 'good' | 'fair' | 'poor' | null;
}

export interface SupportSession {
  id: string;
  code: string;
  title: string;
  status: SessionStatus;
  agentId: string;
  agentName: string;
  customerName?: string | null;
  recordingStatus: RecordingStatus;
  recordingId?: string | null;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  participantCount: number;
  participants?: SessionParticipant[];
  tags?: string[];
  qualityScore?: number | null;
  summary?: string | null;
  sentiment?: Sentiment | null;
}

export interface ChatMessageDto {
  id: string;
  sessionId: string;
  senderId?: string | null;
  senderName: string;
  senderRole: ParticipantRole;
  type: MessageType;
  body: string;
  fileId?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
  createdAt: string;
}

export interface RecordingDto {
  id: string;
  sessionId: string;
  status: RecordingStatus;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
  storageKey?: string | null;
  downloadUrl?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
}

export interface SharedFileDto {
  id: string;
  sessionId: string;
  uploaderName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  downloadUrl?: string | null;
  createdAt: string;
}

// ---- Request DTOs ----
export interface CreateSessionRequest {
  title: string;
  customerName?: string;
  scheduledAt?: string;
  tags?: string[];
}

export interface CreateInviteRequest {
  sessionId: string;
  customerName?: string;
  expiresInSeconds?: number;
}

export interface InviteResponse {
  token: string;
  url: string;
  sessionId: string;
  sessionCode: string;
  expiresAt: string;
}

export interface JoinSessionRequest {
  inviteToken?: string; // customers
  displayName: string;
}

export interface JoinSessionResponse {
  session: SupportSession;
  participant: SessionParticipant;
  /** short-lived token authorising the media-server connection */
  mediaToken: string;
}

export interface AiSummaryDto {
  sessionId: string;
  summary: string;
  sentiment: Sentiment;
  issueCategory: string;
  actionItems: string[];
  supportNotes: string;
  kbSuggestions: { title: string; url: string; snippet: string }[];
  qualityScore: number;
  generatedAt: string;
}

// ---- Analytics ----
export interface AnalyticsOverview {
  totalSessions: number;
  activeSessions: number;
  totalParticipants: number;
  avgDurationSeconds: number;
  avgQualityScore: number;
  resolutionRate: number;
  recordingsCount: number;
  sentimentBreakdown: Record<Sentiment, number>;
  sessionsByDay: { date: string; count: number }[];
  topIssueCategories: { category: string; count: number }[];
  agentLeaderboard: {
    agentId: string;
    agentName: string;
    sessions: number;
    avgQuality: number;
    avgDuration: number;
  }[];
  heatmap: { day: number; hour: number; count: number }[];
}
