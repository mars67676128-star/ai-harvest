import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import SifuApp from "./SifuApp";
import ExpertDemoShell from "./ExpertDemoShell";
import OwnerDemoShell from "./OwnerDemoShell";
import OperationalCaseShell from "./OperationalCaseShell";
import SifuPet from "./components/SifuPet";
import { demoPersona } from "./demoIdentity";
import "./index.css";
import "./sifu-live.css";
import "./sifu-pet.css";
import "./brand-polish.css";

function EmployeeWorkspace() {
  useEffect(() => {
    const openDemoCase = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const row = target?.closest("button.timeline-row");
      if (!row?.textContent?.includes("Pump RUNNING while water rises")) return;

      event.preventDefault();
      window.location.assign(`${window.location.pathname}?case=harbour-exchange`);
    };

    document.addEventListener("click", openDemoCase);
    return () => document.removeEventListener("click", openDemoCase);
  }, []);

  return <SifuApp />;
}

const params = new URLSearchParams(window.location.search);
const operationalCase = params.get("case") === "harbour-exchange";

const workspace = operationalCase ? (
  <OperationalCaseShell />
) : demoPersona === "expert" ? (
  <ExpertDemoShell />
) : demoPersona === "approver" ? (
  <OwnerDemoShell />
) : (
  <EmployeeWorkspace />
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {workspace}
    <SifuPet />
  </React.StrictMode>
);
