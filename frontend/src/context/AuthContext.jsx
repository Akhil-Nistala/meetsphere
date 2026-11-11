import axios from "axios";
import { createContext, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiBaseUrl from "../config/api";

export const AuthContext = createContext(null);

// withCredentials so the browser sends and stores the httpOnly refresh-token cookie.
const client = axios.create({ baseURL: `${apiBaseUrl}/api/v1`, withCredentials: true });

client.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// A 401 from these endpoints means bad credentials or a dead session, not an
// expired access token, so it must never trigger a refresh-and-retry.
const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

// Shared across callers, so a burst of parallel 401s (or a socket reconnect
// racing an API call) sends exactly one /auth/refresh request. That matters:
// refresh tokens are single-use, so a second concurrent refresh with the same
// cookie would be rejected.
let refreshPromise = null;

export const refreshAccessToken = () => {
    if (!refreshPromise) {
        refreshPromise = client
            .post("/auth/refresh")
            .then((response) => {
                localStorage.setItem("token", response.data.token);
                localStorage.setItem("user", JSON.stringify(response.data.user));
                return response.data.token;
            })
            .finally(() => {
                refreshPromise = null;
            });
    }
    return refreshPromise;
};

export const AuthProvider = ({ children }) => {
    const [userData, setUserData] = useState(() => {
        const stored = localStorage.getItem("user");
        return stored ? JSON.parse(stored) : null;
    });
    const navigate = useNavigate();

    const expireSession = useCallback(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUserData(null);
        navigate("/auth");
    }, [navigate]);

    useEffect(() => {
        const interceptorId = client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const original = error.config;
                const shouldRefresh =
                    error.response?.status === 401 &&
                    original &&
                    !original._retried &&
                    !NO_REFRESH_PATHS.includes(original.url);

                if (!shouldRefresh) {
                    return Promise.reject(error);
                }

                original._retried = true;
                try {
                    await refreshAccessToken();
                } catch {
                    expireSession();
                    return Promise.reject(error);
                }
                // The request interceptor reattaches the new token from localStorage.
                return client(original);
            }
        );

        return () => client.interceptors.response.eject(interceptorId);
    }, [expireSession]);

    const handleRegister = async (name, username, password) => {
        const response = await client.post("/auth/register", { name, username, password });
        return response.data.message;
    };

    const handleLogin = async (username, password) => {
        const response = await client.post("/auth/login", { username, password });
        localStorage.setItem("token", response.data.token);
        localStorage.setItem("user", JSON.stringify(response.data.user));
        setUserData(response.data.user);
        navigate("/home");
    };

    const handleLogout = async () => {
        try {
            // Revokes the refresh token on the server and clears its cookie.
            await client.post("/auth/logout");
        } catch {
            // Still log out locally even if the server is unreachable.
        }
        expireSession();
    };

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
        handleRegister,
        handleLogin,
        handleLogout,
        expireSession,
        createMeeting,
        joinMeeting,
        leaveMeeting,
        endMeeting,
        getHistory
    };

    return <AuthContext.Provider value={data}>{children}</AuthContext.Provider>;
};
