'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, Monitor, MonitorOff,
  PhoneOff, MessageSquare, Users, Circle, Square, PencilRuler,
  Sparkles, Loader2, Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Logo } from '@/components/logo';
import { VideoTile } from '@/components/room/video-tile';
import { ChatPanel } from '@/components/room/chat-panel';
import { AnnotationCanvas } from '@/components/room/annotation-canvas';
import { useCallRoom } from '@/hooks/use-call-room';
import { cn, initials } from '@/lib/utils';
import { ParticipantRole, AppMediaKind } from '@atom/shared';

type Panel = 'chat' | 'people' | 'ai' | null;

/** The full in-call experience, shared by the agent room and customer join flow. */
export function CallRoom({ sessionId, displayName, inviteToken }: { sessionId: string; displayName: string; inviteToken?: string }) {
  const router = useRouter();
  const room = useCallRoom(sessionId, displayName, inviteToken);
  const [panel, setPanel] = useState<Panel>('chat');
  const [annotating, setAnnotating] = useState(false);

  useEffect(() => { room.join(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (room.ended) {
      room.leave();
      const t = setTimeout(() => router.push(room.role === ParticipantRole.CUSTOMER ? '/' : '/dashboard'), 1800);
      return () => clearTimeout(t);
    }
  }, [room.ended]); // eslint-disable-line react-hooks/exhaustive-deps

  if (room.error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-mesh p-4 text-center">
        <Logo /><h1 className="text-lg font-semibold">Could not join the session</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{room.error}</p>
        <Button onClick={() => router.push('/')}>Back to start</Button>
      </div>
    );
  }
  if (room.ended) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-mesh text-center">
        <Logo /><h1 className="mt-4 text-lg font-semibold">Session ended</h1>
        <p className="text-sm text-muted-foreground">Thanks for using Atom Support Vision.</p>
      </div>
    );
  }
  if (!room.joined) {
    return <div className="flex h-screen flex-col items-center justify-center gap-3"><Loader2 className="h-6 w-6 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Connecting to the media server…</p></div>;
  }

  const isAgent = room.role === ParticipantRole.AGENT;
  const screenRemote = room.remoteStreams.find((s) => s.mediaTag === AppMediaKind.SCREEN);
  const camRemotes = room.remoteStreams.filter((s) => s.mediaTag === AppMediaKind.CAM);
  const stage = room.screenSharing ? room.screenStream : screenRemote?.stream ?? null;
  const stageName = room.screenSharing ? 'Your screen' : screenRemote?.displayName ?? '';

  return (
    <div className="flex h-screen flex-col bg-[#0a0a0f] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3"><Logo /><span className="hidden text-sm text-white/60 sm:inline">· {room.session?.title}</span></div>
        <div className="flex items-center gap-2">
          {room.recording === 'RECORDING' && <Badge variant="live"><Circle className="mr-1 h-2 w-2 animate-pulse fill-current" />REC</Badge>}
          {room.recording === 'PROCESSING' && <Badge variant="warning">Processing…</Badge>}
          <Badge variant="secondary" className="gap-1.5"><Wifi className={cn('h-3 w-3', room.quality === 'poor' ? 'text-destructive' : room.quality === 'fair' ? 'text-warning' : 'text-success')} />{room.connectionState}</Badge>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col p-3">
          {stage ? (
            <div className="relative min-h-0 flex-1">
              <VideoTile stream={stage} name={stageName} isScreen className="h-full" muted={room.screenSharing} />
              <AnnotationCanvas active={annotating} authorName={displayName} onStroke={room.onAnnotationStroke} onClear={room.clearAnnotations} onPointer={room.sendPointer} registerStrokeHandler={room.registerAnnotationHandler} registerPointerHandler={room.registerPointerHandler} />
              <div className="absolute bottom-3 right-3 flex gap-2">
                <div className="w-40"><VideoTile stream={room.localStream} name={displayName} isLocal audioEnabled={room.audioEnabled} videoEnabled={room.videoEnabled} muted /></div>
                {camRemotes.map((r) => <div key={r.consumerId} className="w-40"><VideoTile stream={r.stream} name={r.displayName} /></div>)}
              </div>
            </div>
          ) : (
            <div className={cn('grid min-h-0 flex-1 gap-3', camRemotes.length === 0 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
              <VideoTile stream={room.localStream} name={displayName} isLocal audioEnabled={room.audioEnabled} videoEnabled={room.videoEnabled} quality={room.quality} muted />
              {camRemotes.map((r) => <VideoTile key={r.consumerId} stream={r.stream} name={r.displayName} />)}
              {camRemotes.length === 0 && <div className="flex items-center justify-center rounded-xl border border-dashed border-white/15 text-sm text-white/50">Waiting for others to join…</div>}
            </div>
          )}
        </div>

        {panel && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-[#0d0d14]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><span className="text-sm font-semibold capitalize">{panel === 'ai' ? 'AI Assistant' : panel}</span></div>
            {panel === 'chat' && <ChatPanel messages={room.messages} myName={displayName} onSend={room.sendMessage} onUpload={room.uploadFile} />}
            {panel === 'people' && <PeoplePanel participants={room.participants} />}
            {panel === 'ai' && <AiPanel insights={room.aiInsights} transcript={room.transcript} />}
          </aside>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-[#0d0d14] px-4 py-3">
        <Ctrl active={room.audioEnabled} onClick={room.toggleAudio} on={Mic} off={MicOff} label="Mic" danger={!room.audioEnabled} />
        <Ctrl active={room.videoEnabled} onClick={room.toggleVideo} on={VideoIcon} off={VideoOff} label="Camera" danger={!room.videoEnabled} />
        <Ctrl active={room.screenSharing} onClick={room.toggleScreenShare} on={MonitorOff} off={Monitor} label="Share" highlight={room.screenSharing} />
        <Ctrl active={annotating} onClick={() => setAnnotating((a) => !a)} on={PencilRuler} off={PencilRuler} label="Annotate" highlight={annotating} />
        {isAgent && (room.recording === 'RECORDING'
          ? <Ctrl active onClick={room.stopRecording} on={Square} off={Square} label="Stop rec" danger />
          : <Ctrl active onClick={room.startRecording} on={Circle} off={Circle} label="Record" disabled={room.recording === 'PROCESSING'} />)}
        <div className="mx-2 hidden h-8 w-px bg-white/10 sm:block" />
        <PanelToggle icon={MessageSquare} active={panel === 'chat'} onClick={() => setPanel(panel === 'chat' ? null : 'chat')} badge={room.messages.length} />
        <PanelToggle icon={Users} active={panel === 'people'} onClick={() => setPanel(panel === 'people' ? null : 'people')} badge={room.participants.filter((p) => p.status === 'CONNECTED').length} />
        <PanelToggle icon={Sparkles} active={panel === 'ai'} onClick={() => setPanel(panel === 'ai' ? null : 'ai')} />
        <div className="mx-2 hidden h-8 w-px bg-white/10 sm:block" />
        {isAgent
          ? <Button variant="destructive" onClick={room.endSession}><PhoneOff />End session</Button>
          : <Button variant="destructive" onClick={() => { room.leave(); router.push('/'); }}><PhoneOff />Leave</Button>}
      </footer>
    </div>
  );
}

function Ctrl({ active, onClick, on: On, off: Off, label, danger, highlight, disabled }: any) {
  const Icon = active ? On : Off;
  return (
    <button onClick={onClick} disabled={disabled} title={label} className={cn('flex h-12 w-12 items-center justify-center rounded-xl transition-all disabled:opacity-40', danger ? 'bg-destructive/90 hover:bg-destructive' : highlight ? 'bg-primary hover:bg-primary/90' : 'bg-white/10 hover:bg-white/20')}>
      <Icon className="h-5 w-5" />
    </button>
  );
}
function PanelToggle({ icon: Icon, active, onClick, badge }: any) {
  return (
    <button onClick={onClick} className={cn('relative flex h-12 w-12 items-center justify-center rounded-xl transition-all', active ? 'bg-primary' : 'bg-white/10 hover:bg-white/20')}>
      <Icon className="h-5 w-5" />
      {badge > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold">{badge}</span>}
    </button>
  );
}
function PeoplePanel({ participants }: { participants: any[] }) {
  return (
    <div className="flex-1 space-y-1 overflow-y-auto p-3">
      {participants.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
          <Avatar className="h-8 w-8"><AvatarFallback className="text-[10px]">{initials(p.displayName)}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.displayName}</p><p className="text-xs capitalize text-white/50">{p.role.toLowerCase()}</p></div>
          <div className="flex items-center gap-1">
            {!p.audioEnabled && <MicOff className="h-3.5 w-3.5 text-white/40" />}
            {!p.videoEnabled && <VideoOff className="h-3.5 w-3.5 text-white/40" />}
            <span className={cn('h-2 w-2 rounded-full', p.status === 'CONNECTED' ? 'bg-success' : p.status === 'RECONNECTING' ? 'bg-warning' : 'bg-white/30')} />
          </div>
        </div>
      ))}
    </div>
  );
}
function AiPanel({ insights, transcript }: { insights: any[]; transcript: { id: string; speaker?: string; text: string }[] }) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <p className="flex items-center gap-2 text-xs font-medium text-primary"><Sparkles className="h-3.5 w-3.5" />AI Session Assistant</p>
        <p className="mt-1 text-xs text-white/60">Live transcription (Whisper) and KB suggestions appear here. A full summary, sentiment & action items are generated when the call ends.</p>
      </div>

      {/* Live transcript (Whisper STT) */}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-success" /></span>
          Live transcript
        </p>
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-2.5">
          {transcript.length === 0
            ? <p className="text-xs text-white/40">Listening… transcript will stream as people speak.</p>
            : transcript.map((t) => (
                <p key={t.id} className="text-xs leading-relaxed"><span className="text-primary">{t.speaker ?? 'caller'}:</span> <span className="text-white/80">{t.text}</span></p>
              ))}
        </div>
      </div>

      {/* KB hints surfaced from the transcript */}
      {insights.length > 0 && <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Suggested articles</p>}
      {insights.map((ins, i) => (ins.items ?? []).map((kb: any, j: number) => (
        <div key={`${i}-${j}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
          <p className="text-sm font-medium">{kb.title}</p><p className="mt-1 text-xs text-white/60">{kb.snippet}</p>
        </div>
      )))}
    </div>
  );
}
