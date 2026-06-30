/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface User {
  userId: string;
  username: string;
  socketId: string;
}

interface RoomState {
  users: User[];
  hostId: string | null;
  videoUrl: string;
  isScreenSharing: boolean;
}

interface RoomContextType {
  socket: Socket | null;
  roomState: RoomState;
  userId: string;
  username: string;
  roomId: string | null;
  joinRoom: (roomId: string, username: string, isCreator?: boolean) => void;
  isHost: boolean;
  isScreenSharing: boolean;
  screenShareStream: MediaStream | null;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
}

const RoomContext = createContext<RoomContextType | undefined>(undefined);

export const RoomProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomState, setRoomState] = useState<RoomState>({ users: [], hostId: null, videoUrl: '', isScreenSharing: false });
  const [userId] = useState(() => Math.random().toString(36).substring(2, 15));
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomInfo, setRoomInfo] = useState<{ id: string, name: string, creator: boolean } | null>(null);

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);
  const peerConnections = useRef<{ [socketId: string]: RTCPeerConnection }>({});
  const pendingCandidates = useRef<{ [socketId: string]: any[] }>({});

  const isHost = roomState.hostId === userId;

  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_SERVER_URL || 
      (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3001` : 'http://localhost:3001');
    const newSocket = io(socketUrl);

    newSocket.on('connect', () => {
      setSocket(newSocket);
    });

    newSocket.on('room:state', (state: RoomState) => {
      setRoomState(state);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const joinRoom = (newRoomId: string, name: string, isCreator?: boolean) => {
    setUsername(name);
    setRoomId(newRoomId);
    setRoomInfo({ id: newRoomId, name, creator: !!isCreator });
  };

  useEffect(() => {
    if (socket && roomInfo) {
      socket.emit('room:join', { 
        roomId: roomInfo.id, 
        userId, 
        username: roomInfo.name, 
        isCreator: roomInfo.creator 
      });
    }
  }, [socket, roomInfo, userId]);

  const processPendingCandidates = async (socketId: string, pc: RTCPeerConnection) => {
    const candidates = pendingCandidates.current[socketId] || [];
    if (candidates.length > 0) {
      console.log(`[WebRTC] Processing ${candidates.length} queued ICE candidates for:`, socketId);
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("[WebRTC] Error adding queued ICE candidate:", e);
        }
      }
      pendingCandidates.current[socketId] = [];
    }
  };

  const createPeerConnection = async (targetSocketId: string, stream: MediaStream) => {
    try {
      console.log("[WebRTC] Creating peer connection for guest socket ID:", targetSocketId);
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      peerConnections.current[targetSocketId] = pc;

      // Add tracks from screenshare stream
      stream.getTracks().forEach(track => {
        console.log("[WebRTC] Adding local track to connection:", track.kind);
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          console.log("[WebRTC] Host generated ICE candidate for:", targetSocketId);
          socket.emit('webrtc:signal', {
            targetSocketId,
            signal: { candidate: event.candidate }
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection state with guest ${targetSocketId}: ${pc.connectionState}`);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (socket) {
        console.log("[WebRTC] Host sending SDP offer to:", targetSocketId);
        socket.emit('webrtc:signal', {
          targetSocketId,
          signal: offer
        });
      }
    } catch (e) {
      console.error("[WebRTC] Error creating peer connection:", e);
    }
  };

  const startScreenShare = async () => {
    try {
      console.log("[WebRTC] Requesting screen sharing display media...");
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as any,
        audio: true
      });

      setScreenShareStream(stream);
      setIsScreenSharing(true);

      if (socket) {
        socket.emit('video:toggle_screenshare', { active: true });

        // Connect WebRTC to all other users in the room
        const currentGuests = roomState.users.filter(u => u.userId !== userId);
        console.log(`[WebRTC] Initiating mesh connections to ${currentGuests.length} guests`);
        for (const guest of currentGuests) {
          await createPeerConnection(guest.socketId, stream);
        }
      }

      // Handle when screen sharing is stopped using the native browser sharing bar
      stream.getVideoTracks()[0].onended = () => {
        console.log("[WebRTC] Screen sharing ended via browser controls");
        stopScreenShare();
      };
    } catch (err) {
      console.error("[WebRTC] Error starting screen share:", err);
    }
  };

  const stopScreenShare = () => {
    console.log("[WebRTC] Stopping screen share...");
    setIsScreenSharing(false);

    if (screenShareStream) {
      screenShareStream.getTracks().forEach(track => track.stop());
      setScreenShareStream(null);
    }

    Object.keys(peerConnections.current).forEach(socketId => {
      peerConnections.current[socketId].close();
    });
    peerConnections.current = {};
    pendingCandidates.current = {};

    if (socket) {
      socket.emit('video:toggle_screenshare', { active: false });
    }
  };

  // Connect WebRTC to new users joining mid-screen-share
  useEffect(() => {
    if (!isHost || !isScreenSharing || !screenShareStream || !socket) return;

    const currentGuests = roomState.users.filter(u => u.userId !== userId);
    for (const guest of currentGuests) {
      if (!peerConnections.current[guest.socketId]) {
        console.log("[WebRTC] New user joined mid-stream, connecting:", guest.socketId);
        createPeerConnection(guest.socketId, screenShareStream);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState.users, isHost, isScreenSharing, screenShareStream, socket]);

  // Handle incoming signaling messages (offers, answers, ICE candidates)
  useEffect(() => {
    if (!socket) return;

    const handleSignal = async (data: { senderSocketId: string; signal: any }) => {
      const { senderSocketId, signal } = data;

      if (signal.type === 'offer') {
        try {
          console.log("[WebRTC] Guest received SDP offer from:", senderSocketId);
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          });

          peerConnections.current[senderSocketId] = pc;

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              console.log("[WebRTC] Guest generated ICE candidate for:", senderSocketId);
              socket.emit('webrtc:signal', {
                targetSocketId: senderSocketId,
                signal: { candidate: event.candidate }
              });
            }
          };

          pc.ontrack = (event) => {
            console.log("[WebRTC] Guest received remote track:", event.track.kind);
            if (event.streams && event.streams[0]) {
              // Recreate the MediaStream instance to force React to update the state and bind the audio track
              setScreenShareStream(new MediaStream(event.streams[0].getTracks()));
            } else {
              setScreenShareStream((prevStream) => {
                const stream = prevStream ? new MediaStream(prevStream.getTracks()) : new MediaStream();
                stream.addTrack(event.track);
                return stream;
              });
            }
          };

          pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection state with host ${senderSocketId}: ${pc.connectionState}`);
          };

          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          console.log("[WebRTC] Guest sending SDP answer to:", senderSocketId);
          socket.emit('webrtc:signal', {
            targetSocketId: senderSocketId,
            signal: answer
          });

          // Process any ICE candidates that were queued
          await processPendingCandidates(senderSocketId, pc);
        } catch (e) {
          console.error("[WebRTC] Error handling offer:", e);
        }
      } else if (signal.type === 'answer') {
        const pc = peerConnections.current[senderSocketId];
        if (pc) {
          try {
            console.log("[WebRTC] Host received SDP answer from:", senderSocketId);
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            // Process any ICE candidates that were queued
            await processPendingCandidates(senderSocketId, pc);
          } catch (e) {
            console.error("[WebRTC] Error handling answer:", e);
          }
        }
      } else if (signal.candidate) {
        const pc = peerConnections.current[senderSocketId];
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (e) {
            console.error("[WebRTC] Error adding ICE candidate:", e);
          }
        } else {
          // Queue candidate if remote description isn't set yet
          if (!pendingCandidates.current[senderSocketId]) {
            pendingCandidates.current[senderSocketId] = [];
          }
          pendingCandidates.current[senderSocketId].push(signal.candidate);
        }
      }
    };

    socket.on('webrtc:signal', handleSignal);

    return () => {
      socket.off('webrtc:signal', handleSignal);
    };
  }, [socket]);

  // Synchronize screen share state with roomState for guests inside useEffect to satisfy React 19 ref rules
  useEffect(() => {
    if (isHost) return;

    if (roomState.isScreenSharing && !isScreenSharing) {
      console.log("[WebRTC] Syncing screen share state to active based on room state");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsScreenSharing(true);
    } else if (!roomState.isScreenSharing && isScreenSharing) {
      console.log("[WebRTC] Syncing screen share state to inactive based on room state");
      setIsScreenSharing(false);
      // Clean up guest side media stream and peer connections safely
      if (screenShareStream) {
        screenShareStream.getTracks().forEach(track => track.stop());
      }
      setScreenShareStream(null);
      Object.keys(peerConnections.current).forEach(socketId => {
        peerConnections.current[socketId].close();
      });
      peerConnections.current = {};
      pendingCandidates.current = {};
    }
  }, [roomState.isScreenSharing, isHost, isScreenSharing, screenShareStream]);

  return (
    <RoomContext.Provider value={{ 
      socket, 
      roomState, 
      userId, 
      username, 
      roomId, 
      joinRoom, 
      isHost,
      isScreenSharing,
      screenShareStream,
      startScreenShare,
      stopScreenShare
    }}>
      {children}
    </RoomContext.Provider>
  );
};

export const useRoom = () => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoom must be used within a RoomProvider');
  }
  return context;
};
