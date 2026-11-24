import { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

// Wraps a page so it only renders for a logged-in user; anyone else is sent
// to /auth. "Logged in" means the API confirmed the session via /auth/me; the
// token is in an httpOnly cookie, so the page can't inspect it itself. This
// is a UX guard only: the API and socket server enforce auth themselves.
const withAuth = (WrappedComponent) => {
    const AuthComponent = (props) => {
        const { userData, checking } = useContext(AuthContext);

        if (checking) {
            return <div style={{ padding: 24 }}>Loading…</div>;
        }

        if (!userData) {
            return <Navigate to="/auth" replace />;
        }

        return <WrappedComponent {...props} />;
    };

    return AuthComponent;
};

export default withAuth;
