import { z } from "zod";

export const meetingCodeParamSchema = z.object({
    code: z.string().trim().min(6, "Invalid meeting code")
});

export const historyQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10)
});

export const chatMessageSchema = z.object({
    text: z.string().trim().min(1, "Message can't be empty").max(2000, "Message is too long")
});

export const mediaStateSchema = z.object({
    micOn: z.boolean(),
    cameraOn: z.boolean()
});
