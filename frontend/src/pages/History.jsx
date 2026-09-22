import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import HomeIcon from "@mui/icons-material/Home";
import Chip from "@mui/material/Chip";
import { Button, IconButton } from "@mui/material";
import { AuthContext } from "../context/AuthContext";
import withAuth from "../utils/withAuth";

const PAGE_SIZE = 10;

function formatDate(dateString) {
  const date = new Date(dateString);
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year} ${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function History() {
  const { getHistory } = useContext(AuthContext);
  const [meetings, setMeetings] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const fetchHistory = async () => {
      setLoading(true);
      try {
        const response = await getHistory(page, PAGE_SIZE);
        if (!cancelled) {
          setMeetings(response.data);
          setTotalPages(response.totalPages || 1);
        }
      } catch {
        if (!cancelled) setMeetings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [page, getHistory]);

  return (
    <div style={{ paddingBottom: "40px" }}>
      <IconButton onClick={() => navigate("/home")}>
        <HomeIcon />
      </IconButton>

      {loading ? (
        <p style={{ paddingInline: "20px" }}>Loading…</p>
      ) : meetings.length === 0 ? (
        <p style={{ paddingInline: "20px" }}>No meetings yet.</p>
      ) : (
        meetings.map((meeting) => (
          <Card key={meeting.meetingCode} variant="outlined" style={{ margin: "10px 20px" }}>
            <CardContent>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography sx={{ fontSize: 16, fontWeight: 600 }}>{meeting.meetingCode}</Typography>
                <Chip
                  label={meeting.status === "active" ? "Active" : "Ended"}
                  color={meeting.status === "active" ? "success" : "default"}
                  size="small"
                />
              </div>
              <Typography sx={{ mt: 1 }} color="text.secondary">
                Host: {meeting.host?.name ?? "Unknown"}
              </Typography>
              <Typography color="text.secondary">Started: {formatDate(meeting.startedAt)}</Typography>
              <Typography color="text.secondary">Duration: {formatDuration(meeting.durationSeconds)}</Typography>
              <Typography color="text.secondary">Participants: {meeting.participantCount}</Typography>
            </CardContent>
          </Card>
        ))
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "10px", justifyContent: "center", marginTop: "10px" }}>
          <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Typography sx={{ alignSelf: "center" }}>
            Page {page} of {totalPages}
          </Typography>
          <Button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export default withAuth(History);
