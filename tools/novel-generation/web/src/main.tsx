// Workbench 前端入口（Vite）。本地单机工具，主题与语言在根配置一次，不按面板分设。
import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import Workbench from "./Workbench";
import "./style.css";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ConfigProvider locale={zhCN} theme={{token:{colorPrimary:"#405b78",borderRadius:8,fontSize:14,colorBgLayout:"#f5f6f8"}}}><AntApp><Workbench/></AntApp></ConfigProvider></React.StrictMode>);
