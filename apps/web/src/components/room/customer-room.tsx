'use client';

import { CallRoom } from './call-room';

/** Customer entry into the call (invite-token authenticated, no login). */
export function CustomerRoom({ sessionId, inviteToken, displayName }: { sessionId: string; inviteToken: string; displayName: string }) {
  return <CallRoom sessionId={sessionId} displayName={displayName} inviteToken={inviteToken} />;
}
