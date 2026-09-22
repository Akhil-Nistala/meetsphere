import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import HomeIcon from "@mui/icons-material/Home";
import { IconButton } from "@mui/material";
import { AuthContext } from "../context/AuthContext";
import withAuth from "../utils/withAuth";

function History() {
  const { getHistoryOfUser } = useContext(AuthContext);
  const [meetings, setMeetings] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history = await getHistoryOfUser();
        setMeetings(history);
      } catch {
        setMeetings([]);
      }
    };

    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
  };

  return (
    <div>
      <IconButton onClick={() => navigate("/home")}>
        <HomeIcon />
      </IconButton>

      {meetings.length === 0 ? (
        <p style={{ paddingInline: "20px" }}>No meetings yet.</p>
      ) : (
        meetings.map((meeting, i) => (
          <Card key={meeting._id ?? i} variant="outlined" style={{ margin: "10px 20px" }}>
            <CardContent>
              <Typography sx={{ fontSize: 14 }} color="text.secondary" gutterBottom>
                Code: {meeting.meetingCode}
              </Typography>
              <Typography sx={{ mb: 1.5 }} color="text.secondary">
                Date: {formatDate(meeting.date)}
              </Typography>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

export default withAuth(History);
