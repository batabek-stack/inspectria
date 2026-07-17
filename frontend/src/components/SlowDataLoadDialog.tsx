import React from "react";

type Props = {
  open: boolean;
};

export default function SlowDataLoadDialog({ open }: Props) {
  if (!open) return null;

  return (
    <div style={overlayStyle} role="status" aria-live="polite" aria-modal="true">
      <div style={dialogStyle}>
        <div style={spinnerStyle} aria-hidden="true" />
        <p style={messageStyle}>Please wait, your organization's data is being loaded</p>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "rgba(6, 35, 47, 0.34)",
  backdropFilter: "blur(2px)",
};

const dialogStyle: React.CSSProperties = {
  width: "min(420px, 100%)",
  borderRadius: 8,
  background: "#ffffff",
  border: "1px solid #d7e6e4",
  boxShadow: "0 24px 70px rgba(3, 32, 42, 0.24)",
  padding: "24px 22px",
  textAlign: "center",
};

const spinnerStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  margin: "0 auto 14px",
  borderRadius: "50%",
  border: "4px solid #d7e6e4",
  borderTopColor: "#0f766e",
  animation: "inspectria-spin 0.9s linear infinite",
};

const messageStyle: React.CSSProperties = {
  margin: 0,
  color: "#06323f",
  fontSize: 16,
  fontWeight: 800,
  lineHeight: 1.4,
};
