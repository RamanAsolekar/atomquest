'use client';

import { use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Download, Sparkles, Clock, Users, FileText, Loader2,
  Activity, Tag, Gauge,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Api } from '@/lib/api';
import { env } from '@/lib/config';
import { formatBytes, formatDuration, initials, timeAgo } from '@/lib/utils';

const sentimentVariant: Record<string, any> = { POSITIVE: 'success', NEUTRAL: 'secondary', NEGATIVE: 'warning', FRUSTRATED: 'destructive' };

export default function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();

  const session = useQuery({ queryKey: ['session', id], queryFn: () => Api.getSession(id) });
  const events = useQuery({ queryKey: ['events', id], queryFn: () => Api.sessionEvents(id) });
  const messages = useQuery({ queryKey: ['messages', id], queryFn: () => Api.sessionMessages(id) });
  const recordings = useQuery({ queryKey: ['recordings', id], queryFn: () => Api.recordings(id) });
  const files = useQuery({ queryKey: ['files', id], queryFn: () => Api.sessionFiles(id) });
  const ai = useQuery({ queryKey: ['ai', id], queryFn: () => Api.aiSummary(id) });

  const genAi = useMutation({
    mutationFn: () => Api.generateAiSummary(id),
    onSuccess: () => { toast.success('AI summary generated'); qc.invalidateQueries({ queryKey: ['ai', id] }); qc.invalidateQueries({ queryKey: ['session', id] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const s = session.data;

  return (
    <AppShell>
      <div className="h-screen overflow-y-auto">
        <div className="container max-w-5xl py-8">
          <Link href="/history" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to history</Link>

          {session.isLoading || !s ? <Skeleton className="h-32" /> : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><h1 className="text-2xl font-bold tracking-tight">{s.title}</h1><Badge variant={s.status === 'ENDED' ? 'secondary' : 'success'}>{s.status}</Badge></div>
                  <p className="mt-1 text-sm text-muted-foreground">Code {s.code} · {s.customerName ?? 'Customer'} · agent {s.agentName} · {timeAgo(s.createdAt)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">{s.tags?.map((t: string) => <Badge key={t} variant="outline"><Tag className="mr-1 h-3 w-3" />{t}</Badge>)}</div>
                </div>
                <Button onClick={() => genAi.mutate()} disabled={genAi.isPending} variant="gradient">{genAi.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}Generate AI summary</Button>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                <Metric icon={Clock} label="Duration" value={formatDuration(s.durationSeconds)} />
                <Metric icon={Users} label="Participants" value={s.participantCount} />
                <Metric icon={Gauge} label="Quality" value={s.qualityScore ? `${Math.round(s.qualityScore)}/100` : '—'} />
                <Metric icon={Activity} label="Sentiment" value={s.sentiment ?? '—'} />
              </div>
            </>
          )}

          <Tabs defaultValue="ai" className="mt-8">
            <TabsList>
              <TabsTrigger value="ai">AI Summary</TabsTrigger>
              <TabsTrigger value="transcript">Chat</TabsTrigger>
              <TabsTrigger value="recordings">Recordings</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>

            <TabsContent value="ai">
              {ai.isLoading ? <Skeleton className="h-48" /> : !ai.data ? (
                <Card><CardContent className="flex flex-col items-center py-12 text-center"><Sparkles className="mb-3 h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">No AI summary yet. Click &quot;Generate AI summary&quot; above.</p></CardContent></Card>
              ) : <AiSummary data={ai.data} />}
            </TabsContent>

            <TabsContent value="transcript">
              <Card><CardContent className="space-y-3 py-4">
                {messages.data?.length ? messages.data.map((m: any) => (
                  <div key={m.id} className="flex gap-3">
                    <Avatar className="h-7 w-7"><AvatarFallback className="text-[10px]">{initials(m.senderName)}</AvatarFallback></Avatar>
                    <div><p className="text-xs text-muted-foreground">{m.senderName} · {timeAgo(m.createdAt)}</p><p className="text-sm">{m.type === 'FILE' ? `📎 ${m.fileName}` : m.body}</p></div>
                  </div>
                )) : <p className="py-8 text-center text-sm text-muted-foreground">No messages.</p>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="recordings">
              <Card><CardContent className="py-4">
                {recordings.data?.length ? <div className="space-y-2">{recordings.data.map((r: any) => (
                  <div key={r.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary"><Activity className="h-4 w-4" /></div>
                    <div className="flex-1"><p className="text-sm font-medium">Recording · {formatDuration(r.durationSeconds)}</p><p className="text-xs text-muted-foreground">{r.sizeBytes ? formatBytes(r.sizeBytes) : ''} · {timeAgo(r.createdAt)}</p></div>
                    <Badge variant={r.status === 'READY' ? 'success' : r.status === 'PROCESSING' ? 'warning' : r.status === 'FAILED' ? 'destructive' : 'secondary'}>{r.status}</Badge>
                    {r.status === 'READY' && <a href={`${env.apiUrl}/api/recordings/${r.id}/download`} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><Download className="h-4 w-4" />Download</Button></a>}
                  </div>
                ))}</div> : <p className="py-8 text-center text-sm text-muted-foreground">No recordings.</p>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="files">
              <Card><CardContent className="py-4">
                {files.data?.length ? <div className="space-y-2">{files.data.map((f: any) => (
                  <a key={f.id} href={`${env.apiUrl}/api/files/${f.id}/download`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50">
                    <FileText className="h-5 w-5 text-primary" /><div className="flex-1"><p className="text-sm font-medium">{f.fileName}</p><p className="text-xs text-muted-foreground">{f.uploaderName} · {formatBytes(f.sizeBytes)}</p></div><Download className="h-4 w-4 text-muted-foreground" />
                  </a>
                ))}</div> : <p className="py-8 text-center text-sm text-muted-foreground">No files shared.</p>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="timeline">
              <Card><CardContent className="py-4">
                <div className="space-y-3">{events.data?.map((e: any) => (
                  <div key={e.id} className="flex items-center gap-3 text-sm">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <span className="w-32 shrink-0 text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
                    <span className="font-medium">{e.type.replace(/_/g, ' ').toLowerCase()}</span>
                    {e.actorName && <span className="text-muted-foreground">· {e.actorName}</span>}
                  </div>
                ))}</div>
              </CardContent></Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  );
}

function Metric({ icon: Icon, label, value }: any) {
  return <Card><CardContent className="flex items-center gap-3 py-4"><Icon className="h-5 w-5 text-primary" /><div><p className="text-lg font-semibold capitalize">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></CardContent></Card>;
}

function AiSummary({ data }: { data: any }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="md:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" />Summary</CardTitle></CardHeader><CardContent><p className="text-sm leading-relaxed">{data.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant={sentimentVariant[data.sentiment]}>{data.sentiment}</Badge>
          <Badge variant="outline">{data.issueCategory}</Badge>
          <Badge variant="default">Quality {Math.round(data.qualityScore)}/100</Badge>
        </div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Action items</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-sm">{data.actionItems?.map((a: string, i: number) => <li key={i} className="flex gap-2"><span className="text-primary">→</span>{a}</li>)}</ul></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">KB suggestions</CardTitle></CardHeader><CardContent className="space-y-2">{data.kbSuggestions?.length ? data.kbSuggestions.map((k: any, i: number) => <div key={i} className="rounded-lg border p-2"><p className="text-sm font-medium">{k.title}</p><p className="text-xs text-muted-foreground">{k.snippet}</p></div>) : <p className="text-sm text-muted-foreground">None matched.</p>}</CardContent></Card>
      <Card className="md:col-span-2"><CardHeader><CardTitle className="text-base">Support notes</CardTitle></CardHeader><CardContent><pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">{data.supportNotes}</pre></CardContent></Card>
    </div>
  );
}
