import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import App from "./App";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider theme={{token:{colorPrimary:"#315c9b",colorBgLayout:"#f4f6f9",borderRadius:8,fontFamily:"Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"}}}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
