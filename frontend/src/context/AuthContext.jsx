import axios from "axios";
import { createContext, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiBaseUrl from "../config/api";

export const AuthContext = createContext(null);

const client = axios.create({ baseURL: `${apiBaseUrl}/api/v1` });

client.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export const AuthProvider = ({ children }) => {
    const [userData, setUserData] = useState(() => {
        const stored = localStorage.getItem("user");
        return stored ? JSON.parse(stored) : null;
    });
    const navigate = useNavigate();

    useEffect(() => {
        const interceptorId = client.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response?.status === 401) {
                    localStorage.removeItem("token");
                    localStorage.removeItem("user");
                    setUserData(null);
                    navigate("/auth");
                }
                return Promise.reject(error);
            }
        );

        return () => client.interceptors.response.eject(interceptorId);
    }, [navigate]);

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

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUserData(null);
        navigate("/auth");
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
        createMeeting,
        joinMeeting,
        leaveMeeting,
        endMeeting,
        getHistory
    };

    return <AuthContext.Provider value={data}>{children}</AuthContext.Provider>;
};
