import React from "react";
import ReactDOM from "react-dom/client";
import SifuApp from "./SifuApp";
import ExpertDemoShell from "./ExpertDemoShell";
import OwnerDemoShell from "./OwnerDemoShell";
import SifuPet from "./components/SifuPet";
import { demoPersona } from "./demoIdentity";
import "./index.css";
import "./sifu-live.css";
import "./sifu-pet.css";

const workspace =
  demoPersona === "expert" ? (
    <ExpertDemoShell />
  ) : demoPersona === "approver" ? (
    <OwnerDemoShell />
  ) : (
    <SifuApp />
  );

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {workspace}
    <SifuPet />
  </React.StrictMode>
);
