import mongoose, { Schema } from "mongoose";

const messageSchema = new Schema(
    {
        meeting: { type: Schema.Types.ObjectId, ref: "Meeting", required: true },
        sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
        senderName: { type: String, required: true },
        text: { type: String, required: true }
    },
    { timestamps: true }
);

messageSchema.index({ meeting: 1, createdAt: 1 });

const Message = mongoose.model("Message", messageSchema);

export { Message };
