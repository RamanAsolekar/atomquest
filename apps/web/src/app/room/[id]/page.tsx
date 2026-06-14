'use client';

import { use, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CallRoom } from '@/components/room/call-room';
import { PreJoin, type PreJoinChoice } from '@/components/room/pre-join';
import { useAuth } from '@/store/auth-store';

/** Agent room entry. Agents are JWT-authenticated; the green room confirms name + devices. */
export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useAuth();
  const [choice, setChoice] = useState<PreJoinChoice | null>(null);

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  if (!choice) {
    return (
      <PreJoin
        title="Ready to join?"
        subtitle="Set up your camera and mic before entering."
        roleLabel="Joining as agent"
        defaultName={user?.name ?? ''}
        onJoin={setChoice}
      />
    );
  }
  return (
    <CallRoom
      sessionId={id}
      displayName={choice.displayName}
      initialAudio={choice.audioEnabled}
      initialVideo={choice.videoEnabled}
    />
  );
}
