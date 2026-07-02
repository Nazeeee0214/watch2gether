/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface User {
  userId: string;
  username: string;
  socketId: string;
  micActive?: boolean;
}

export interface ChatMessage {
  userId: string;
  username: string;
  text: string;
  timestamp: number;
}

interface RoomState {
  users: User[];
  hostId: string | null;
  videoUrl: string;
  isScreenSharing: boolean;
  sharingUserId: string | null;
}

interface RoomContextType {
  socket: Socket | null;
  roomState: RoomState;
  userId: string;
  username: string;
  roomId: string | null;
  joinRoom: (roomId: string, username: string, isCreator?: boolean) => void;
  leaveRoom: () => void;
  isHost: boolean;
  isSharer: boolean;
  isScreenSharing: boolean;
  screenShareStream: MediaStream | null;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  isCameraShare: boolean;
  // Chat
  messages: ChatMessage[];
  sendChatMessage: (text: string) => void;
  // Open Mic
  isMicActive: boolean;
  toggleMic: () => Promise<void>;
  // Host management
  transferHost: (targetUserId: string) => void;
  requestHost: () => void;
}

const optimizeSenders = async (pc: RTCPeerConnection) => {
  try {
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (!sender || !sender.track) continue;
      const parameters = sender.getParameters();
      if (!parameters) continue;
      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }
      let changed = false;
      if (sender.track.kind === 'video') {
        parameters.encodings[0].maxBitrate = 1200000; // 1.2 Mbps
        parameters.encodings[0].maxFramerate = 30;
        changed = true;
        console.log('[WebRTC] Web video sender optimized: 1.2 Mbps max, 30fps max');
      } else if (sender.track.kind === 'audio') {
        parameters.encodings[0].maxBitrate = 48000; // 48 kbps
        changed = true;
        console.log('[WebRTC] Web audio sender optimized: 48 kbps max');
      }
      if (changed) {
        await sender.setParameters(parameters).catch(e => console.warn('[WebRTC] Error calling setParameters:', e));
      }
    }
  } catch (e) {
    console.warn('[WebRTC] Failed to optimize senders:', e);
  }
};

const RoomContext = createContext<RoomContextType | undefined>(undefined);

