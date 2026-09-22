import { Router } from "express";
import {
    createMeeting,
    endMeeting,
    getHistory,
    joinMeeting,
    leaveMeeting
} from "../controllers/meeting.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { historyQuerySchema, meetingCodeParamSchema } from "../validators/meeting.validator.js";

const router = Router();

router.use(requireAuth);

router.post("/", createMeeting);
router.get("/history", validate(historyQuerySchema, "query"), getHistory);
router.post("/:code/join", validate(meetingCodeParamSchema, "params"), joinMeeting);
router.post("/:code/leave", validate(meetingCodeParamSchema, "params"), leaveMeeting);
router.post("/:code/end", validate(meetingCodeParamSchema, "params"), endMeeting);

export default router;
