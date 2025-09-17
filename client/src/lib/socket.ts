import { io } from "socket.io-client";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  `${window.location.protocol}//${window.location.host}`;

export const socket = io(SERVER_URL, {
  transports: ["websocket"],
  withCredentials: true,
});
