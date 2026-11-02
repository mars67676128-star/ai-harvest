import React from "react";
import ReactDOM from "react-dom/client";
import SifuApp from "./SifuApp";
import ExpertDemoShell from "./ExpertDemoShell";
import SifuPet from "./components/SifuPet";
import { demoPersona } from "./demoIdentity";
import "./index.css";
import "./sifu-live.css";
import "./sifu-pet.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {demoPersona === "expert" ? <ExpertDemoShell /> : <SifuApp />}
    <SifuPet />
  </React.StrictMode>
);
