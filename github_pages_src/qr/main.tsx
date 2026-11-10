import React from "react";
import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import QrDisplayPage from "../../app/qr-page";

if (typeof document !== "undefined") {
  createRoot(document.getElementById("root")!).render(<React.StrictMode><QrDisplayPage/></React.StrictMode>);
}

