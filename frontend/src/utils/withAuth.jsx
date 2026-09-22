import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const withAuth = (WrappedComponent) => {
    const AuthComponent = (props) => {
        const navigate = useNavigate();

        useEffect(() => {
            if (!localStorage.getItem("token")) {
                navigate("/auth");
            }
        }, [navigate]);

        return <WrappedComponent {...props} />;
    };

    return AuthComponent;
};

export default withAuth;
