import mongoose, { Schema } from "mongoose";

const participantSchema = new Schema(
    {
        meeting: { type: Schema.Types.ObjectId, ref: "Meeting", required: true },
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        name: { type: String, required: true },
        micOn: { type: Boolean, default: true },
        cameraOn: { type: Boolean, default: true },
        joinedAt: { type: Date, default: Date.now },
        leftAt: { type: Date }
    },
    { timestamps: true }
);

participantSchema.index({ meeting: 1, user: 1 });

const Participant = mongoose.model("Participant", participantSchema);

export { Participant };
