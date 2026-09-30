import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import Loader from "./components/Loader";
createRoot(document.getElementById("root")).render(
  <>
    <App />
    <Loader />
  </>,
);
