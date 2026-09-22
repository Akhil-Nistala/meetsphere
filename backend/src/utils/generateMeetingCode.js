import crypto from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

const randomSegment = (length) =>
    Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

export const generateMeetingCode = () => `${randomSegment(3)}-${randomSegment(4)}-${randomSegment(3)}`;
