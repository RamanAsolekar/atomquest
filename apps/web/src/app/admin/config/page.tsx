'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2, BookOpen, Plus, Trash2, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Api } from '@/lib/api';
import { useLiveStream } from '@/hooks/use-live-stream';

/** Runtime configuration + knowledge base — fully dynamic, no redeploy. */
export default function AdminConfigPage() {
  const qc = useQueryClient();
  useLiveStream('config', () => qc.invalidateQueries({ queryKey: ['config'] }));

  return (
    <AppShell>
      <div className="h-screen overflow-y-auto">
        <div className="container max-w-4xl py-8">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Settings2 className="h-6 w-6 text-primary" />Platform Configuration</h1>
          <p className="text-sm text-muted-foreground">Feature flags, limits and the AI knowledge base — edited live, applied instantly across the platform.</p>

          <Tabs defaultValue="config" className="mt-6">
            <TabsList>
              <TabsTrigger value="config">Settings & flags</TabsTrigger>
              <TabsTrigger value="kb">Knowledge base</TabsTrigger>
            </TabsList>
            <TabsContent value="config"><ConfigEditor /></TabsContent>
            <TabsContent value="kb"><KbEditor /></TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  );
}

const LABELS: Record<string, string> = {
  reconnect_grace_ms: 'Reconnect grace window (ms)',
  max_file_size_bytes: 'Max upload size (bytes)',
  max_message_length: 'Max chat message length',
  max_participants: 'Max participants per session',
  invite_default_ttl_seconds: 'Invite default TTL (seconds)',
  ai_assistant_enabled: 'AI session assistant',
  live_transcription_enabled: 'Live transcription (Whisper)',
  recording_enabled: 'Recording',
};

function ConfigEditor() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['config'], queryFn: () => Api.getConfig() });
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: any }) => Api.setConfig(key, value),
    onSuccess: () => { toast.success('Saved — applied live'); qc.invalidateQueries({ queryKey: ['config'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <Skeleton className="h-64" />;
  const flags = Object.entries(data).filter(([, v]) => typeof v === 'boolean');
  const nums = Object.entries(data).filter(([, v]) => typeof v === 'number');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Feature flags</CardTitle><CardDescription>Toggle features without a redeploy.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {flags.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm">{LABELS[key] ?? key}</span>
              <Button size="sm" variant={value ? 'success' : 'outline'} onClick={() => save.mutate({ key, value: !value })}>
                {value ? 'Enabled' : 'Disabled'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Limits & windows</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {nums.map(([key, value]) => <NumberField key={key} label={LABELS[key] ?? key} value={value as number} onSave={(v) => save.mutate({ key, value: v })} />)}
        </CardContent>
      </Card>
    </div>
  );
}

function NumberField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  return (
    <div className="flex items-center gap-3">
      <Label className="flex-1">{label}</Label>
      <Input className="w-40" value={v} onChange={(e) => setV(e.target.value)} type="number" />
      <Button size="icon" variant="outline" onClick={() => onSave(Number(v))} disabled={Number(v) === value}><Save className="h-4 w-4" /></Button>
    </div>
  );
}

function KbEditor() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['kb'], queryFn: () => Api.listKb() });
  const [draft, setDraft] = useState({ title: '', url: '', snippet: '', keywords: '' });

  const create = useMutation({
    mutationFn: () => Api.createKb({ ...draft, keywords: draft.keywords.split(',').map((s) => s.trim()).filter(Boolean) }),
    onSuccess: () => { toast.success('Article added'); setDraft({ title: '', url: '', snippet: '', keywords: '' }); qc.invalidateQueries({ queryKey: ['kb'] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => Api.deleteKb(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb'] }); },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4" />Add KB article</CardTitle><CardDescription>Drives live in-call suggestions and post-call AI matching.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Input placeholder="URL (e.g. /kb/router-reset)" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <Input placeholder="Snippet" value={draft.snippet} onChange={(e) => setDraft({ ...draft, snippet: e.target.value })} />
          <Input placeholder="Keywords (comma-separated)" value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} />
          <Button variant="gradient" disabled={!draft.title || create.isPending} onClick={() => create.mutate()}>{create.isPending && <Loader2 className="animate-spin" />}Add article</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4" />Knowledge base ({data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? <Skeleton className="h-24" /> : (data ?? []).map((a: any) => (
            <div key={a.id} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.snippet}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">{(a.keywords ?? []).map((k: string) => <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>)}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove.mutate(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
