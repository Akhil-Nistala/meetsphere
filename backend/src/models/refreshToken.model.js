import mongoose, { Schema } from "mongoose";

// One document per issued refresh token. Only a SHA-256 hash of the token is
// stored, so a database leak doesn't hand out usable sessions.
//
// `family` groups every token descended from a single login. Rotation revokes
// the presented token and issues a sibling in the same family; if an already
// revoked token is ever presented again, that's a sign it was stolen, and the
// whole family is revoked.
const refreshTokenSchema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        tokenHash: { type: String, required: true, unique: true },
        family: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        revokedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

refreshTokenSchema.index({ family: 1 });
// Let MongoDB delete expired tokens on its own.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);

export { RefreshToken };
