// React core library.
import React from "react";
// ReactDOM connects React components to the real browser page.
import ReactDOM from "react-dom/client";
// Main app component.
import App from "./App";

// Find the <div id="root"></div> in public/index.html.
const root = ReactDOM.createRoot(document.getElementById("root"));
// Render the App component inside that root element.
root.render(<App />);
