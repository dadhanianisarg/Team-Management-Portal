const rawBaseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
const cleanURL = rawBaseURL.replace(/\/+$/, "");

export const baseURL = cleanURL.endsWith("/api") ? cleanURL : `${cleanURL}/api`;
