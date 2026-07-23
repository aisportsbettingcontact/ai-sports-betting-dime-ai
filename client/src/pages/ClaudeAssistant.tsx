import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Bot, Send, Trash2, Copy, Check, Loader2, Sparkles, ChevronDown, Code2, Layout, Palette, Smartphone, BarChart2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReactMarkdown from "react-markdown";
import { AdminShell } from "@/pages/admin/AdminShell";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  tokens?: { input: number; output: number };
}

type FocusArea = "general" | "layout" | "typography" | "color" | "mobile" | "data-density" | "spacing";

const FOCUS_AREAS: { value: FocusArea; label: string; icon: React.ElementType }[] = [
  { value: "general",      label: "General",       icon: Sparkles },
  { value: "layout",       label: "Layout",        icon: Layout },
  { value: "data-density", label: "Data Density",  icon: BarChart2 },
  { value: "mobile",       label: "Mobile",        icon: Smartphone },
  { value: "color",        label: "Color",         icon: Palette },
  { value: "typography",   label: "Typography",    icon: Code2 },
  { value: "spacing",      label: "Spacing",       icon: Zap },
];

const QUICK_PROMPTS = [
  "Analyze the game card layout and suggest improvements for data density on mobile",
  "Review the WC2026 page and suggest ways to improve the odds display",
  "How can I improve the color hierarchy and visual weight of the feed?",
  "Suggest improvements to the betting splits visualization",
  "What changes would make the dashboard more scannable at a glance?",
  "Review the header navigation and suggest a cleaner structure",
];

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none
      prose-headings:text-white prose-headings:font-bold
      prose-p:text-white prose-p:leading-relaxed
      prose-code:text-[#45E0A8] prose-code:bg-[#000000] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono
      prose-pre:bg-[#000000] prose-pre:border prose-pre:border-[#45E0A8] prose-pre:rounded-lg
      prose-strong:text-white prose-ul:text-white prose-ol:text-white prose-li:text-white
      prose-blockquote:border-l-[#45E0A8] prose-blockquote:text-white
      prose-a:text-[#45E0A8] prose-a:no-underline hover:prose-a:underline">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} group`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
        ${isUser ? "bg-transparent text-[#45E0A8] border border-[#45E0A8]" : "bg-[#000000] text-[#45E0A8] border border-[#45E0A8]"}`}>
        {isUser ? "PB" : <Bot size={14} />}
      </div>
      <div className={`flex-1 max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div className={`rounded-xl px-4 py-3 ${isUser ? "bg-transparent border border-[#45E0A8] text-white ml-auto" : "bg-[#000000] border border-white text-white"}`}>
          {isUser ? <p className="text-sm whitespace-pre-wrap">{message.content}</p> : <MarkdownContent content={message.content} />}
        </div>
        <div className={`flex items-center gap-2 px-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
          <span className="text-[10px] text-white">{message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {message.tokens && <span className="text-[10px] text-white">{message.tokens.input + message.tokens.output} tokens</span>}
          <button onClick={handleCopy} className="opacity-0 group-hover:opacity-100 transition-opacity text-white hover:text-white">
            {copied ? <Check size={11} className="text-[#45E0A8]" /> : <Copy size={11} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClaudeAssistant() {
  const { appUser, isOwner, loading } = useAppAuth();
  const [, setLocation] = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [currentPage, setCurrentPage] = useState("/feed/model/mlb");
  const [focusArea, setFocusArea] = useState<FocusArea>("general");
  const [showQuickPrompts, setShowQuickPrompts] = useState(true);
  const [totalTokens, setTotalTokens] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!loading && (!appUser || !isOwner)) setLocation("/feed/model/mlb"); }, [loading, appUser, isOwner, setLocation]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const chatMutation = trpc.claude.chat.useMutation({ onError: (err) => toast.error(`Claude error: ${err.message}`) });

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || chatMutation.isPending) return;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: trimmed, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setShowQuickPrompts(false);
    const history = [...messages, userMsg].slice(-20).map((m) => ({ role: m.role, content: m.content }));
    try {
      const result = await chatMutation.mutateAsync({ messages: history, context: { currentPage, additionalContext: `Focus area: ${focusArea}` } });
      const assistantMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: result.content, timestamp: new Date(), tokens: { input: result.inputTokens, output: result.outputTokens } };
      setMessages((prev) => [...prev, assistantMsg]);
      setTotalTokens((prev) => prev + result.inputTokens + result.outputTokens);
    } catch { /* handled by onError */ }
  }, [input, messages, chatMutation, currentPage, focusArea]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }, [handleSend]);
  const handleClearChat = useCallback(() => { setMessages([]); setTotalTokens(0); setShowQuickPrompts(true); }, []);
  const handleQuickPrompt = useCallback((prompt: string) => { setInput(prompt); textareaRef.current?.focus(); }, []);

  if (loading) return <div className="flex items-center justify-center h-screen bg-[#000000]"><Loader2 className="animate-spin text-[#45E0A8]" size={32} /></div>;
  if (!appUser || !isOwner) return null;

  return (
    <AdminShell active="claude">
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-[#000000] font-['Familjen_Grotesk',sans-serif]">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white bg-[#000000] px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-transparent border border-[#45E0A8] flex items-center justify-center">
              <Bot size={16} className="text-[#45E0A8]" />
            </div>
            <div>
              <h1 className="text-white font-bold text-base leading-none">CLAUDE UI/UX ASSISTANT</h1>
              <p className="text-white text-xs mt-0.5">Powered by Claude Fable 5 · Owner Only</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalTokens > 0 && <Badge variant="outline" className="text-xs text-white border-white">{totalTokens.toLocaleString()} tokens used</Badge>}
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearChat} className="text-white hover:text-white hover:bg-transparent text-xs">
                <Trash2 size={13} className="mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Context bar */}
      <div className="flex-shrink-0 border-b border-white bg-[#000000] px-4 py-2">
        <div className="max-w-4xl mx-auto flex items-center gap-3 flex-wrap">
          <span className="text-white text-xs uppercase tracking-wider">Context:</span>
          <Select value={currentPage} onValueChange={setCurrentPage}>
            <SelectTrigger className="h-7 text-xs bg-[#000000] border-white text-white w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#000000] border-white text-white text-xs">
              <SelectItem value="/feed/model/mlb">Feed (Model Projections)</SelectItem>
              <SelectItem value="/betting-splits/MLB">Betting Splits</SelectItem>
              <SelectItem value="/wc2026">WC2026</SelectItem>
              <SelectItem value="/bet-tracker">Bet Tracker</SelectItem>
              <SelectItem value="/resources">Resources</SelectItem>
              <SelectItem value="/admin/publish">Admin: Publish</SelectItem>
              <SelectItem value="/admin/users">Admin: Users</SelectItem>
              <SelectItem value="/account">Account</SelectItem>
              <SelectItem value="general">General / Platform-wide</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 flex-wrap">
            {FOCUS_AREAS.map(({ value, label, icon: Icon }) => (
              <button key={value} onClick={() => setFocusArea(value)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all
                  ${focusArea === value ? "bg-transparent text-[#45E0A8] border border-[#45E0A8]" : "text-white hover:text-white border border-transparent hover:border-white"}`}>
                <Icon size={10} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {showQuickPrompts && messages.length === 0 && (
            <div className="space-y-4">
              <div className="text-center py-6">
                <div className="w-16 h-16 rounded-2xl bg-transparent border border-[#45E0A8] flex items-center justify-center mx-auto mb-4">
                  <Sparkles size={28} className="text-[#45E0A8]" />
                </div>
                <h2 className="text-white font-bold text-lg mb-1">UI/UX Design Assistant</h2>
                <p className="text-white text-sm max-w-md mx-auto">
                  Ask Claude to analyze any part of the platform, suggest improvements, or generate specific code changes. Select a page and focus area above to add context.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-white text-xs uppercase tracking-wider mb-2 cursor-pointer hover:text-white" onClick={() => setShowQuickPrompts((v) => !v)}>
                  <ChevronDown size={12} /> Quick Prompts
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button key={prompt} onClick={() => handleQuickPrompt(prompt)}
                      className="text-left px-3 py-2.5 rounded-lg bg-[#000000] border border-white text-white text-xs hover:border-[#45E0A8] hover:text-white hover:bg-transparent transition-all">
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
          {chatMutation.isPending && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#000000] border border-[#45E0A8] flex items-center justify-center">
                <Bot size={14} className="text-[#45E0A8]" />
              </div>
              <div className="bg-[#000000] border border-white rounded-xl px-4 py-3 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-[#45E0A8]" />
                <span className="text-white text-sm">Claude is thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-white bg-[#000000] px-4 py-3">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Claude to analyze or improve any part of the platform... (Enter to send, Shift+Enter for newline)"
              className="flex-1 min-h-[60px] max-h-[200px] resize-none bg-[#000000] border-white text-white placeholder-white text-sm focus:border-[#45E0A8] focus:ring-0 rounded-xl"
              disabled={chatMutation.isPending}
            />
            <Button onClick={handleSend} disabled={!input.trim() || chatMutation.isPending}
              className="h-[60px] w-[60px] bg-[#45E0A8] hover:bg-[#45E0A8] text-black rounded-xl flex-shrink-0 disabled:opacity-30">
              {chatMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </Button>
          </div>
          <p className="text-[10px] text-white mt-1.5 text-center">
            Claude has full context of the platform's design system, components, and tech stack.
          </p>
        </div>
      </div>
    </div>
    </AdminShell>
  );
}
