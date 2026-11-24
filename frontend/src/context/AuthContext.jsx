import axios from "axios";
import { createContext, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiBaseUrl from "../config/api";

export const AuthContext = createContext(null);

// The session JWT lives in an httpOnly cookie, so there's no token to attach
// here: withCredentials makes the browser send (and accept) that cookie on
// cross-origin requests (local dev, or a directly-called API).
const client = axios.create({ baseURL: `${apiBaseUrl}/api/v1`, withCredentials: true });

export const AuthProvider = ({ children }) => {
    // The page can't read the cookie, so on load we ask the API who we are.
    const [userData, setUserData] = useState(null);
    const [checking, setChecking] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        client
            .get("/auth/me")
            .then((response) => setUserData(response.data.user))
            .catch(() => setUserData(null))
            .finally(() => setChecking(false));
    }, []);

    const expireSession = useCallback(() => {
        setUserData(null);
        navigate("/auth");
    }, [navigate]);

    // If any request comes back 401 (cookie expired or cleared), drop the
    // user so withAuth sends them to the login page.
    useEffect(() => {
        const interceptorId = client.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response?.status === 401) setUserData(null);
                return Promise.reject(error);
            }
        );

        return () => client.interceptors.response.eject(interceptorId);
    }, []);

    const handleRegister = async (name, username, password) => {
        const response = await client.post("/auth/register", { name, username, password });
        return response.data.message;
    };

    const handleLogin = async (username, password) => {
        const response = await client.post("/auth/login", { username, password });
        setUserData(response.data.user);
        navigate("/home");
    };

    const handleLogout = async () => {
        try {
            // Clears the httpOnly cookie, which only the server can do.
            await client.post("/auth/logout");
        } catch {
            // Still log out locally even if the server is unreachable.
        }
        expireSession();
    };

    // A one-minute token for the Socket.IO handshake. The socket server is
    // reached directly (the /api proxy can't carry WebSockets), so the cookie
    // isn't sent there; this request goes through the proxy, where it is.
    const getSocketToken = useCallback(async () => {
        const response = await client.get("/auth/socket-token");
        return response.data.token;
    }, []);

    const createMeeting = async () => {
        const response = await client.post("/meetings");
        return response.data.meeting;
    };

    const joinMeeting = async (meetingCode) => {
        const response = await client.post(`/meetings/${meetingCode}/join`);
        return response.data;
    };

    const leaveMeeting = async (meetingCode) => {
        await client.post(`/meetings/${meetingCode}/leave`);
    };

    const endMeeting = async (meetingCode) => {
        await client.post(`/meetings/${meetingCode}/end`);
    };

    const getHistory = useCallback(async (page = 1, limit = 10) => {
        const response = await client.get("/meetings/history", { params: { page, limit } });
        return response.data;
    }, []);

    const data = {
        userData,
        checking,
        handleRegister,
        handleLogin,
        handleLogout,
        expireSession,
        getSocketToken,
        createMeeting,
        joinMeeting,
        leaveMeeting,
        endMeeting,
        getHistory
    };

    return <AuthContext.Provider value={data}>{children}</AuthContext.Provider>;
};
