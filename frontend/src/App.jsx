import { Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import LandingPage from "./pages/Landing";
import Authentication from "./pages/Authentication";
import HomeComponent from "./pages/Home";
import History from "./pages/History";
import MeetingRoom from "./pages/MeetingRoom";
import "./App.css";

function App() {
  return (
    <div className="App">
      <Router>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<Authentication />} />
            <Route path="/home" element={<HomeComponent />} />
            <Route path="/history" element={<History />} />
            <Route path="/:url" element={<MeetingRoom />} />
          </Routes>
        </AuthProvider>
      </Router>
    </div>
  );
}

export default App;
