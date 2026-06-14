'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MediaClient, RemoteStream } from '@/lib/media-client';
import { RealtimeClient, RtServerEvents } from '@/lib/realtime-client';
import { Api } from '@/lib/api';
import { AppMediaKind, ParticipantRole, STATS_INTERVAL_MS } from '@atom/shared';

export interface ChatMessage {
  id: string;
  senderName: string;
  senderRole: string;
  type: string;
  body: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  createdAt: string;
}

export interface RoomParticipant {
  id: string;
  displayName: string;
  role: string;
  status: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
}

interface JoinResult {
  session: any;
  participant: any;
  mediaToken: string;
}

/**
 * Orchestrates a call: local media → SFU producers, remote SFU consumers,
 * realtime chat/presence, reconnection, recording state and AI insights.
 */
interface InitialMedia {
  audioEnabled?: boolean;
  videoEnabled?: boolean;
}

export function useCallRoom(sessionId: string, displayName: string, inviteToken?: string, initial?: InitialMedia) {
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<ParticipantRole>(ParticipantRole.CUSTOMER);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'failed'>('connecting');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [audioEnabled, setAudioEnabled] = useState(initial?.audioEnabled ?? true);
  const [videoEnabled, setVideoEnabled] = useState(initial?.videoEnabled ?? true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [recording, setRecording] = useState<string>('IDLE');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<any[]>([]);
  const [transcript, setTranscript] = useState<{ id: string; speaker?: string; text: string; createdAt: string }[]>([]);
  const [quality, setQuality] = useState<'excellent' | 'good' | 'fair' | 'poor'>('good');
  const [ended, setEnded] = useState(false);

  const media = useRef<MediaClient | null>(null);
  const rt = useRef<RealtimeClient | null>(null);
  const mediaToken = useRef<string>('');
  const annotationHandlers = useRef<((stroke: any) => void)[]>([]);
  const pointerHandlers = useRef<((p: any) => void)[]>([]);
  // Guards against React 18 StrictMode's double-invoke of the mount effect (and
  // any accidental re-join). Without this, the 2nd invocation tears down the
  // 1st's in-flight SFU socket mid-handshake → "engine close — forced close" →
  // the connect times out. This was the real root cause of "Cannot reach the
  // media server" in the browser (Node clients have no StrictMode, so they
  // always connected — which is why server-side tests kept passing).
  const joinStarted = useRef(false);

  const join = useCallback(async () => {
    if (joinStarted.current) return; // idempotent — ignore duplicate mount
    joinStarted.current = true;
    try {
      const result: JoinResult = await Api.join(sessionId, { displayName, inviteToken });
      mediaToken.current = result.mediaToken;
      setSession(result.session);
      setRole(result.participant.role);
      setRecording(result.session.recordingStatus ?? 'IDLE');

      // Local media is best-effort, like Google Meet: try cam+mic, fall back to
      // audio-only, and if BOTH are blocked still join (view/listen-only) rather
      // than dead-ending with a cryptic "Permission denied".
      let stream: MediaStream = new MediaStream();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setVideoEnabled(false);
          toast.warning('Camera unavailable — joining with audio only');
        } catch {
          setVideoEnabled(false);
          setAudioEnabled(false);
          toast.warning('Camera & mic blocked — joining in view-only mode. Enable them in your browser to share.');
        }
      }
      setLocalStream(stream);

      // SFU
      media.current = new MediaClient(sessionId, result.mediaToken, {
        onRemoteStream: (s) => setRemoteStreams((prev) => [...prev.filter((r) => r.consumerId !== s.consumerId), s]),
        onRemoteStreamClosed: (cid) => setRemoteStreams((prev) => prev.filter((r) => r.consumerId !== cid)),
        onPeerClosed: (pid) => setRemoteStreams((prev) => prev.filter((r) => r.peerId !== pid)),
        onConnectionStateChange: setConnectionState,
      });
      await media.current.connect();
      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      // Honour the green-room choices: produce the tracks, then immediately
      // pause + disable any the participant turned off before joining.
      if (audioTrack) {
        await media.current.produce(audioTrack, AppMediaKind.MIC);
        if (!audioEnabled) { audioTrack.enabled = false; await media.current.pauseProducer(AppMediaKind.MIC); }
      }
      if (videoTrack) {
        await media.current.produce(videoTrack, AppMediaKind.CAM);
        if (!videoEnabled) { videoTrack.enabled = false; await media.current.pauseProducer(AppMediaKind.CAM); }
      }

      // Realtime (chat/presence)
      rt.current = new RealtimeClient(result.mediaToken);
      rt.current.on(RtServerEvents.MESSAGE, (m: ChatMessage) => setMessages((prev) => [...prev, m]));
      rt.current.on(RtServerEvents.ROOM_STATE, ({ participants }: any) => setParticipants(participants));
      rt.current.on(RtServerEvents.SESSION_ENDED, () => { setEnded(true); toast.info('The session has ended'); });
      rt.current.on(RtServerEvents.RECORDING_STATUS, ({ status, recordingId }: any) => { setRecording(status); if (recordingId) setRecordingId(recordingId); });
      rt.current.on(RtServerEvents.AI_INSIGHT, (insight: any) => setAiInsights((prev) => [insight, ...prev].slice(0, 5)));
      rt.current.on(RtServerEvents.TRANSCRIPT, (seg: any) => setTranscript((prev) => [...prev, seg].slice(-200)));
      rt.current.on(RtServerEvents.ANNOTATION, (stroke: any) => annotationHandlers.current.forEach((h) => h(stroke)));
      rt.current.on(RtServerEvents.ANNOTATIONS_CLEARED, () => annotationHandlers.current.forEach((h) => h({ __clear: true })));
      rt.current.on(RtServerEvents.POINTER, (p: any) => pointerHandlers.current.forEach((h) => h(p)));
      rt.current.on(RtServerEvents.PARTICIPANT_RECONNECTING, ({ displayName }: any) => toast.warning(`${displayName} is reconnecting…`));

      // load prior chat (so late joiners see history)
      try { setMessages(await Api.sessionMessages(sessionId)); } catch { /* customers can't read history endpoint; ignore */ }

      setJoined(true);
    } catch (e: any) {
      joinStarted.current = false; // allow a retry after a genuine failure
      setError(e.message ?? 'Failed to join session');
    }
  }, [sessionId, displayName, inviteToken]);

  // connection-quality heartbeat
  useEffect(() => {
    if (!joined) return;
    const t = setInterval(async () => {
      const q = (await media.current?.getStats()) ?? 'good';
      setQuality(q);
      rt.current?.heartbeat(q);
    }, STATS_INTERVAL_MS);
    return () => clearInterval(t);
  }, [joined]);

  /**
   * Acquire camera/mic and PRODUCE the tracks for the first time. Used when a
   * participant joined view-only (devices blocked/missing — common in Chrome
   * device-emulation) and later wants to turn their camera on, and as a fallback
   * inside the toggles when no producer exists yet.
   */
  const enableDevices = useCallback(async (): Promise<void> => {
    if (!media.current) { toast.error('Not connected to the media server yet.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
      localStream?.getTracks().forEach((t) => t.stop());
      setLocalStream(stream);
      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      if (audioTrack) { await media.current.produce(audioTrack, AppMediaKind.MIC); setAudioEnabled(true); rt.current?.toggleMedia({ audioEnabled: true }); }
      if (videoTrack) { await media.current.produce(videoTrack, AppMediaKind.CAM); setVideoEnabled(true); rt.current?.toggleMedia({ videoEnabled: true }); }
      toast.success('Camera & mic enabled');
    } catch (e: any) {
      toast.error(`Could not access camera/mic: ${e?.message ?? 'permission denied'}. Allow it via the lock icon near the address bar.`);
    }
  }, [localStream]);

  const toggleAudio = useCallback(async () => {
    if (!localStream?.getAudioTracks().length) { await enableDevices(); return; }
    const next = !audioEnabled;
    setAudioEnabled(next);
    localStream.getAudioTracks().forEach((t) => (t.enabled = next));
    if (next) await media.current?.resumeProducer(AppMediaKind.MIC);
    else await media.current?.pauseProducer(AppMediaKind.MIC);
    rt.current?.toggleMedia({ audioEnabled: next });
  }, [audioEnabled, localStream, enableDevices]);

  const toggleVideo = useCallback(async () => {
    if (!localStream?.getVideoTracks().length) { await enableDevices(); return; }
    const next = !videoEnabled;
    setVideoEnabled(next);
    localStream.getVideoTracks().forEach((t) => (t.enabled = next));
    if (next) await media.current?.resumeProducer(AppMediaKind.CAM);
    else await media.current?.pauseProducer(AppMediaKind.CAM);
    rt.current?.toggleMedia({ videoEnabled: next });
  }, [videoEnabled, localStream, enableDevices]);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      screenStream?.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
      setScreenSharing(false);
      await media.current?.closeProducer(AppMediaKind.SCREEN);
      rt.current?.toggleMedia({ screenSharing: false });
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error('Screen sharing is not supported in this browser.');
      return;
    }
    let s: MediaStream;
    try {
      s = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError') {
        toast.error(`Could not start screen share: ${e?.message ?? e?.name ?? 'unknown error'}`);
      }
      return; // NotAllowedError = user cancelled the picker → stay silent
    }
    try {
      setScreenStream(s);
      setScreenSharing(true);
      const track = s.getVideoTracks()[0];
      track.onended = () => toggleScreenShare();
      await media.current?.produce(track, AppMediaKind.SCREEN);
      rt.current?.toggleMedia({ screenSharing: true });
    } catch (e: any) {
      toast.error(`Screen share failed to publish: ${e?.message ?? 'unknown error'}`);
      s.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
      setScreenSharing(false);
    }
  }, [screenSharing, screenStream]);

  const sendMessage = useCallback((text: string) => rt.current?.sendMessage(text), []);
  const onAnnotationStroke = useCallback((stroke: any) => rt.current?.annotate(stroke), []);
  const clearAnnotations = useCallback(() => rt.current?.clearAnnotations(), []);
  const sendPointer = useCallback((x: number, y: number) => rt.current?.pointer(x, y), []);
  const registerAnnotationHandler = useCallback((h: (s: any) => void) => { annotationHandlers.current.push(h); }, []);
  const registerPointerHandler = useCallback((h: (p: any) => void) => { pointerHandlers.current.push(h); }, []);

  const startRecording = useCallback(async () => {
    try { await Api.startRecording(sessionId); toast.success('Recording started'); } catch (e: any) { toast.error(e.message); }
  }, [sessionId]);
  const stopRecording = useCallback(async () => {
    try { await Api.stopRecording(sessionId); toast.success('Recording stopped — processing'); } catch (e: any) { toast.error(e.message); }
  }, [sessionId]);

  const leave = useCallback(() => {
    joinStarted.current = false;
    media.current?.close();
    media.current = null;
    rt.current?.close();
    rt.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    screenStream?.getTracks().forEach((t) => t.stop());
  }, [localStream, screenStream]);

  // Keep a stable ref to the latest leave() so the unmount cleanup below doesn't
  // need it in its dependency array (which would make it re-run on every render).
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  const endSession = useCallback(async () => {
    try { await Api.endSession(sessionId); } catch { rt.current?.endSession(); }
    setEnded(true);
  }, [sessionId]);

  // upload a file (authorised by the participant's media token)
  const uploadFile = useCallback(async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mediaToken', mediaToken.current);
    try {
      const { api } = await import('@/lib/api');
      await api('/api/files/upload', { method: 'POST', body: fd, auth: false });
    } catch (e: any) {
      toast.error(e.message ?? 'Upload failed');
    }
  }, []);

  // StrictMode-safe teardown. React 18 StrictMode mounts → unmounts → remounts
  // every effect once in dev. A synchronous teardown here would close the SFU
  // socket the FIRST mount just opened ("forced close"), breaking the connect.
  // We DEFER teardown by a tick into a ref (which survives the remount); if the
  // component immediately remounts (the StrictMode probe), the new mount cancels
  // the pending teardown. A real unmount lets it fire.
  const teardownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (teardownTimer.current) { clearTimeout(teardownTimer.current); teardownTimer.current = null; }
    return () => {
      teardownTimer.current = setTimeout(() => leaveRef.current(), 100);
    };
  }, []);

  return {
    joined, error, session, role, connectionState, quality, ended,
    localStream, screenStream, remoteStreams, participants, messages,
    audioEnabled, videoEnabled, screenSharing, recording, recordingId,
    aiInsights, transcript,
    join, toggleAudio, toggleVideo, toggleScreenShare, sendMessage, enableDevices,
    startRecording, stopRecording, leave, endSession, uploadFile,
    onAnnotationStroke, clearAnnotations, sendPointer,
    registerAnnotationHandler, registerPointerHandler,
  };
}
