import mongoose from "mongoose";

export const connectDB = async (uri) => {
    if (!uri) {
        throw new Error("MONGO_URI is not set. Copy .env.example to .env and fill it in.");
    }

    const connection = await mongoose.connect(uri);
    return connection.connection.host;
};
