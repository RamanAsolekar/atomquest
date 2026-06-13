'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Paperclip, FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn, formatBytes, initials } from '@/lib/utils';
import { env } from '@/lib/config';
import type { ChatMessage } from '@/hooks/use-call-room';

interface Props {
  messages: ChatMessage[];
  myName: string;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
}

export function ChatPanel({ messages, myName, onSend, onUpload }: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <p className="mt-8 text-center text-sm text-muted-foreground">No messages yet. Say hello 👋</p>}
        {messages.map((m) => {
          const mine = m.senderName === myName;
          if (m.type === 'SYSTEM') return <p key={m.id} className="text-center text-xs text-muted-foreground">{m.body}</p>;
          return (
            <div key={m.id} className={cn('flex gap-2', mine && 'flex-row-reverse')}>
              {!mine && <Avatar className="h-7 w-7 shrink-0"><AvatarFallback className="text-[10px]">{initials(m.senderName)}</AvatarFallback></Avatar>}
              <div className={cn('max-w-[78%]')}>
                {!mine && <p className="mb-0.5 text-xs text-muted-foreground">{m.senderName}</p>}
                {m.type === 'FILE' ? (
                  <a href={`${env.apiUrl}${m.fileUrl}`} target="_blank" rel="noreferrer" className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors hover:bg-accent', mine ? 'bg-primary/10' : 'bg-card')}>
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0"><p className="truncate text-xs font-medium">{m.fileName ?? m.body}</p><p className="text-[10px] text-muted-foreground">{formatBytes(m.fileSize)}</p></div>
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                ) : (
                  <div className={cn('rounded-xl px-3 py-2 text-sm', mine ? 'bg-brand-gradient text-white' : 'bg-secondary')}>{m.body}</div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t p-3">
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
        <Button type="button" size="icon" variant="ghost" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" className="flex-1" />
        <Button type="submit" size="icon" variant="gradient" disabled={!text.trim()}><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
