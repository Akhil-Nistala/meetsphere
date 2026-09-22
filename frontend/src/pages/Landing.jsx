import { Link, useNavigate } from "react-router-dom";
import mobileMock from "../assets/mobile.png";
import "../App.css";

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="landingPageContainer">
      <nav>
        <div className="navHeader">
          <h2>Lumen</h2>
        </div>
        <div className="navlist">
          <p onClick={() => navigate("/auth")}>Register</p>
          <div onClick={() => navigate("/auth")} role="button">
            <p>Login</p>
          </div>
        </div>
      </nav>

      <div className="landingMainContainer">
        <div>
          <h1>
            <span className="accent">Connect</span> with the people who matter
          </h1>
          <p>Crystal-clear video calls, wherever you are.</p>
          <div role="button">
            <Link to="/auth">Get Started</Link>
          </div>
        </div>
        <div>
          <img src={mobileMock} alt="Two people on a video call" />
        </div>
      </div>
    </div>
  );
}
