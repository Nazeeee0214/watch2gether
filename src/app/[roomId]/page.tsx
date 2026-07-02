'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { RoomProvider, useRoom } from '@/components/providers/RoomContext';
import { VideoPlayer } from '@/components/video/VideoPlayer';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { Users, Link as LinkIcon, Check, Monitor, Camera, Mic, MicOff, MessageSquare, LogOut, Crown } from 'lucide-react';

// Wrap the main content in RoomProvider
export default function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const unwrappedParams = React.use(params);
  return (
    <RoomProvider>
      <RoomContent roomId={unwrappedParams.roomId} />
    </RoomProvider>
  );
}

function RoomContent({ roomId }: { roomId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [username] = useState(() => searchParams.get('username') || `User-${Math.floor(Math.random() * 1000)}`);
  const isCreatorParam = searchParams.get('creator') === 'true';
  const {
    joinRoom, roomState, isHost, socket,
    isScreenSharing, startScreenShare, stopScreenShare, isCameraShare,
    isMicActive, toggleMic, leaveRoom,
    requestHost, transferHost,
  } = useRoom();

  const [inputUrl, setInputUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'participants' | 'chat'>('participants');

  useEffect(() => {
    if (roomId) joinRoom(roomId, username, isCreatorParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, username, isCreatorParam]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLoadVideo = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputUrl.trim() && socket) {
      socket.emit('video:change_url', { url: inputUrl.trim() });
      setInputUrl('');
    }
  };

  const handleClearVideo = () => {
    if (socket) {
      socket.emit('video:change_url', { url: '' });
      setInputUrl('');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl shadow-xl">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
              Room: {decodeURIComponent(roomId)}
            </h1>
            <div className="flex items-center gap-2 text-sm text-white/50">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Connected as <span className="text-white font-medium">{username}</span>
              {isHost && (
                <span className="px-2 py-0.5 ml-2 text-[10px] uppercase tracking-wider bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-full font-bold">
                  Host
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {isHost && (
              <button
                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-all ${
                  isScreenSharing
                    ? 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
                    : 'bg-purple-600/20 text-purple-400 border-purple-500/30 hover:bg-purple-500/30 hover:text-white'
                }`}
              >
                {isCameraShare ? <Camera size={16} /> : <Monitor size={16} />}
                {isScreenSharing
                  ? 'Stop Sharing'
                  : (typeof window !== 'undefined' && navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices)
                    ? 'Share Screen'
                    : 'Share Camera'
                }
              </button>
            )}

            {/* Open Mic Toggle */}
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-all ${
                isMicActive
                  ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30'
                  : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
              }`}
            >
              {isMicActive ? <Mic size={16} /> : <MicOff size={16} />}
              {isMicActive ? 'Mic On' : 'Open Mic'}
            </button>

            <button
              onClick={handleCopyLink}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-sm font-medium transition-all"
            >
              {copied ? <Check size={16} className="text-green-400" /> : <LinkIcon size={16} />}
              {copied ? 'Copied!' : 'Copy Invite Link'}
            </button>

            {!isHost && (
              <button
                onClick={() => {
                  if (window.confirm('Request to become the host?')) {
                    requestHost();
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 rounded-xl text-sm font-medium transition-all"
              >
                <Crown size={16} />
                Request Host
              </button>
            )}

            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to leave the room?')) {
                  leaveRoom();
                  router.push('/');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 rounded-xl text-sm font-medium transition-all"
            >
              <LogOut size={16} />
              Leave Room
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Video Area */}
          <div className="lg:col-span-3 space-y-6">
            {!roomState.videoUrl && !isScreenSharing ? (
              <div className="w-full max-w-5xl mx-auto rounded-2xl overflow-hidden shadow-2xl bg-black border border-white/10 aspect-video flex flex-col items-center justify-center p-8 text-center">
                <div className="max-w-md w-full space-y-4">
                  <h2 className="text-2xl font-semibold">No Video Selected</h2>
                  <p className="text-white/50">
                    {isHost ? 'Paste a video link below to start watching.' : 'Waiting for the host to select a video...'}
                  </p>
                  {isHost && (
                    <form onSubmit={handleLoadVideo} className="flex flex-col gap-3 mt-4">
                      <input
                        type="text"
                        value={inputUrl}
                        onChange={(e) => setInputUrl(e.target.value)}
                        placeholder="Paste video URL (.mp4, .m3u8, YouTube...)"
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all text-sm placeholder:text-white/30"
                      />
                      <button
                        type="submit"
                        className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-purple-600/20"
                      >
                        Load Video
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ) : (
              <>
                <VideoPlayer url={roomState.videoUrl} />

                {/* Host Controls */}
                {isHost && (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <form onSubmit={handleLoadVideo} className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={inputUrl}
                        onChange={(e) => setInputUrl(e.target.value)}
                        placeholder="Paste new video URL to change"
                        className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all text-sm placeholder:text-white/30"
                      />
                      <button
                        type="submit"
                        className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-purple-600/20 whitespace-nowrap"
                      >
                        Change
                      </button>
                    </form>
                    <button
                      onClick={handleClearVideo}
                      className="px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-medium rounded-xl transition-all whitespace-nowrap"
                    >
                      Clear Video
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sidebar */}
          <div className="bg-white/5 backdrop-blur-md border border-white/10 p-5 rounded-3xl flex flex-col gap-4">
            {/* Tabs */}
            <div className="flex p-1 bg-black/40 rounded-xl">
              <button
                onClick={() => setSidebarTab('participants')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                  sidebarTab === 'participants' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                <Users size={13} />
                People ({roomState.users.length})
              </button>
              <button
                onClick={() => setSidebarTab('chat')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                  sidebarTab === 'chat' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                <MessageSquare size={13} />
                Chat
              </button>
            </div>

            {/* Participants Tab */}
            {sidebarTab === 'participants' && (
              <ul className="space-y-2">
                {roomState.users.map((user) => (
                  <li key={user.userId} className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/5">
                    <div className="flex items-center gap-2 min-w-0">
                      {user.micActive ? (
                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse" title="Mic On" />
                      ) : (
                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-white/10" />
                      )}
                      <span className="text-sm font-medium truncate">{user.username}</span>
                    </div>
                    {user.userId === roomState.hostId ? (
                      <span className="flex-shrink-0 text-xs px-2 py-1 bg-purple-500/10 text-purple-400 rounded-md font-medium ml-2">
                        Host
                      </span>
                    ) : (
                      isHost && (
                        <button
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to transfer the host role to ${user.username}?`)) {
                              transferHost(user.userId);
                            }
                          }}
                          className="flex-shrink-0 text-xs px-2 py-1 bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-400 border border-yellow-500/20 rounded-md font-medium ml-2 transition-all active:scale-95 cursor-pointer"
                          title="Make Host"
                        >
                          Make Host
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Chat Tab */}
            {sidebarTab === 'chat' && <ChatPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
