import { z } from "zod";

export const registerSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    username: z.string().trim().min(3, "Username must be at least 3 characters"),
    password: z.string().min(6, "Password must be at least 6 characters")
});

export const loginSchema = z.object({
    username: z.string().trim().min(1, "Username is required"),
    password: z.string().min(1, "Password is required")
});
