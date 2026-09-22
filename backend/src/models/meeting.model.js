import mongoose, { Schema } from "mongoose";

const meetingSchema = new Schema(
    {
        meetingCode: { type: String, required: true, unique: true },
        host: { type: Schema.Types.ObjectId, ref: "User", required: true },
        status: { type: String, enum: ["active", "ended"], default: "active" },
        startedAt: { type: Date, default: Date.now },
        endedAt: { type: Date }
    },
    { timestamps: true }
);

meetingSchema.index({ host: 1, createdAt: -1 });

const Meeting = mongoose.model("Meeting", meetingSchema);

export { Meeting };
