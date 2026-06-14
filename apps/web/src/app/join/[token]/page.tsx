'use client';

import { use, useEffect, useState } from 'react';
import { Loader2, ShieldX } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Api } from '@/lib/api';
import { CallRoom } from '@/components/room/call-room';
import { PreJoin, type PreJoinChoice } from '@/components/room/pre-join';

/**
 * Customer join portal (Google-Meet-style). Validates the invite token, then
 * shows a green room with a live device preview before dropping the customer
 * into the call — no login, no app install.
 */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<'validating' | 'invalid' | 'ready'>('validating');
  const [error, setError] = useState('');
  const [info, setInfo] = useState<any>(null);
  const [choice, setChoice] = useState<PreJoinChoice | null>(null);

  useEffect(() => {
    Api.validateInvite(token)
      .then((res) => { setInfo(res); setState('ready'); })
      .catch((e) => { setError(e.message ?? 'This invite is not valid'); setState('invalid'); });
  }, [token]);

  if (state === 'validating') {
    return <Center><Loader2 className="h-6 w-6 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Validating your invite…</p></Center>;
  }
  if (state === 'invalid') {
    return (
      <Center>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10"><ShieldX className="h-6 w-6 text-destructive" /></div>
        <h1 className="text-lg font-semibold">Invite not valid</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
        <p className="text-xs text-muted-foreground">Ask your support agent to send a fresh link.</p>
      </Center>
    );
  }
  if (choice) {
    return (
      <CallRoom
        sessionId={info.sessionId}
        inviteToken={token}
        displayName={choice.displayName}
        initialAudio={choice.audioEnabled}
        initialVideo={choice.videoEnabled}
      />
    );
  }

  return (
    <PreJoin
      title={info.sessionTitle}
      subtitle="You've been invited to a video support session."
      roleLabel="Valid invite · joining as guest"
      defaultName={info.customerName ?? ''}
      onJoin={setChoice}
    />
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-mesh p-4 text-center">{children}</div>;
}