export const RoomProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomState, setRoomState] = useState<RoomState>({
    users: [], hostId: null, videoUrl: '', isScreenSharing: false, sharingUserId: null
  });
  const [userId] = useState(() => Math.random().toString(36).substring(2, 15));
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomInfo, setRoomInfo] = useState<{ id: string; name: string; creator: boolean } | null>(null);

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);
  const [isCameraShare, setIsCameraShare] = useState(false);
  const peerConnections = useRef<{ [socketId: string]: RTCPeerConnection }>({});
  const pendingCandidates = useRef<{ [socketId: string]: any[] }>({});

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Open Mic state
  const [isMicActive, setIsMicActive] = useState(false);
  const micStream = useRef<MediaStream | null>(null);
  const outgoingMicConnections = useRef<{ [socketId: string]: RTCPeerConnection }>({});
  const incomingMicConnections = useRef<{ [socketId: string]: RTCPeerConnection }>({});
  const outgoingMicPendingCandidates = useRef<{ [socketId: string]: any[] }>({});
  const incomingMicPendingCandidates = useRef<{ [socketId: string]: any[] }>({});

  const socketRef = useRef<Socket | null>(null);
  const screenShareStreamRef = useRef<MediaStream | null>(null);

  const isHost = roomState.hostId === userId;
  const isSharer = roomState.sharingUserId === userId;

  // Keep screenShareStreamRef in sync with screenShareStream state for safe unmount cleanup
  useEffect(() => {
    screenShareStreamRef.current = screenShareStream;
  }, [screenShareStream]);

  // Clean up all streams and peer connections on component unmount
  useEffect(() => {
    return () => {
      console.log('[RoomContext] Unmounting, cleaning up all media streams and connections...');
      if (screenShareStreamRef.current) {
        screenShareStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (micStream.current) {
        micStream.current.getTracks().forEach(t => t.stop());
        micStream.current = null;
      }
      Object.values(peerConnections.current).forEach(pc => {
        try { pc.close(); } catch (e) {}
      });
      Object.values(outgoingMicConnections.current).forEach(pc => {
        try { pc.close(); } catch (e) {}
      });
      Object.values(incomingMicConnections.current).forEach(pc => {
        try { pc.close(); } catch (e) {}
      });
      if (typeof document !== 'undefined') {
        document.querySelectorAll('[id^="mic-audio-"]').forEach(el => el.remove());
      }
    };
  }, []);

  useEffect(() => {
    if (!roomInfo) return;

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_SERVER_URL || 
      (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3001` : 'http://localhost:3001');
    console.log(`[Socket] Connecting to server: ${socketUrl}`);
    const newSocket = io(socketUrl, {
      transports: ['websocket'],
      forceNew: true
    });

    newSocket.on('connect', () => {
      console.log('[Socket] Connected with ID:', newSocket.id);
      setSocket(newSocket);
      socketRef.current = newSocket;

      newSocket.emit('room:join', {
        roomId: roomInfo.id,
        userId,
        username: roomInfo.name,
        isCreator: roomInfo.creator
      });
    });

    newSocket.on('connect_error', (err) => {
      console.error('[Socket] Connection Error:', err.message);
    });

    newSocket.on('room:state', (state: RoomState) => {
      setRoomState(state);
    });

    newSocket.on('chat:message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });

    newSocket.on('error', (err: { message: string }) => {
      console.error('[Socket] Server error:', err.message);
    });

    // Host transfer: host receives a request from a participant
    newSocket.on('room:host_requested', (data: { fromUserId: string; fromUsername: string }) => {
      const approved = window.confirm(
        `🎤 Host Request\n${data.fromUsername} is requesting to become the host. Approve?`
      );
      if (approved && socketRef.current) {
        socketRef.current.emit('room:transfer_host', { newHostUserId: data.fromUserId });
      }
    });

    // WebRTC Screenshare Relay signaling (Guests rendering screen share)
    newSocket.on('webrtc:signal', async (data: { senderSocketId: string; signal: any }) => {
      const { senderSocketId, signal } = data;

      if (signal.type === 'offer') {
        try {
          console.log('[WebRTC] Guest received SDP offer from:', senderSocketId);
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          });

          peerConnections.current[senderSocketId] = pc;

          pc.onicecandidate = (event) => {
            if (event.candidate && socketRef.current) {
              console.log('[WebRTC] Guest generated ICE candidate for:', senderSocketId);
              socketRef.current.emit('webrtc:signal', {
                targetSocketId: senderSocketId,
                signal: { candidate: event.candidate }
              });
            }
          };

          pc.ontrack = (event) => {
            console.log('[WebRTC] Guest received remote track:', event.track.kind);
            if (event.streams && event.streams[0]) {
              setScreenShareStream(new MediaStream(event.streams[0].getTracks()));
            } else {
              setScreenShareStream((prevStream) => {
                const stream = prevStream ? new MediaStream(prevStream.getTracks()) : new MediaStream();
                stream.addTrack(event.track);
                return stream;
              });
            }
          };

          await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          newSocket.emit('webrtc:signal', {
            targetSocketId: senderSocketId,
            signal: answer
          });

          // Process queued ICE candidates
          const candidates = pendingCandidates.current[senderSocketId] || [];
          for (const c of candidates) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
          }
          pendingCandidates.current[senderSocketId] = [];
        } catch (e) {
          console.error('[WebRTC] Error handling offer:', e);
        }
      } else if (signal.type === 'answer') {
        const pc = peerConnections.current[senderSocketId];
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
            const candidates = pendingCandidates.current[senderSocketId] || [];
            for (const c of candidates) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
            }
            pendingCandidates.current[senderSocketId] = [];
          } catch (e) {
            console.error('[WebRTC] Error handling answer:', e);
          }
        }
      } else if (signal.candidate) {
        const pc = peerConnections.current[senderSocketId];
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (e) {
            console.error('[WebRTC] Error adding ICE candidate:', e);
          }
        } else {
          if (!pendingCandidates.current[senderSocketId]) {
            pendingCandidates.current[senderSocketId] = [];
          }
          pendingCandidates.current[senderSocketId].push(signal.candidate);
        }
      }
    });

    // Voice open mic WebRTC signaling
    newSocket.on('mic:signal', async (data: { senderSocketId: string; signal: any }) => {
      const { senderSocketId, signal } = data;
      const micOwnerSocketId: string = signal.micOwnerSocketId ?? senderSocketId;
      const isMyMicStream = micOwnerSocketId === newSocket.id;

      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ];

      if (signal.type === 'offer') {
        try {
          console.log('[WebRTC Mic] Offer received from sender:', senderSocketId);
          
          if (incomingMicConnections.current[micOwnerSocketId]) {
            try { incomingMicConnections.current[micOwnerSocketId].close(); } catch (e) {}
            delete incomingMicConnections.current[micOwnerSocketId];
            delete incomingMicPendingCandidates.current[micOwnerSocketId];
          }

          const pc = new RTCPeerConnection({ iceServers });
          incomingMicConnections.current[micOwnerSocketId] = pc;

          const isCurrent = () => incomingMicConnections.current[micOwnerSocketId] === pc;

          pc.onicecandidate = (e) => {
            if (e.candidate && socketRef.current && isCurrent()) {
              socketRef.current.emit('mic:signal', {
                targetSocketId: senderSocketId,
                signal: { 
                  candidate: e.candidate,
                  micOwnerSocketId 
                }
              });
            }
          };

          pc.ontrack = (e) => {
            console.log('[WebRTC Mic] Received remote audio track from sender:', micOwnerSocketId);
            const audio = document.getElementById(`mic-audio-${micOwnerSocketId}`) as HTMLAudioElement || document.createElement('audio');
            audio.id = `mic-audio-${micOwnerSocketId}`;
            audio.srcObject = e.streams[0] || new MediaStream([e.track]);
            audio.autoplay = true;
            if (!document.getElementById(`mic-audio-${micOwnerSocketId}`)) {
              document.body.appendChild(audio);
            }
          };

          pc.onconnectionstatechange = () => {
            console.log(`[WebRTC Mic] Incoming connection state with ${micOwnerSocketId}: ${pc.connectionState}`);
          };

          await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
          
          if (!isCurrent()) {
            console.log('[WebRTC Mic] Offer superseded by newer one during setRemoteDescription, aborting.');
            return;
          }

          if (pc.signalingState !== 'have-remote-offer') {
            console.warn('[WebRTC Mic] Unexpected signalingState after setRemoteDescription:', pc.signalingState, '— aborting answer.');
            return;
          }

          const answer = await pc.createAnswer();
          
          if (!isCurrent() || (pc.signalingState as string) === 'closed') {
            console.log('[WebRTC Mic] PC closed or superseded before setLocalDescription, aborting.');
            return;
          }

          await pc.setLocalDescription(answer);

          newSocket.emit('mic:signal', { 
            targetSocketId: senderSocketId, 
            signal: { type: answer.type, sdp: answer.sdp, micOwnerSocketId } 
          });

          const candidates = incomingMicPendingCandidates.current[micOwnerSocketId] || [];
          for (const c of candidates) {
            if (!isCurrent()) break;
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
          }
          if (isCurrent()) {
            incomingMicPendingCandidates.current[micOwnerSocketId] = [];
          }
        } catch (err) {
          console.error('[WebRTC Mic] Error handling offer:', err);
        }
      } else if (signal.type === 'answer') {
        const pc = outgoingMicConnections.current[senderSocketId];
        if (pc) {
          try {
            console.log('[WebRTC Mic] Answer received from listener:', senderSocketId);
            await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
            const candidates = outgoingMicPendingCandidates.current[senderSocketId] || [];
            for (const c of candidates) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
            }
            outgoingMicPendingCandidates.current[senderSocketId] = [];
          } catch (e) {
            console.error('[WebRTC Mic] Error handling answer:', e);
          }
        }
      } else if (signal.candidate) {
        if (isMyMicStream) {
          const pc = outgoingMicConnections.current[senderSocketId];
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(console.error);
          } else {
            if (!outgoingMicPendingCandidates.current[senderSocketId]) {
              outgoingMicPendingCandidates.current[senderSocketId] = [];
            }
            outgoingMicPendingCandidates.current[senderSocketId].push(signal.candidate);
          }
        } else {
          const pc = incomingMicConnections.current[micOwnerSocketId];
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(console.error);
          } else {
            if (!incomingMicPendingCandidates.current[micOwnerSocketId]) {
              incomingMicPendingCandidates.current[micOwnerSocketId] = [];
            }
            incomingMicPendingCandidates.current[micOwnerSocketId].push(signal.candidate);
          }
        }
      }
    });

    return () => {
      console.log('[Socket] Disconnecting socket...');
      newSocket.close();
      socketRef.current = null;
      setSocket(null);
    };
  }, [roomInfo]);

  const joinRoom = (newRoomId: string, name: string, isCreator?: boolean) => {
    setUsername(name);
    setRoomId(newRoomId);
    setMessages([]);
    setRoomState({ users: [], hostId: null, videoUrl: '', isScreenSharing: false, sharingUserId: null });
    setRoomInfo({ id: newRoomId, name, creator: !!isCreator });
  };

  const leaveRoom = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setRoomId(null);
    setRoomInfo(null);
    setSocket(null);
    setMessages([]);
    setRoomState({ users: [], hostId: null, videoUrl: '', isScreenSharing: false, sharingUserId: null });
    setIsScreenSharing(false);
    setScreenShareStream(null);

    // Clean up connections
    Object.values(peerConnections.current).forEach((pc: any) => {
      try { pc.close(); } catch(e) {}
    });
    peerConnections.current = {};
    pendingCandidates.current = {};

    // Clean up mic connections
    Object.values(outgoingMicConnections.current).forEach((pc: any) => {
      try { pc.close(); } catch(e) {}
    });
    outgoingMicConnections.current = {};
    outgoingMicPendingCandidates.current = {};

    Object.values(incomingMicConnections.current).forEach((pc: any) => {
      try { pc.close(); } catch(e) {}
    });
    incomingMicConnections.current = {};
    incomingMicPendingCandidates.current = {};

    if (micStream.current) {
      micStream.current.getTracks().forEach((t: any) => t.stop());
      micStream.current = null;
    }
    setIsMicActive(false);

    if (typeof document !== 'undefined') {
      document.querySelectorAll('[id^="mic-audio-"]').forEach(el => el.remove());
    }
  };

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
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        iceCandidatePoolSize: 2
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

      await optimizeSenders(pc);

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
      if (screenShareStream) {
        try {
          screenShareStream.getTracks().forEach(track => track.stop());
        } catch (e) {
          console.warn('[WebRTC] Error stopping previous tracks:', e);
        }
        setScreenShareStream(null);
      }
      const canScreenShare =
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices &&
        'getDisplayMedia' in navigator.mediaDevices;

      let stream: MediaStream;

      if (canScreenShare) {
        // Desktop: use real screen capture
        console.log('[WebRTC] Requesting screen share via getDisplayMedia...');
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' } as any,
          audio: true
        });
        setIsCameraShare(false);
      } else {
        // Mobile fallback: share camera feed
        console.log('[WebRTC] getDisplayMedia unavailable — falling back to camera share...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true
        });
        setIsCameraShare(true);
      }

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

      // Handle when sharing is stopped via browser/OS controls
      stream.getVideoTracks()[0].onended = () => {
        console.log('[WebRTC] Share ended via browser controls');
        stopScreenShare();
      };
    } catch (err) {
      console.error('[WebRTC] Error starting share:', err);
    }
  };

  const stopScreenShare = () => {
    console.log('[WebRTC] Stopping share...');
    setIsScreenSharing(false);
    setIsCameraShare(false);

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

  // Connect WebRTC to new users joining mid-screen-share (any sharer, not just host)
  useEffect(() => {
    if (!isSharer || !isScreenSharing || !screenShareStream || !socket) return;

    const currentGuests = roomState.users.filter(u => u.userId !== userId);
    for (const guest of currentGuests) {
      if (!peerConnections.current[guest.socketId]) {
        console.log('[WebRTC] New user joined mid-stream, connecting:', guest.socketId);
        createPeerConnection(guest.socketId, screenShareStream);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState.users, isSharer, isScreenSharing, screenShareStream, socket]);

  // Synchronize screen share state with roomState for guests inside useEffect
  useEffect(() => {
    if (isSharer) return;

    if (roomState.isScreenSharing && !isScreenSharing) {
      console.log("[WebRTC] Syncing screen share state to active based on room state");
      setIsScreenSharing(true);
    } else if (!roomState.isScreenSharing && isScreenSharing) {
      console.log("[WebRTC] Syncing screen share state to inactive based on room state");
      setIsScreenSharing(false);
      // Clean up guest side media stream and peer connections safely
      if (screenShareStream) {
        try { screenShareStream.getTracks().forEach(track => track.stop()); } catch (e) {}
      }
      setScreenShareStream(null);
      Object.keys(peerConnections.current).forEach(socketId => {
        try { peerConnections.current[socketId].close(); } catch (e) {}
      });
      peerConnections.current = {};
      pendingCandidates.current = {};
    }
  }, [roomState.isScreenSharing, isSharer, isScreenSharing]);

  const sendChatMessage = (text: string) => {
    if (!socketRef.current || !username || !text.trim()) return;
    socketRef.current.emit('chat:message', { username, text: text.trim() });
  };

  const transferHost = (targetUserId: string) => {
    if (!isHost || !socketRef.current) return;
    socketRef.current.emit('room:transfer_host', { newHostUserId: targetUserId });
  };

  const requestHost = () => {
    if (isHost || !socketRef.current) return;
    socketRef.current.emit('room:request_host', { fromUsername: username });
  };

  const startOutgoingAudio = async (targetSocketId: string) => {
    if (!micStream.current) return;
    try {
      console.log('[WebRTC Mic] Initiating outgoing audio connection to:', targetSocketId);
      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ];

      const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 2
      });
      outgoingMicConnections.current[targetSocketId] = pc;

      micStream.current.getTracks().forEach(track => {
        pc.addTrack(track, micStream.current!);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('mic:signal', {
            targetSocketId,
            signal: { 
              candidate: event.candidate,
              micOwnerSocketId: socketRef.current.id 
            }
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC Mic] Outgoing connection state to ${targetSocketId}: ${pc.connectionState}`);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await optimizeSenders(pc);

      if (socketRef.current) {
        socketRef.current.emit('mic:signal', {
          targetSocketId,
          signal: { type: offer.type, sdp: offer.sdp, micOwnerSocketId: socketRef.current.id }
        });
      }
    } catch (e) {
      console.error('[WebRTC Mic] Error creating outgoing connection:', e);
    }
  };

  // Synchronize Voice Chat Peer Connections dynamically
  useEffect(() => {
    if (!socket) return;

    // 1. Synchronize INCOMING connections (we are listening to others)
    const activeMicGuests = roomState.users.filter(u => u.userId !== userId && u.micActive);
    const activeMicSocketIds = new Set(activeMicGuests.map(g => g.socketId));

    // Cleanup disconnected or muted incoming streams
    Object.keys(incomingMicConnections.current).forEach((socketId) => {
      if (!activeMicSocketIds.has(socketId)) {
        console.log(`[WebRTC Mic Cleanup] User ${socketId} muted or left. Closing incoming connection.`);
        try {
          incomingMicConnections.current[socketId].close();
        } catch (e) {}
        delete incomingMicConnections.current[socketId];
        delete incomingMicPendingCandidates.current[socketId];
        // Remove audio element
        document.getElementById(`mic-audio-${socketId}`)?.remove();
      }
    });

    // 2. Synchronize OUTGOING connections (we are broadcasting our voice)
    if (isMicActive && micStream.current) {
      const otherUsers = roomState.users.filter(u => u.userId !== userId);
      
      // Establish connections to new users in the room
      otherUsers.forEach((user) => {
        if (!outgoingMicConnections.current[user.socketId]) {
          startOutgoingAudio(user.socketId);
        }
      });

      // Cleanup outgoing connections to users who left
      const currentRoomSocketIds = new Set(otherUsers.map(u => u.socketId));
      Object.keys(outgoingMicConnections.current).forEach((socketId) => {
        if (!currentRoomSocketIds.has(socketId)) {
          console.log(`[WebRTC Mic Cleanup] Guest ${socketId} left room. Tearing down outgoing connection.`);
          try {
            outgoingMicConnections.current[socketId].close();
          } catch (e) {}
          delete outgoingMicConnections.current[socketId];
          delete outgoingMicPendingCandidates.current[socketId];
        }
      });
    } else {
      // If our mic is disabled, make sure all outgoing connections are closed
      Object.keys(outgoingMicConnections.current).forEach((socketId) => {
        console.log(`[WebRTC Mic Cleanup] Mic disabled. Closing outgoing connection to ${socketId}.`);
        try {
          outgoingMicConnections.current[socketId].close();
        } catch (e) {}
      });
      outgoingMicConnections.current = {};
      outgoingMicPendingCandidates.current = {};
    }
  }, [roomState.users, isMicActive, socket]);

  const toggleMic = async () => {
    if (isMicActive) {
      // Turn off mic: stop tracks, close connections, notify room
      micStream.current?.getTracks().forEach(t => t.stop());
      micStream.current = null;
      // Remove any injected audio elements
      document.querySelectorAll('[id^="mic-audio-"]').forEach(el => el.remove());
      setIsMicActive(false);
      socketRef.current?.emit('mic:toggle', { active: false });
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        micStream.current = stream;
        setIsMicActive(true);
        socketRef.current?.emit('mic:toggle', { active: true });
      } catch (err) {
        console.error('[Mic] Failed to get user media:', err);
      }
    }
  };

  return (
    <RoomContext.Provider value={{ 
      socket, 
      roomState, 
      userId, 
      username, 
      roomId, 
      joinRoom, 
      leaveRoom,
      isHost,
      isSharer,
      isScreenSharing,
      screenShareStream,
      startScreenShare,
      stopScreenShare,
      isCameraShare,
      messages,
      sendChatMessage,
      isMicActive,
      toggleMic,
      transferHost,
      requestHost,
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
