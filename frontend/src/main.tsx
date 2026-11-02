import React from "react";
import ReactDOM from "react-dom/client";
import SifuApp from "./SifuApp";
import SifuPet from "./components/SifuPet";
import "./index.css";
import "./sifu-live.css";
import "./sifu-pet.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SifuApp />
    <SifuPet />
  </React.StrictMode>
);
