import axios from "axios";
import httpStatus from "http-status";
import { createContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiBaseUrl from "../config/api";

export const AuthContext = createContext(null);

const client = axios.create({
    baseURL: `${apiBaseUrl}/api/v1/users`
});

export const AuthProvider = ({ children }) => {
    const [userData, setUserData] = useState(null);
    const navigate = useNavigate();

    const handleRegister = async (name, username, password) => {
        const response = await client.post("/register", { name, username, password });

        if (response.status === httpStatus.CREATED) {
            return response.data.message;
        }
    };

    const handleLogin = async (username, password) => {
        const response = await client.post("/login", { username, password });

        if (response.status === httpStatus.OK) {
            localStorage.setItem("token", response.data.token);
            navigate("/home");
        }
    };

    const getHistoryOfUser = async () => {
        const response = await client.get("/get_all_activity", {
            params: { token: localStorage.getItem("token") }
        });
        return response.data;
    };

    const addToUserHistory = async (meetingCode) => {
        const response = await client.post("/add_to_activity", {
            token: localStorage.getItem("token"),
            meeting_code: meetingCode
        });
        return response;
    };

    const data = {
        userData, setUserData, addToUserHistory, getHistoryOfUser, handleRegister, handleLogin
    };

    return (
        <AuthContext.Provider value={data}>
            {children}
        </AuthContext.Provider>
    );
};
