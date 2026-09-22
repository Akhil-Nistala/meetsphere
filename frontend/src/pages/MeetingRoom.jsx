import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import io from "socket.io-client";
import { Badge, IconButton, TextField, Button, Avatar, Tooltip } from "@mui/material";
import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import CallEndIcon from "@mui/icons-material/CallEnd";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import ChatIcon from "@mui/icons-material/Chat";
import GroupIcon from "@mui/icons-material/Group";
import apiBaseUrl from "../config/api";
import { AuthContext } from "../context/AuthContext";
import withAuth from "../utils/withAuth";
import styles from "../styles/meetingRoom.module.css";

const server_url = apiBaseUrl;

// Keyed by remote socket id. Module-level (not state) because these are raw
// WebRTC objects, not serializable/renderable data — React doesn't need to
// know about them, we just need them to survive across renders.
var connections = {};

const peerConfigConnections = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const resetPeerConnections = () => {
    Object.values(connections).forEach((pc) => {
        try {
            pc.close();
        } catch {
            // already closed
        }
    });
    connections = {};
};

function MeetingRoom() {
    const { code: meetingCode } = useParams();
    const navigate = useNavigate();
    const { userData, joinMeeting, leaveMeeting, endMeeting } = useContext(AuthContext);

    var socketRef = useRef();
    let socketIdRef = useRef();
    let localVideoref = useRef();
    const videoRef = useRef([]);

    let [videoAvailable, setVideoAvailable] = useState(true);
    let [audioAvailable, setAudioAvailable] = useState(true);
    let [video, setVideo] = useState();
    let [audio, setAudio] = useState();
    let [screen, setScreen] = useState();
    let [showModal, setModal] = useState(true);
    let [showParticipants, setShowParticipants] = useState(false);
    let [screenAvailable, setScreenAvailable] = useState();
    let [messages, setMessages] = useState([]);
    let [message, setMessage] = useState("");
    let [newMessages, setNewMessages] = useState(0);
    let [videos, setVideos] = useState([]);

    const [phase, setPhase] = useState("lobby"); // lobby | connecting | in-call
    const [joinError, setJoinError] = useState("");
    const [isHost, setIsHost] = useState(false);
    const [participants, setParticipants] = useState([]); // remote participants, from the socket layer
    const [connectionStatus, setConnectionStatus] = useState("connected"); // connected | reconnecting

    useEffect(() => {
        getPermissions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    let getDislayMedia = () => {
        if (screen) {
            if (navigator.mediaDevices.getDisplayMedia) {
                navigator.mediaDevices
                    .getDisplayMedia({ video: true, audio: true })
                    .then(getDislayMediaSuccess)
                    .catch((e) => console.log(e));
            }
        }
    };

    const getPermissions = async () => {
        try {
            const videoPermission = await navigator.mediaDevices.getUserMedia({ video: true });
            setVideoAvailable(!!videoPermission);

            const audioPermission = await navigator.mediaDevices.getUserMedia({ audio: true });
            setAudioAvailable(!!audioPermission);

            setScreenAvailable(!!navigator.mediaDevices.getDisplayMedia);

            if (videoAvailable || audioAvailable) {
                const userMediaStream = await navigator.mediaDevices.getUserMedia({
                    video: videoAvailable,
                    audio: audioAvailable
                });
                if (userMediaStream) {
                    window.localStream = userMediaStream;
                    if (localVideoref.current) {
                        localVideoref.current.srcObject = userMediaStream;
                    }
                }
            }
        } catch (error) {
            console.log(error);
        }
    };

    useEffect(() => {
        if (video !== undefined && audio !== undefined) {
            getUserMedia();
            if (phase === "in-call") {
                socketRef.current?.emit("media-state", { micOn: !!audio, cameraOn: !!video });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [video, audio]);

    let getMedia = () => {
        setVideo(videoAvailable);
        setAudio(audioAvailable);
    };

    let getUserMediaSuccess = (stream) => {
        try {
            window.localStream.getTracks().forEach((track) => track.stop());
        } catch (e) {
            console.log(e);
        }

        window.localStream = stream;
        localVideoref.current.srcObject = stream;

        for (let id in connections) {
            if (id === socketIdRef.current) continue;

            connections[id].addStream(window.localStream);

            connections[id].createOffer().then((description) => {
                connections[id]
                    .setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit(
                            "signal",
                            id,
                            JSON.stringify({ sdp: connections[id].localDescription })
                        );
                    })
                    .catch((e) => console.log(e));
            });
        }

        stream.getTracks().forEach(
            (track) =>
                (track.onended = () => {
                    setVideo(false);
                    setAudio(false);

                    try {
                        let tracks = localVideoref.current.srcObject.getTracks();
                        tracks.forEach((t) => t.stop());
                    } catch (e) {
                        console.log(e);
                    }

                    let blackSilence = (...args) => new MediaStream([black(...args), silence()]);
                    window.localStream = blackSilence();
                    localVideoref.current.srcObject = window.localStream;

                    for (let id in connections) {
                        connections[id].addStream(window.localStream);

                        connections[id].createOffer().then((description) => {
                            connections[id]
                                .setLocalDescription(description)
                                .then(() => {
                                    socketRef.current.emit(
                                        "signal",
                                        id,
                                        JSON.stringify({ sdp: connections[id].localDescription })
                                    );
                                })
                                .catch((e) => console.log(e));
                        });
                    }
                })
        );
    };

    let getUserMedia = () => {
        if ((video && videoAvailable) || (audio && audioAvailable)) {
            navigator.mediaDevices
                .getUserMedia({ video, audio })
                .then(getUserMediaSuccess)
                .catch((e) => console.log(e));
        } else {
            try {
                let tracks = localVideoref.current.srcObject.getTracks();
                tracks.forEach((track) => track.stop());
            } catch (e) {
                // no active stream to stop
            }
        }
    };

    let getDislayMediaSuccess = (stream) => {
        try {
            window.localStream.getTracks().forEach((track) => track.stop());
        } catch (e) {
            console.log(e);
        }

        window.localStream = stream;
        localVideoref.current.srcObject = stream;

        for (let id in connections) {
            if (id === socketIdRef.current) continue;

            connections[id].addStream(window.localStream);

            connections[id].createOffer().then((description) => {
                connections[id]
                    .setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit(
                            "signal",
                            id,
                            JSON.stringify({ sdp: connections[id].localDescription })
                        );
                    })
                    .catch((e) => console.log(e));
            });
        }

        stream.getTracks().forEach(
            (track) =>
                (track.onended = () => {
                    setScreen(false);

                    try {
                        let tracks = localVideoref.current.srcObject.getTracks();
                        tracks.forEach((t) => t.stop());
                    } catch (e) {
                        console.log(e);
                    }

                    let blackSilence = (...args) => new MediaStream([black(...args), silence()]);
                    window.localStream = blackSilence();
                    localVideoref.current.srcObject = window.localStream;

                    getUserMedia();
                })
        );
    };

    let gotMessageFromServer = (fromId, message) => {
        var signal = JSON.parse(message);

        if (fromId === socketIdRef.current) return;

        if (signal.sdp) {
            connections[fromId]
                .setRemoteDescription(new RTCSessionDescription(signal.sdp))
                .then(() => {
                    if (signal.sdp.type === "offer") {
                        connections[fromId]
                            .createAnswer()
                            .then((description) => {
                                connections[fromId]
                                    .setLocalDescription(description)
                                    .then(() => {
                                        socketRef.current.emit(
                                            "signal",
                                            fromId,
                                            JSON.stringify({ sdp: connections[fromId].localDescription })
                                        );
                                    })
                                    .catch((e) => console.log(e));
                            })
                            .catch((e) => console.log(e));
                    }
                })
                .catch((e) => console.log(e));
        }

        if (signal.ice) {
            connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch((e) => console.log(e));
        }
    };

    const registerSocketListeners = (socket) => {
        socket.on("connect", () => {
            socketIdRef.current = socket.id;
            setConnectionStatus("connected");
        });

        socket.on("disconnect", () => {
            setConnectionStatus("reconnecting");
        });

        socket.io.on("reconnect", () => {
            // A fresh transport-level connection gets a new socket id, and the
            // server has already dropped our old room membership — so instead
            // of trying to patch the old state back together, do a clean
            // re-join: fresh REST session, fresh peer connections.
            resetPeerConnections();
            videoRef.current = [];
            setVideos([]);
            rejoinRoom();
        });

        socket.on("signal", gotMessageFromServer);

        socket.on("room-error", ({ message }) => {
            setJoinError(message);
            setPhase("lobby");
        });

        socket.on("meeting-ended", () => {
            alert("The host ended this meeting.");
            handleEndCall();
        });

        socket.on("user-left", (id) => {
            setVideos((prev) => prev.filter((v) => v.socketId !== id));
        });

        socket.on("participant-list", (list) => {
            setParticipants(list.filter((p) => p.socketId !== socketIdRef.current));
        });

        socket.on("participant-joined", (participant) => {
            setParticipants((prev) => [...prev.filter((p) => p.socketId !== participant.socketId), participant]);
        });

        socket.on("participant-left", ({ socketId }) => {
            setParticipants((prev) => prev.filter((p) => p.socketId !== socketId));
        });

        socket.on("participant-state", ({ socketId, micOn, cameraOn }) => {
            setParticipants((prev) => prev.map((p) => (p.socketId === socketId ? { ...p, micOn, cameraOn } : p)));
        });

        socket.on("chat-message", (payload) => {
            addMessage(payload.text, payload.senderName, payload.senderSocketId);
        });

        socket.on("user-joined", (id, clients) => {
            clients.forEach((socketListId) => {
                connections[socketListId] = new RTCPeerConnection(peerConfigConnections);

                connections[socketListId].onicecandidate = (event) => {
                    if (event.candidate != null) {
                        socketRef.current.emit(
                            "signal",
                            socketListId,
                            JSON.stringify({ ice: event.candidate })
                        );
                    }
                };

                connections[socketListId].onaddstream = (event) => {
                    const videoExists = videoRef.current.find((v) => v.socketId === socketListId);

                    if (videoExists) {
                        setVideos((videos) => {
                            const updatedVideos = videos.map((v) =>
                                v.socketId === socketListId ? { ...v, stream: event.stream } : v
                            );
                            videoRef.current = updatedVideos;
                            return updatedVideos;
                        });
                    } else {
                        const newVideo = {
                            socketId: socketListId,
                            stream: event.stream,
                            autoplay: true,
                            playsinline: true
                        };

                        setVideos((videos) => {
                            const updatedVideos = [...videos, newVideo];
                            videoRef.current = updatedVideos;
                            return updatedVideos;
                        });
                    }
                };

                if (window.localStream !== undefined && window.localStream !== null) {
                    connections[socketListId].addStream(window.localStream);
                } else {
                    let blackSilence = (...args) => new MediaStream([black(...args), silence()]);
                    window.localStream = blackSilence();
                    connections[socketListId].addStream(window.localStream);
                }
            });

            if (id === socketIdRef.current) {
                for (let id2 in connections) {
                    if (id2 === socketIdRef.current) continue;

                    try {
                        connections[id2].addStream(window.localStream);
                    } catch (e) {
                        console.log(e);
                    }

                    connections[id2].createOffer().then((description) => {
                        connections[id2]
                            .setLocalDescription(description)
                            .then(() => {
                                socketRef.current.emit(
                                    "signal",
                                    id2,
                                    JSON.stringify({ sdp: connections[id2].localDescription })
                                );
                            })
                            .catch((e) => console.log(e));
                    });
                }
            }
        });
    };

    const rejoinRoom = async () => {
        try {
            const data = await joinMeeting(meetingCode);
            setIsHost(data.meeting.isHost);
            setMessages(data.messages.map((m) => ({ sender: m.senderName, data: m.text })));
            socketRef.current.emit("join-room", { meetingCode });
        } catch (err) {
            setJoinError(err?.response?.data?.message ?? "Could not rejoin the meeting");
        }
    };

    let connectToSocketServer = async () => {
        setPhase("connecting");
        setJoinError("");

        try {
            const data = await joinMeeting(meetingCode);
            setIsHost(data.meeting.isHost);
            setMessages(data.messages.map((m) => ({ sender: m.senderName, data: m.text })));
        } catch (err) {
            setJoinError(err?.response?.data?.message ?? "Could not join this meeting");
            setPhase("lobby");
            return;
        }

        const token = localStorage.getItem("token");
        socketRef.current = io(server_url, { auth: { token } });
        registerSocketListeners(socketRef.current);

        // Only the very first connection needs this — reconnections are
        // handled by the "reconnect" listener in registerSocketListeners,
        // which explicitly re-emits join-room itself (see rejoinRoom).
        socketRef.current.once("connect", () => {
            socketRef.current.emit("join-room", { meetingCode });
        });

        setPhase("in-call");
    };

    let silence = () => {
        let ctx = new AudioContext();
        let oscillator = ctx.createOscillator();
        let dst = oscillator.connect(ctx.createMediaStreamDestination());
        oscillator.start();
        ctx.resume();
        return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false });
    };

    let black = ({ width = 640, height = 480 } = {}) => {
        let canvas = Object.assign(document.createElement("canvas"), { width, height });
        canvas.getContext("2d").fillRect(0, 0, width, height);
        let stream = canvas.captureStream();
        return Object.assign(stream.getVideoTracks()[0], { enabled: false });
    };

    let handleVideo = () => setVideo(!video);
    let handleAudio = () => setAudio(!audio);

    useEffect(() => {
        if (screen !== undefined) {
            getDislayMedia();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screen]);

    let handleScreen = () => setScreen(!screen);

    const stopLocalTracks = () => {
        try {
            let tracks = localVideoref.current.srcObject.getTracks();
            tracks.forEach((track) => track.stop());
        } catch (e) {
            // no active stream to stop
        }
    };

    let handleEndCall = () => {
        stopLocalTracks();
        resetPeerConnections();
        socketRef.current?.disconnect();
        navigate("/home");
    };

    const handleLeave = async () => {
        try {
            await leaveMeeting(meetingCode);
        } catch (e) {
            console.log(e);
        }
        handleEndCall();
    };

    const handleEndForEveryone = async () => {
        try {
            await endMeeting(meetingCode);
            socketRef.current?.emit("end-meeting");
        } catch (e) {
            console.log(e);
        }
        handleEndCall();
    };

    let closeChat = () => setModal(false);

    const addMessage = (text, senderName, senderSocketId) => {
        setMessages((prevMessages) => [...prevMessages, { sender: senderName, data: text }]);
        if (senderSocketId !== socketIdRef.current) {
            setNewMessages((prevNewMessages) => prevNewMessages + 1);
        }
    };

    let sendMessage = () => {
        const text = message.trim();
        if (!text) return;
        socketRef.current.emit("chat-message", { text });
        setMessage("");
    };

    let connect = () => {
        getMedia();
        connectToSocketServer();
    };

    return (
        <div>
            {phase !== "in-call" ? (
                <div className={styles.lobbyContainer}>
                    <h2>Ready to join, {userData?.name}?</h2>
                    {joinError && <p style={{ color: "red" }}>{joinError}</p>}
                    <Button variant="contained" onClick={connect} disabled={phase === "connecting"}>
                        {phase === "connecting" ? "Joining…" : "Join Meeting"}
                    </Button>

                    <div>
                        <video ref={localVideoref} autoPlay muted></video>
                    </div>
                </div>
            ) : (
                <div className={styles.meetVideoContainer}>
                    {connectionStatus === "reconnecting" && (
                        <div className={styles.reconnectBanner}>Connection lost — reconnecting…</div>
                    )}

                    {showModal && (
                        <div className={styles.chatRoom}>
                            <div className={styles.chatContainer}>
                                <div className={styles.chatHeader}>
                                    <h1>Chat</h1>
                                    <IconButton onClick={closeChat} size="small">
                                        &times;
                                    </IconButton>
                                </div>

                                <div className={styles.chattingDisplay}>
                                    {messages.length !== 0 ? (
                                        messages.map((item, index) => (
                                            <div style={{ marginBottom: "20px" }} key={index}>
                                                <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                                                <p>{item.data}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <p>No Messages Yet</p>
                                    )}
                                </div>

                                <div className={styles.chattingArea}>
                                    <TextField
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                                        id="chat-message"
                                        label="Enter Your chat"
                                        variant="outlined"
                                    />
                                    <Button variant="contained" onClick={sendMessage}>
                                        Send
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {showParticipants && (
                        <div className={styles.participantPanel}>
                            <div className={styles.chatHeader}>
                                <h1>Participants ({participants.length + 1})</h1>
                                <IconButton onClick={() => setShowParticipants(false)} size="small">
                                    &times;
                                </IconButton>
                            </div>

                            <div className={styles.participantRow}>
                                <Avatar sx={{ width: 28, height: 28 }}>{userData?.name?.[0]}</Avatar>
                                <span>{userData?.name} (You)</span>
                                {audio ? <MicIcon fontSize="small" /> : <MicOffIcon fontSize="small" />}
                                {video ? <VideocamIcon fontSize="small" /> : <VideocamOffIcon fontSize="small" />}
                            </div>

                            {participants.map((p) => (
                                <div className={styles.participantRow} key={p.socketId}>
                                    <Avatar sx={{ width: 28, height: 28 }}>{p.name?.[0]}</Avatar>
                                    <span>{p.name}</span>
                                    {p.micOn ? <MicIcon fontSize="small" /> : <MicOffIcon fontSize="small" />}
                                    {p.cameraOn ? (
                                        <VideocamIcon fontSize="small" />
                                    ) : (
                                        <VideocamOffIcon fontSize="small" />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: "white" }}>
                            {video ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>
                        <IconButton onClick={handleAudio} style={{ color: "white" }}>
                            {audio ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>

                        {screenAvailable && (
                            <IconButton onClick={handleScreen} style={{ color: "white" }}>
                                {screen ? <ScreenShareIcon /> : <StopScreenShareIcon />}
                            </IconButton>
                        )}

                        <Badge badgeContent={newMessages} max={999} color="warning">
                            <IconButton
                                onClick={() => {
                                    setModal(!showModal);
                                    setNewMessages(0);
                                }}
                                style={{ color: "white" }}
                            >
                                <ChatIcon />
                            </IconButton>
                        </Badge>

                        <IconButton onClick={() => setShowParticipants(!showParticipants)} style={{ color: "white" }}>
                            <GroupIcon />
                        </IconButton>

                        <Tooltip title="Leave meeting">
                            <IconButton onClick={handleLeave} style={{ color: "red" }}>
                                <CallEndIcon />
                            </IconButton>
                        </Tooltip>

                        {isHost && (
                            <Button
                                variant="outlined"
                                color="error"
                                size="small"
                                onClick={handleEndForEveryone}
                                style={{ marginLeft: "10px" }}
                            >
                                End for everyone
                            </Button>
                        )}
                    </div>

                    <video className={styles.meetUserVideo} ref={localVideoref} autoPlay muted></video>

                    <div className={styles.conferenceView}>
                        {videos.map((video) => (
                            <div key={video.socketId}>
                                <video
                                    data-socket={video.socketId}
                                    ref={(ref) => {
                                        if (ref && video.stream) {
                                            ref.srcObject = video.stream;
                                        }
                                    }}
                                    autoPlay
                                ></video>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default withAuth(MeetingRoom);
