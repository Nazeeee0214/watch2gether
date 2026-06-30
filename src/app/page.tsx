'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Users, Plus } from 'lucide-react';

export default function Home() {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const router = useRouter();

  const handleAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'create') {
      if (username.trim()) {
        const newRoomId = Math.random().toString(36).substring(2, 8);
        router.push(`/${newRoomId}?username=${encodeURIComponent(username)}&creator=true`);
      }
    } else {
      if (roomId.trim() && username.trim()) {
        let finalRoomId = roomId.trim();
        // Handle case where user pastes the full invite link
        if (finalRoomId.includes('/') || finalRoomId.startsWith('http')) {
          try {
            // Add protocol if missing to make URL parser work
            const urlString = finalRoomId.startsWith('http') ? finalRoomId : `http://${finalRoomId}`;
            const urlObj = new URL(urlString);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            if (pathParts.length > 0) {
              finalRoomId = pathParts[0];
            }
          } catch {
            // Fallback: split by slash and take the last part
            const parts = finalRoomId.split('/');
            finalRoomId = parts[parts.length - 1] || finalRoomId;
          }
        }
        
        // Strip out any query parameters if pasted directly
        if (finalRoomId.includes('?')) {
          finalRoomId = finalRoomId.split('?')[0];
        }

        router.push(`/${encodeURIComponent(finalRoomId)}?username=${encodeURIComponent(username)}`);
      }
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[128px] mix-blend-screen pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-[128px] mix-blend-screen pointer-events-none" />

      <div className="z-10 w-full max-w-md space-y-8 p-8 bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600 mb-4 shadow-lg shadow-purple-500/20">
            <Play className="w-8 h-8 text-white ml-1" fill="currentColor" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Watch2Gether
          </h1>
          <p className="text-white/50 text-sm">Synchronize your video streams in real-time.</p>
        </div>

        {/* Mode Toggle */}
        <div className="flex p-1 bg-black/40 rounded-xl mt-4">
          <button
            onClick={() => setMode('join')}
            type="button"
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'join' ? 'bg-white/10 text-white shadow-sm' : 'text-white/50 hover:text-white/80'}`}
          >
            <div className="flex items-center justify-center gap-2"><Users size={16}/> Join Room</div>
          </button>
          <button
            onClick={() => setMode('create')}
            type="button"
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${mode === 'create' ? 'bg-white/10 text-white shadow-sm' : 'text-white/50 hover:text-white/80'}`}
          >
            <div className="flex items-center justify-center gap-2"><Plus size={16}/> Create Room</div>
          </button>
        </div>

        <form onSubmit={handleAction} className="space-y-4 mt-8">
          <div className="space-y-1">
            <label className="text-sm font-medium text-white/70 ml-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. CinemaLover"
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all placeholder:text-white/20"
              required
            />
          </div>
          
          {mode === 'join' && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-white/70 ml-1">Room ID</label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="e.g. movie-night-123"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all placeholder:text-white/20"
                required
              />
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 px-4 bg-white text-black font-semibold rounded-xl hover:bg-white/90 active:scale-[0.98] transition-all duration-200 mt-6"
          >
            {mode === 'join' ? 'Join Room' : 'Create Room'}
          </button>
        </form>
      </div>
    </main>
  );
}
