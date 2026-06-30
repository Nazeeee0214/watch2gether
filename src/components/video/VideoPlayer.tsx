/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useRef, useState, useEffect } from 'react';
import ReactPlayer from 'react-player';
const Player = ReactPlayer as any;

import { useRoom } from '@/components/providers/RoomContext';
import { ResolveVideoSource } from '@/lib/utils';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize2, AlertTriangle } from 'lucide-react';

interface VideoPlayerProps {
  url: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url }) => {
  const { socket, isHost, roomId, isScreenSharing, screenShareStream, stopScreenShare } = useRoom();
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(0);
  const [muted, setMuted] = useState(true); // Auto-play policies often require muted
  const [volume, setVolume] = useState(0.8); // Default volume level (80%)
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, []);

  const triggerShowControls = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3500);
  };

  const isSyncing = useRef(false);

  // Adjust state during render when the URL changes to prevent play() request interruptions on unmounted elements
  const [prevUrl, setPrevUrl] = useState(url);
  if (url !== prevUrl) {
    setPrevUrl(url);
    setPlaying(false);
    setPlayed(0);
    setDuration(0);
    setError(null);
  }

  const [prevScreenSharing, setPrevScreenSharing] = useState(isScreenSharing);
  if (isScreenSharing !== prevScreenSharing) {
    setPrevScreenSharing(isScreenSharing);
    if (isScreenSharing) {
      setPlaying(true);
    }
  }

  const resolvedSource = ResolveVideoSource(url);

  // Heartbeat Logic for Host
  useEffect(() => {
    if (!isHost || !socket || !roomId) return;

    const interval = setInterval(() => {
      if (playerRef.current) {
        const currentTime = playerRef.current.currentTime;
        socket.emit('video:heartbeat', { currentTime, clientTimestamp: Date.now() });
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isHost, socket, roomId]);

  // Socket Listeners
  useEffect(() => {
    if (!socket) return;

    const handleStateChange = (data: { action: string; currentTime: number }) => {
      isSyncing.current = true;
      if (data.action === 'PLAY') {
        setPlaying(true);
        if (playerRef.current && Math.abs(playerRef.current.currentTime - data.currentTime) > 1) {
          playerRef.current.currentTime = data.currentTime;
        }
      } else if (data.action === 'PAUSE') {
        setPlaying(false);
        if (playerRef.current) {
          playerRef.current.currentTime = data.currentTime;
        }
      } else if (data.action === 'SEEK') {
        if (playerRef.current) {
          playerRef.current.currentTime = data.currentTime;
        }
      }
      
      // Allow the player to process before releasing sync lock
      setTimeout(() => {
        isSyncing.current = false;
      }, 100);
    };

    const handleHeartbeat = (data: { currentTime: number }) => {
      if (isHost) return; // Host doesn't need to sync to its own heartbeat
      if (playerRef.current) {
        const localTime = playerRef.current.currentTime;
        if (Math.abs(data.currentTime - localTime) > 2.0) {
          isSyncing.current = true;
          playerRef.current.currentTime = data.currentTime;
          setTimeout(() => {
            isSyncing.current = false;
          }, 100);
        }
      }
    };

    socket.on('video:state_change', handleStateChange);
    socket.on('video:heartbeat', handleHeartbeat);

    return () => {
      socket.off('video:state_change', handleStateChange);
      socket.off('video:heartbeat', handleHeartbeat);
    };
  }, [socket, isHost]);

  const handlePlay = () => {
    if (isSyncing.current) return;
    setPlaying(true);
    socket?.emit('video:state_change', {
      action: 'PLAY',
      currentTime: playerRef.current?.currentTime || 0,
    });
  };

  const handlePause = () => {
    if (isSyncing.current) return;
    setPlaying(false);
    socket?.emit('video:state_change', {
      action: 'PAUSE',
      currentTime: playerRef.current?.currentTime || 0,
    });
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setPlayed(time);
    if (playerRef.current) {
      playerRef.current.currentTime = time;
    }
    
    if (isSyncing.current) return;
    socket?.emit('video:state_change', {
      action: 'SEEK',
      currentTime: time,
    });
  };

  const toggleFullScreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  };

  const formatTime = (seconds: number) => {
    const date = new Date(seconds * 1000);
    const hh = date.getUTCHours();
    const mm = date.getUTCMinutes();
    const ss = date.getUTCSeconds().toString().padStart(2, '0');
    if (hh) {
      return `${hh}:${mm.toString().padStart(2, '0')}:${ss}`;
    }
    return `${mm}:${ss}`;
  };

  return (
    <div 
      ref={containerRef} 
      onMouseMove={triggerShowControls}
      onClick={triggerShowControls}
      className="relative group w-full max-w-5xl mx-auto rounded-2xl overflow-hidden shadow-2xl bg-black border border-white/10"
    >
      <div className="aspect-video w-full relative">
        {isScreenSharing && screenShareStream ? (
          <video
            ref={(videoNode) => {
              if (videoNode) {
                if (videoNode.srcObject !== screenShareStream) {
                  videoNode.srcObject = screenShareStream;
                }
                // Explicitly set the DOM property directly to bypass React's muted attribute update bug
                videoNode.muted = isHost || muted;
                videoNode.volume = volume;
                
                // Allow participants to control the screen share feed play/pause locally
                if (playing) {
                  videoNode.play().catch(() => {});
                } else {
                  videoNode.pause();
                }
              }
            }}
            playsInline
            className="w-full h-full object-contain"
          />
        ) : mounted && (
          <Player
            ref={playerRef}
            src={resolvedSource.finalUrl || null}
            width="100%"
            height="100%"
            playing={playing}
            muted={muted}
            volume={volume}
            onPlay={handlePlay}
            onPause={handlePause}
            onDurationChange={() => {
              if (playerRef.current) {
                setDuration(playerRef.current.duration);
              }
            }}
            onTimeUpdate={() => {
              if (playerRef.current && !isSyncing.current) {
                setPlayed(playerRef.current.currentTime);
              }
            }}
            onError={() => {
              setError("This video source is not supported, or access was blocked by the CDN. Ensure your CORS Proxy is active and the URL is correct.");
            }}
            controls={false} // Disable native controls to use custom sync controls
          />
        )}

        {/* Error Overlay */}
        {error && !isScreenSharing && (
          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center z-20">
            <div className="max-w-md space-y-4">
              <div className="inline-flex p-3 bg-red-500/10 text-red-500 rounded-full border border-red-500/20">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-semibold text-white">Playback Error</h3>
              <p className="text-white/60 text-sm leading-relaxed">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Custom Controls Overlay */}
      <div className={`absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 md:group-hover:opacity-100'}`}>
        {isScreenSharing ? (
          <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs text-white/90 font-semibold uppercase tracking-wider">Live Screen Share</span>
              {isHost && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    stopScreenShare();
                  }}
                  className="px-3 py-1 ml-2 bg-red-600 hover:bg-red-500 active:scale-95 text-[10px] font-semibold rounded-lg text-white uppercase transition"
                >
                  Stop Sharing
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isHost && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlaying(!playing);
                    }}
                    className="text-white hover:text-white/80 transition p-2 hover:bg-white/10 rounded-full"
                  >
                    {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMuted(!muted);
                      }}
                      className="text-white hover:text-white/80 transition p-2 hover:bg-white/10 rounded-full"
                    >
                      {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={muted ? 0 : volume}
                      onChange={(e) => {
                        e.stopPropagation();
                        const val = parseFloat(e.target.value);
                        setVolume(val);
                        if (val > 0) {
                          setMuted(false);
                        }
                      }}
                      className="w-16 h-1 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                    />
                  </div>
                </>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullScreen();
                }}
                className="text-white hover:text-white/80 transition p-2 hover:bg-white/10 rounded-full"
              >
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize size={20} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
            {/* Progress Bar */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/80 font-medium font-mono font-semibold">
                {formatTime(played)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step="any"
                value={played}
                onChange={handleSeek}
                className="flex-1 h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:w-4 hover:[&::-webkit-slider-thumb]:h-4 transition-all"
              />
              <span className="text-xs text-white/80 font-medium font-mono font-semibold">
                {formatTime(duration)}
              </span>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => playing ? handlePause() : handlePlay()}
                  className="text-white hover:text-white/80 transition p-2 hover:bg-white/10 rounded-full"
                >
                  {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                </button>
                
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setMuted(!muted)}
                    className="text-white hover:text-white/80 transition p-2 hover:bg-white/10 rounded-full"
                  >
                    {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setVolume(val);
                      if (val > 0) {
                        setMuted(false);
                      }
                    }}
                    className="w-16 h-1 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={toggleFullScreen}
                  className="text-white hover:text-white/80 transition p-2 hover:bg-white/10 rounded-full"
                >
                  {isFullscreen ? <Minimize2 size={20} /> : <Maximize size={20} />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
