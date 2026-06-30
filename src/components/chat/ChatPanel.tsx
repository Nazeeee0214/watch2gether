'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRoom, ChatMessage } from '@/components/providers/RoomContext';
import { Send } from 'lucide-react';

export const ChatPanel: React.FC = () => {
  const { messages, sendChatMessage, userId } = useRoom();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendChatMessage(input.trim());
    setInput('');
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-80 lg:h-96">
      {/* Message List */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-white/30 text-xs text-center">No messages yet.<br />Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg: ChatMessage, i) => {
            const isOwn = msg.userId === userId;
            return (
              <div key={i} className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-baseline gap-1.5 mb-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                  <span className="text-[10px] font-semibold text-white/60">{isOwn ? 'You' : msg.username}</span>
                  <span className="text-[9px] text-white/30">{formatTime(msg.timestamp)}</span>
                </div>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm break-words leading-relaxed ${
                    isOwn
                      ? 'bg-purple-600/70 text-white rounded-tr-sm'
                      : 'bg-white/10 text-white/90 rounded-tl-sm'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-2 mt-3 pt-3 border-t border-white/10">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send a message..."
          maxLength={500}
          className="flex-1 px-3 py-2 bg-black/50 border border-white/10 rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="p-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl transition-all active:scale-95"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
};
