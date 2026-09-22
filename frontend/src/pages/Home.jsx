import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, IconButton, TextField } from "@mui/material";
import RestoreIcon from "@mui/icons-material/Restore";
import withAuth from "../utils/withAuth";
import { AuthContext } from "../context/AuthContext";
import heroIllustration from "../assets/hero-illustration.png";
import "../App.css";

function HomeComponent() {
  const navigate = useNavigate();
  const [meetingCode, setMeetingCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const { createMeeting, handleLogout } = useContext(AuthContext);

  const handleCreateMeeting = async () => {
    setError("");
    setCreating(true);
    try {
      const meeting = await createMeeting();
      navigate(`/meeting/${meeting.meetingCode}`);
    } catch (err) {
      setError(err?.response?.data?.message ?? "Could not start a meeting");
    } finally {
      setCreating(false);
    }
  };

  const handleJoinMeeting = () => {
    const code = meetingCode.trim();
    if (!code) return;
    navigate(`/meeting/${code}`);
  };

  return (
    <>
      <div className="navBar">
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2>MeetSphere</h2>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <IconButton onClick={() => navigate("/history")}>
            <RestoreIcon />
          </IconButton>
          <p>History</p>

          <Button onClick={handleLogout}>Logout</Button>
        </div>
      </div>

      <div className="meetContainer">
        <div className="leftPanel">
          <div>
            <h2>Video calls made simple</h2>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <TextField
                onChange={(e) => setMeetingCode(e.target.value)}
                value={meetingCode}
                id="meeting-code"
                label="Meeting Code"
                variant="outlined"
                onKeyDown={(e) => e.key === "Enter" && handleJoinMeeting()}
              />
              <Button onClick={handleJoinMeeting} variant="contained">
                Join
              </Button>
              <Button onClick={handleCreateMeeting} variant="outlined" disabled={creating}>
                {creating ? "Starting…" : "New Meeting"}
              </Button>
            </div>

            {error && <p style={{ color: "red", marginTop: "10px" }}>{error}</p>}
          </div>
        </div>
        <div className="rightPanel">
          <img src={heroIllustration} alt="" />
        </div>
      </div>
    </>
  );
}

export default withAuth(HomeComponent);
