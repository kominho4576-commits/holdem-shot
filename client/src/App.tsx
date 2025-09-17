import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import Match from "./pages/Match";
import Game from "./pages/Game";
import Result from "./pages/Result";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/match" element={<Match />} />
      <Route path="/game" element={<Game />} />
      <Route path="/result" element={<Result />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
