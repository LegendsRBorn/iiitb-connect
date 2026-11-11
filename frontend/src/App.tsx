
import { useCallback, useEffect, useRef, useState } from "react";

import { useSocket, type ServerMessage } from "./hooks/useSocket";
import { useWebRTC } from "./hooks/useWebRTC";

function App() {

    // ----------------------------------
    // 1. Socket and WebRTC initialization
    // ----------------------------------

    const messageHandlerRef = useRef<
        (message: ServerMessage) => void
    >(() => {});

    const relayMessage = useCallback((message: ServerMessage) => {
        messageHandlerRef.current(message);
    }, []);

    const { connected, sendMessage } = useSocket(relayMessage);

    const {
        localStream,
        remoteStream,
        mediaEnabled,
        enableMedia,
        disableMedia,
        prepareConnection,
        handleSignal,
        cleanupConnection
    } = useWebRTC(sendMessage);


    // ----------------------------------
    // 2. Application state
    // ----------------------------------

    const [status, setStatus] = useState(
        "connecting"
    );

    const [userId, setUserId] = useState("");

    const [matchId, setMatchId] = useState("");

    const [partnerAccepted, setPartnerAccepted] = useState(false);

    const localVideoRef = useRef<HTMLVideoElement>(null);

    const remoteVideoRef = useRef<HTMLVideoElement>(null);

    // Buffer signaling messages if they arrive before
    // our peer connection has been initialized.
    const webrtcReadyRef = useRef(false);

    const pendingSignalsRef = useRef<ServerMessage[]>([]);


    // ----------------------------------
    // 3. Display local video
    // ----------------------------------

    useEffect(() => {

        if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
        }

    }, [localStream]);


    // ----------------------------------
    // 4. Display remote video
    // ----------------------------------

    useEffect(() => {

        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
        }

    }, [remoteStream]);


    // ----------------------------------
    // 5. Handle messages from FastAPI
    // ----------------------------------

    const handleServerMessage = useCallback(
        async (message: ServerMessage) => {

            console.log("Server message:", message);

            switch (message.type) {

                case "connected":

                    setUserId(message.user_id ?? "");
                    setStatus("idle");

                    break;


                case "waiting":

                    setStatus("searching");

                    break;


                case "match_found":

                    setMatchId(message.match_id ?? "");
                    setPartnerAccepted(false);
                    setStatus("invited");

                    break;


                case "match_accepted":

                    setPartnerAccepted(true);

                    break;


                case "match_ready": {

                    if (!message.match_id) return;

                    setMatchId(message.match_id);
                    setStatus("in_call");

                    webrtcReadyRef.current = false;
                    pendingSignalsRef.current = [];

                    // Create the peer connection.
                    await prepareConnection(
                        message.match_id,
                        message.initiator === true
                    );

                    webrtcReadyRef.current = true;

                    // Process messages that arrived early.
                    const queuedSignals = [
                        ...pendingSignalsRef.current
                    ];

                    pendingSignalsRef.current = [];

                    for (const signal of queuedSignals) {
                        await handleSignal(signal);
                    }

                    break;
                }


                case "offer":
                case "answer":
                case "ice_candidate":

                    if (!webrtcReadyRef.current) {

                        pendingSignalsRef.current.push(message);

                    } else {

                        await handleSignal(message);
                    }

                    break;


                case "match_rejected":

                    webrtcReadyRef.current = false;
                    pendingSignalsRef.current = [];

                    cleanupConnection();

                    setMatchId("");
                    setPartnerAccepted(false);
                    setStatus("idle");

                    break;


                case "match_ended":
                case "idle":

                    webrtcReadyRef.current = false;
                    pendingSignalsRef.current = [];

                    cleanupConnection();

                    setMatchId("");
                    setPartnerAccepted(false);
                    setStatus("idle");

                    break;


                default:

                    console.log("Unknown message:", message);

            }

        },
        [prepareConnection, handleSignal, cleanupConnection]
    );


    // Keep the latest handler available to useSocket.
    messageHandlerRef.current = handleServerMessage;


    // ----------------------------------
    // 6. Enable camera and microphone
    // ----------------------------------

    const handleEnableMedia = async () => {

        const success = await enableMedia();

        if (!success) {
            alert(
                "Camera or microphone access failed. Check your browser permissions."
            );
        }

    };


    // ----------------------------------
    // 7. Matching functions
    // ----------------------------------

    const findPartner = () => {

        if (!connected || !mediaEnabled) return;

        sendMessage({
            type: "find"
        });

        setStatus("searching");

    };


    const acceptMatch = () => {

        if (!matchId) return;

        sendMessage({
            type: "accept",
            match_id: matchId
        });

    };


    const rejectMatch = () => {

        if (!matchId) return;

        sendMessage({
            type: "reject",
            match_id: matchId
        });

        setStatus("idle");
        setMatchId("");

    };


    const cancelSearch = () => {

        sendMessage({
            type: "cancel_search"
        });

        setStatus("idle");

    };


    const disconnect = () => {

        sendMessage({
            type: "skip"
        });

        webrtcReadyRef.current = false;
        pendingSignalsRef.current = [];

        cleanupConnection();

        setMatchId("");
        setPartnerAccepted(false);
        setStatus("idle");

    };


    // ----------------------------------
    // 8. User interface
    // ----------------------------------

    return (

        <div className="app">

            <header>
                <h1>IIITB Connect</h1>

                <p>
                    {connected
                        ? "Connected to server"
                        : "Connecting to server..."}
                </p>
            </header>


            <main>

                <div className="status-card">

                    <h2>
                        Status: {status.replace("_", " ")}
                    </h2>

                    {userId && (
                        <p className="user-id">
                            Your ID: {userId}
                        </p>
                    )}

                </div>


                {/* Camera permission */}

                {!mediaEnabled && (

                    <div className="media-setup">

                        <h3>Enable your camera and microphone</h3>

                        <p>
                            Your camera and microphone will only be
                            accessed after you enable them.
                        </p>

                        <button
                            onClick={handleEnableMedia}
                            disabled={!connected}
                        >
                            Enable Camera and Microphone
                        </button>

                    </div>

                )}


                {/* Video section */}

                <div className="video-container">

                    <div className="video-card">

                        <h3>You</h3>

                        <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            muted
                        />

                    </div>


                    <div className="video-card">

                        <h3>Other Student</h3>

                        <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                        />

                        {!remoteStream && (
                            <p>Waiting for video...</p>
                        )}

                    </div>

                </div>


                {/* Matching controls */}

                <div className="actions">

                    {status === "idle" && (

                        <button
                            onClick={findPartner}
                            disabled={!connected || !mediaEnabled}
                        >
                            Find a Student
                        </button>

                    )}


                    {status === "searching" && (

                        <button onClick={cancelSearch}>
                            Cancel Search
                        </button>

                    )}


                    {status === "invited" && (

                        <>

                            <h3>Student found!</h3>

                            <p>
                                {partnerAccepted
                                    ? "The other student has accepted."
                                    : "Waiting for the other student's response..."}
                            </p>

                            <button onClick={acceptMatch}>
                                Accept
                            </button>

                            <button onClick={rejectMatch}>
                                Reject
                            </button>

                        </>

                    )}


                    {status === "in_call" && (

                        <>

                            <h3>You are connected!</h3>

                            <button onClick={disconnect}>
                                Disconnect
                            </button>

                        </>

                    )}

                </div>

            </main>

        </div>

    );

}

export default App;
