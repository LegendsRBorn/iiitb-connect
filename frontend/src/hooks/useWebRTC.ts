
import { useCallback, useEffect, useRef, useState } from "react";

type SendMessage = (message: object) => void;

export function useWebRTC(sendMessage: SendMessage) {

    const peerRef = useRef<RTCPeerConnection | null>(null);

    const localStreamRef = useRef<MediaStream | null>(null);

    const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

    const [localStream, setLocalStream] =
        useState<MediaStream | null>(null);

    const [remoteStream, setRemoteStream] =
        useState<MediaStream | null>(null);

    const [mediaEnabled, setMediaEnabled] = useState(false);

    // 1. Request camera and microphone access.
    const enableMedia = useCallback(async () => {

        try {

            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            localStreamRef.current = stream;

            setLocalStream(stream);
            setMediaEnabled(true);

            return true;

        } catch (error) {

            console.error("Camera/microphone access failed:", error);

            return false;
        }

    }, []);


    // 2. Create the WebRTC peer connection.
    const prepareConnection = useCallback(
        async (matchId: string, isInitiator: boolean) => {

            const stream = localStreamRef.current;

            if (!stream) {
                console.error("Enable your camera and microphone first.");
                return;
            }

            // Close any previous connection.
            if (peerRef.current) {
                peerRef.current.close();
            }

            pendingCandidates.current = [];

            const peer = new RTCPeerConnection({
                iceServers: [
                    {
                        urls: "stun:stun.l.google.com:19302"
                    }
                ]
            });

            peerRef.current = peer;

            // Add local camera and microphone tracks.
            stream.getTracks().forEach(track => {
                peer.addTrack(track, stream);
            });

            // Receive the other participant's media.
            peer.ontrack = (event) => {

                const [stream] = event.streams;

                if (stream) {
                    setRemoteStream(stream);
                }
            };

            // Send ICE candidates through FastAPI.
            peer.onicecandidate = (event) => {

                if (event.candidate) {

                    sendMessage({
                        type: "ice_candidate",
                        match_id: matchId,
                        candidate: event.candidate.toJSON()
                    });
                }
            };

            // Connection diagnostics.
            peer.onconnectionstatechange = () => {
                console.log(
                    "WebRTC connection:",
                    peer.connectionState
                );
            };

            // Only the designated initiator creates an offer.
            if (isInitiator) {

                const offer = await peer.createOffer();

                await peer.setLocalDescription(offer);

                sendMessage({
                    type: "offer",
                    match_id: matchId,
                    sdp: peer.localDescription
                });
            }

        },
        [sendMessage]
    );


    // 3. Process incoming signaling messages.
    const handleSignal = useCallback(
        async (message: {
            type: string;
            match_id?: string;
            sdp?: RTCSessionDescriptionInit;
            candidate?: RTCIceCandidateInit;
        }) => {

            const peer = peerRef.current;

            if (!peer) return;

            try {

                // Received an offer.
                if (message.type === "offer" && message.sdp) {

                    await peer.setRemoteDescription(
                        new RTCSessionDescription(message.sdp)
                    );

                    // Add any ICE candidates received early.
                    for (const candidate of pendingCandidates.current) {
                        await peer.addIceCandidate(candidate);
                    }

                    pendingCandidates.current = [];

                    const answer = await peer.createAnswer();

                    await peer.setLocalDescription(answer);

                    sendMessage({
                        type: "answer",
                        match_id: message.match_id,
                        sdp: peer.localDescription
                    });
                }


                // Received an answer.
                else if (message.type === "answer" && message.sdp) {

                    await peer.setRemoteDescription(
                        new RTCSessionDescription(message.sdp)
                    );

                    for (const candidate of pendingCandidates.current) {
                        await peer.addIceCandidate(candidate);
                    }

                    pendingCandidates.current = [];
                }


                // Received an ICE candidate.
                else if (
                    message.type === "ice_candidate" &&
                    message.candidate
                ) {

                    if (peer.remoteDescription) {

                        await peer.addIceCandidate(
                            new RTCIceCandidate(message.candidate)
                        );

                    } else {

                        pendingCandidates.current.push(
                            message.candidate
                        );
                    }
                }

            } catch (error) {

                console.error("WebRTC signaling error:", error);
            }

        },
        [sendMessage]
    );


    // 4. Close the peer connection.
    const cleanupConnection = useCallback(() => {

        if (peerRef.current) {

            peerRef.current.ontrack = null;
            peerRef.current.onicecandidate = null;

            peerRef.current.close();

            peerRef.current = null;
        }

        pendingCandidates.current = [];

        setRemoteStream(null);

    }, []);


    // 5. Stop camera and microphone.
    const disableMedia = useCallback(() => {

        cleanupConnection();

        localStreamRef.current?.getTracks().forEach(track => {
            track.stop();
        });

        localStreamRef.current = null;

        setLocalStream(null);
        setMediaEnabled(false);

    }, [cleanupConnection]);


    // Clean everything up when the component unmounts.
    useEffect(() => {

        return () => {

            peerRef.current?.close();

            localStreamRef.current?.getTracks().forEach(track => {
                track.stop();
            });

        };

    }, []);


    return {
        localStream,
        remoteStream,
        mediaEnabled,
        enableMedia,
        disableMedia,
        prepareConnection,
        handleSignal,
        cleanupConnection
    };
}
