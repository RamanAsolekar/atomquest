'use client';

import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

const actionVariant: Record<string, any> = {
  LOGIN: 'success', LOGIN_FAILED: 'destructive', LOGOUT: 'secondary',
  CREATE_SESSION: 'default', END_SESSION: 'warning', FORCE_END_SESSION: 'destructive',
  START_RECORDING: 'default', STOP_RECORDING: 'warning', DOWNLOAD_RECORDING: 'secondary',
};

export default function AuditPage() {
  const { data, isLoading } = useQuery({ queryKey: ['audit'], queryFn: () => Api.auditLogs() });
  const logs = data?.items ?? [];

  return (
    <AppShell>
      <div className="h-screen overflow-y-auto">
        <div className="container max-w-4xl py-8">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ScrollText className="h-6 w-6 text-primary" />Audit Logs</h1>
          <p className="text-sm text-muted-foreground">Immutable record of security-relevant actions across the platform.</p>

          <Card className="mt-6"><CardContent className="p-0">
            {isLoading ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
              : logs.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No audit entries yet.</p>
                : <div className="divide-y">{logs.map((l: any) => (
                  <div key={l.id} className="flex items-center gap-3 px-4 py-3">
                    <Badge variant={actionVariant[l.action] ?? 'secondary'}>{l.action}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{l.actor?.name ?? 'Anonymous'} {l.targetType ? `· ${l.targetType}` : ''}</p>
                      <p className="text-xs text-muted-foreground">{l.ip ?? '—'} · {timeAgo(l.createdAt)}</p>
                    </div>
                  </div>
                ))}</div>}
          </CardContent></Card>
        </div>
      </div>
    </AppShell>
  );
}
